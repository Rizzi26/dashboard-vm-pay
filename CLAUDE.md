# vm-pay

Integração com a **API VMpay** (Nayax / Verti Tecnologia): servidor MCP +
dashboard. Remote: `git@github.com:Rizzi26/dashboard-vm-pay.git` (a pasta local
chama `vm-pay`).

## Leia primeiro

- [`docs/api-reference.md`](docs/api-reference.md) — a API destilada. **Consulte
  antes de escrever qualquer chamada.**
- [`docs/architecture.md`](docs/architecture.md) — decisões tomadas e por quê.
- `docs/endpoints.txt` — os 176 endpoints com o arquivo de origem de cada um.
- `docs/vendor/doc_api.txt` — a doc oficial inteira em texto puro. Quando o
  api-reference não responder, `grep` aqui em vez de adivinhar. **Pode não
  existir** — veja abaixo.

## docs/vendor/ está fora do git

O repositório é público e o material é da Verti Tecnologia / Nayax, então a doc
oficial não é versionada. Um clone novo não a tem. O que é nosso — a destilação,
a lista de endpoints, o `catalog.json` derivado — está versionado, e **o MCP
funciona sem a pasta**.

Para repopular (só é necessário para regenerar o catálogo): veja
[`docs/vendor/COMO-OBTER.md`](docs/vendor/COMO-OBTER.md). Não existe espelho
público — `vmpay-api.readthedocs.io` é uma casca vazia de 2023.

## A API em sete linhas

- Base: `https://vmpay.vertitecnologia.com.br/api/v1`
- Auth é `?access_token=...` **na query string**. Não existe header
  `Authorization`. O token vaza em log de proxy e histórico de shell — tudo passa
  por `vmpay.redact()` antes de virar log ou exceção.
- **300 req/min por token**, não por operador. Cada consumidor tem sua própria
  chave e seu próprio balde.
- Paginação `page`/`per_page` (máx 1000), **sem total e sem cursor**: acabou
  quando o retorno vier menor que `per_page`.
- **Não há webhook.** A VMpay é passiva; todo polling parte daqui.
- Vendas se lêem por **cursor de id** (`transaction_id_greater_than` em
  `/cashless_facts`), não por janela de data — `/vends` vem ordenado decrescente
  e paginar por data com dado entrando ao vivo pula registro. Quando o cursor é
  passado, a API **ignora** `start_date`/`end_date`.
- Corpos de POST/PATCH vão **dentro de um envelope**: `{"product": {...}}`. O
  cliente monta isso sozinho a partir do catálogo.

## Estrutura

```
packages/vmpay/     cliente Python compartilhado — toda quirk da API mora aqui
apps/mcp/           servidor MCP (catálogo extraído da doc + guardrails)
apps/api/           FastAPI no Render — ingestão + agregação
apps/web/           Next.js na Vercel — dashboard
supabase/           migrations (schema `vmpay`, não `public`)
```

O caminho do dado é sempre o mesmo: **VMpay → worker → Supabase → FastAPI →
Next.js**. O dashboard nunca fala com a VMpay, e nada além do FastAPI fala com o
Postgres.

Stack decidida: Next.js na Vercel, Supabase (Postgres), FastAPI no Render,
separado do frontend.

## Comandos

```bash
# testes (90 no total)
cd packages/vmpay && .venv/bin/pytest      # 15
cd apps/mcp       && .venv/bin/pytest      # 43
cd apps/api       && .venv/bin/pytest      # 32

# ambiente Python, se ainda não existir
uv venv && uv pip install -e ".[dev]"

# backend + dashboard local
cd apps/api && .venv/bin/uvicorn vmpay_api.main:app --reload
cd apps/web && API_URL=http://localhost:8000 pnpm dev

# uma rodada de ingestão
cd apps/api && .venv/bin/vmpay-ingest

# regenerar o catálogo do MCP a partir da doc vendorizada
python3 apps/mcp/tools/build_catalog.py
```

## Regras da casa

**Nunca escreva o token em arquivo, teste ou log.** Ele vem só de variável de
ambiente (`VMPAY_TOKEN`). Em teste, use um valor falso e verifique que ele *não*
aparece na saída — há um teste exatamente para isso.

**Não edite `apps/mcp/src/vmpay_mcp/catalog.json` à mão.** Ele é gerado por
`build_catalog.py` a partir de `docs/vendor/doc_api`. Se algo está errado ali,
conserte o extrator — edição manual se perde na próxima regeneração. Se a Nayax
publicar doc nova, substitua `docs/vendor/doc_api/` e rode o script.

**Toda quirk da API vai para `packages/vmpay`,** não para o consumidor. Se você
está prestes a tratar paginação, rate limit ou formato de data dentro do MCP, do
worker ou da API, o lugar é o cliente.

**Guardrails do MCP são deliberados, não excesso de zelo.** Escrita exige
`VMPAY_ALLOW_WRITES=1` *e* `VMPAY_BASE` declarado; operação em máquina exige
`VMPAY_ALLOW_MACHINE_OPS=1` por cima; exclusão e comando remoto exigem o id do
alvo ecoado em `confirmar`. Comando remoto atinge equipamento físico em campo.
Não afrouxe nada disso sem o humano pedir.

**Faturamento sai de `vmpay.sale`, nunca de `vmpay.cashless_fact`.** O campo
`status` vem `OK` ou `CANCEL`; somar sem filtrar infla o número. A view existe
para que ninguém precise lembrar disso.

**O schema `vmpay` não pode ser exposto no PostgREST.** É o que impede a chave
anônima do Supabase de alcançar dado de venda. O dashboard lê pelo FastAPI.

**Datas são UTC.** Os filtros aceitam ISO 8601 ou `dd/mm/yyyy hh:mi:ss`, e em
ambos a API lê como UTC. Hora omitida vira 00:00 UTC e a janela muda em silêncio.
Use `vmpay.to_vmpay_datetime()`.

**Comentário explica *por quê*, não *o quê*.** O código diz o que faz; o
comentário existe para a decisão não-óbvia — por que balde com reposição contínua
e não janela fixa, por que o cursor avança pelo maior id e não pelo último.

## Estado e pendências

- [x] Documentação consolidada
- [x] `packages/vmpay` — cliente (15 testes)
- [x] `apps/mcp` — servidor MCP (43 testes)
- [x] `supabase/` — schema · `apps/api` — FastAPI (32 testes) · `apps/web` — dashboard
- [ ] Conectar Vercel · Supabase · Render, e CI de deploy no merge para `main`

**O código nunca falou com a API real** — só com mock. O primeiro contato de
verdade depende do token de homologação, que está sendo providenciado junto ao
suporte da Nayax (integracoes@nayax.com). Até lá, trate qualquer afirmação sobre
comportamento em runtime como não verificada.

O catálogo cobre bem os recursos que a doc documenta bem. `audits`, `storables` e
as tabelas de domínio têm pouca ou nenhuma descrição de parâmetro na origem — o
extrator não inventa o que a doc não diz.
