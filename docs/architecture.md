# Arquitetura

## Decisões

| Decisão | Escolha |
|---|---|
| Escopo do MCP | Completo, incluindo operação (planogramas, pick lists, ajustes de inventário, comandos remotos) |
| Dados do dashboard | Ingestão para base própria (Supabase) |
| Frontend | Next.js na Vercel |
| Banco | Supabase (Postgres) |
| Backend | FastAPI no Render, separado do frontend |

## Desenho

```
                       ┌───────────────────────┐
                       │  API VMpay (passiva)  │
                       │  300 req/min / token  │
                       └───────────┬───────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │ token: ingest        │ token: mcp           │ token: api
            │                      │                      │
   ┌────────▼────────┐   ┌─────────▼─────────┐   ┌────────▼────────┐
   │  Worker de      │   │  Servidor MCP     │   │  FastAPI        │
   │  ingestão       │   │  (stdio/HTTP)     │   │  (consultas ao  │
   │  cursor por id  │   │  leitura+operação │   │   vivo pontuais)│
   └────────┬────────┘   └───────────────────┘   └────────┬────────┘
            │                                             │
            │  ┌───────────────────────────────────┐      │
            └─▶│  Supabase (Postgres)              │◀─────┘
               │  raw + agregados + cursores       │
               └───────────────┬───────────────────┘
                               │
                     ┌─────────▼─────────┐
                     │  Next.js / Vercel │
                     └───────────────────┘
```

Todos falam com a VMpay pelo mesmo pacote `packages/vmpay`. As quirks da API
(token na query, rate limit, paginação sem total, cursor por id) ficam num lugar só.

## Um token por consumidor

O limite de 300 req/min é **por `access_token`**, não por operador — e o portal
permite registrar quantas chaves quiser. Portanto: uma chave para o worker de
ingestão, uma para o MCP, uma para a API. Efeitos:

- o worker varrendo histórico não derruba o dashboard;
- dá para revogar a chave do MCP sem parar a ingestão;
- o `429` passa a dizer *qual* consumidor exagerou.

Nomeie as chaves no portal de forma que o nome identifique o consumidor
(`ingest-prod`, `mcp-dev`, `api-prod`).

## Por que ingestão e não consulta ao vivo

A API não agrega. Não existe "vendas por mês" nem "top produtos" — todo relatório
é lista crua paginada, no máximo 1000 por request, sem total e sem cursor de
paginação. Um painel de 12 meses de vendas seria dezenas de milhares de requests.

O worker resolve isso com o cursor por id: `transaction_id_greater_than` em
`/cashless_facts` (e `vend_id_greater_than` em `/vends`) devolvem só o que é novo.
Guardamos o maior id visto e a próxima rodada continua de lá.

Nota: quando `transaction_id_greater_than` é passado, `start_date` e `end_date`
são **ignorados** pela API. Backfill histórico é por janela de data; o
incremental é por cursor. São dois modos distintos no worker.

## Guardrails de escrita

O MCP tem escopo de operação, o que inclui ações irreversíveis pela API:
`DELETE` de cadastros, ajuste de inventário, e `POST /remote_commands`, que
atinge a **máquina física**.

Regras implementadas no servidor MCP:

1. **Escrita é opt-in por ambiente.** Sem `VMPAY_ALLOW_WRITES=1` o servidor sobe
   somente-leitura e as tools de escrita nem aparecem.
2. **Operação é um segundo nível.** Comandos remotos e ajuste de inventário
   exigem `VMPAY_ALLOW_MACHINE_OPS=1`, separado do anterior.
3. **Destrutivo exige eco.** `DELETE` e comando remoto pedem um parâmetro
   `confirm` com o identificador do alvo — o modelo tem que repetir de volta o
   que vai destruir, o que impede acerto por acidente.
4. **Homologação por padrão.** `VMPAY_BASE` aponta para homologação a menos que
   se declare produção explicitamente.

## Segurança do token

O token vai na **query string** — não há header `Authorization`. Isso significa
que ele vaza em log de acesso, em histórico de shell e em URL de exceção. O
cliente trata isso:

- token lido só de variável de ambiente, nunca de arquivo versionado;
- toda URL passa por redaction antes de virar log ou mensagem de erro;
- `repr()` do cliente não expõe o token.

Em produção: Supabase Vault / variáveis de ambiente do Render e da Vercel.
Rotação é manual (gerar chave nova no portal, trocar, revogar a antiga).

## Estrutura do repositório

```
packages/vmpay/     cliente Python compartilhado
apps/mcp/           servidor MCP
apps/api/           FastAPI (Render) — ingestão + agregação
apps/web/           Next.js (Vercel)
supabase/           migrations
docs/               esta pasta
```
