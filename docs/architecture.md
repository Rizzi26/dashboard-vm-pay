# Arquitetura

## O produto

Plataforma **white-label** de gestão para operadores de autosserviço. O
mercadinho de condomínio na VMpay é a primeira organização (PoC); o desenho já
comporta outros operadores, outros sistemas de origem e, no limite, operação
sem sistema externo nenhum. IA de recomendação/análise fica para depois — a
preparação para ela é o histórico canônico limpo, não feature agora.

## Decisões

| Decisão | Escolha |
|---|---|
| Domínio canônico | schema `core`; `vmpay` é staging do conector |
| Papéis | por organização: viewer / admin / master + superadmin de plataforma |
| Auth | Supabase Auth; FastAPI valida JWT e resolve papel no banco |
| Ações (estoque/preço) | write-back para a VMpay; registro local é o log |
| Frontend | Next.js na Vercel |
| Banco | Supabase (Postgres) — schemas `core` e `vmpay` FORA do PostgREST |
| Backend | FastAPI no Render, plano de dados único |
| Cron | GitHub Actions (repo público = minutos grátis; Render free não tem cron) |

## Desenho

```
                       ┌───────────────────────┐
                       │  API VMpay (passiva)  │   ← primeiro conector;
                       │  300 req/min / token  │     outros entram ao lado
                       └───────┬───────▲───────┘
                       leitura │       │ write-back (restock, preço)
            ┌──────────────────┼───────┼──────────────────┐
            │                  │       │                  │
   ┌────────▼────────┐   ┌────▼───────┴────┐              │
   │ Worker ingestão │   │  FastAPI (Render)│◀── JWT ──┐  │
   │ (GH Actions)    │   │  RBAC + ações    │          │  │
   │ vendas: cursor  │   │  agregados       │          │  │
   │ estoque: snapshot│  └────────┬────────┘           │  │
   └────────┬────────┘            │                    │  │
            │                     │                    │  │
   ┌────────▼─────────────────────▼──────┐   ┌─────────┴──▼──────┐
   │ Supabase (Postgres)                 │   │ Next.js (Vercel)  │
   │  vmpay.* staging │ core.* canônico  │   │ login · vendas ·  │
   │  (fora do PostgREST)                │   │ estoque · usuários│
   └─────────────────────────────────────┘   └───────▲───────────┘
                       ▲                             │ sessão
                       └────── Supabase Auth ────────┘
```

Fluxo de leitura: VMpay → worker → Postgres → FastAPI → Next.js.
Fluxo de ação: Next.js → FastAPI → (action_log pendente) → VMpay → reflexo
local → action_log fechado.

## Domínio canônico vs staging

`core` é o que o produto entende: `organization`, `membership`, `integration`,
`product`(+`product_link`), `location`(+`location_link`), `stock_balance`,
`stock_movement`, `action_log`. Nada ali sabe o que é planograma.

`vmpay` é o staging bruto do conector (vendas por cursor). A canonicalização de
vendas para o core está **adiada de propósito** — o dashboard de vendas lê
`vmpay.sale` enquanto houver um único tenant.

O vínculo canônico↔externo vive nas tabelas `*_link`, separado da entidade:
conector novo não altera tabela canônica, e um produto pode ter vínculos
múltiplos. No link da VMpay ficam `machine_id`+`installation_id`
desnormalizados porque o write-back precisa do par.

## Papéis

- **viewer** — leitura e exportação (planilha de estoque).
- **admin** — viewer + ações de operação: entrada de estoque, alteração de preço.
- **master** — admin + gestão de usuários da organização.
- **superadmin** (`core.platform_admin`) — nós; age como master em qualquer
  organização, invisível para os clientes.

O papel é resolvido **no banco** a cada request; nunca vem de claim do JWT.
Toda rota de dados é `/orgs/{slug}/...`; guard de papel via `require_role`.

## O conector

Interface de escrita (`connector.py`): `restock` e `set_price`. A VMpay
endereça estoque por item de planograma, então toda escrita lê o planograma
atual para traduzir good_id → planogram_item_id; entrada de estoque vira ajuste
de inventário `kind=now`, preço vira PATCH do planograma agrupado. Um segundo
conector (ERP novo, ou operação manual sem sistema) implementa a mesma
interface e alimenta o mesmo core.

## Um token por consumidor

O limite de 300 req/min da VMpay é por `access_token`. Chaves separadas para
ingestão, MCP e API; nomeadas no portal pelo consumidor. `integration.config`
guarda o **nome** da env var do token — nunca o valor; Vault por tenant quando
houver o segundo cliente.

## Trilha de auditoria

Toda ação passa por `core.action_log`: pendente commitado ANTES do write-back
(morte no meio deixa rastro, não escrita órfã), fechado com sucesso ou erro.
Movimentos manuais em `core.stock_movement`. Preenchidos só pelo backend.
