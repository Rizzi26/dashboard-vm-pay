# Deploy e automação

| Peça | Onde roda | Gatilho |
|---|---|---|
| `apps/web` | Vercel | push na `main` (integração da Vercel) |
| `apps/api` | Render, web service **Docker** (`render.yaml`) | push na `main` |
| Ingestão | **GitHub Actions**, não Render | cron a cada 15 min |
| Testes | GitHub Actions | push e pull request |

## Por que a ingestão não roda no Render

O free tier do Render não tem cron job. Como o repositório é público, os minutos
do GitHub Actions não são cobrados — então o cron vive em
[`.github/workflows/ingest.yml`](../.github/workflows/ingest.yml).

**O agendamento do Actions é best-effort.** Atrasos de 5 a 20 minutos são comuns
e uma execução pode ser pulada em horário de pico. Isso é aceitável aqui só
porque a ingestão é por cursor de id e idempotente: atrasar significa dado menos
fresco, nunca dado perdido ou duplicado.

Se algum dia a ingestão mudar para uma estratégia de janela — "a cada N minutos,
pegue os últimos N minutos" — esse mesmo atraso passa a abrir buracos no dado.
Não faça essa troca sem mover o cron para um agendador confiável.

## Três armadilhas de repositório público

**1. O log do Actions é visível para qualquer um.** O GitHub mascara o valor
exato dos secrets, mas não uma versão transformada deles. Por isso o cliente faz
redaction do `access_token` em toda URL antes de logar, e o workflow não imprime
o ambiente. Ao acrescentar passo que loga, confira o que vai para o stdout.

**2. Workflow agendado é desativado após 60 dias sem commit.** O GitHub desliga o
`schedule` de repositórios inativos e manda um aviso por e-mail. Se o projeto
ficar parado dois meses, a ingestão para em silêncio — reative em Actions no
painel do GitHub. O endpoint `/sales/sync-status` e o rodapé do dashboard existem
justamente para essa parada não passar por "dia fraco de vendas".

**3. Secrets não chegam a PR de fork**, por padrão do GitHub. Por isso o workflow
de ingestão só tem `schedule` e `workflow_dispatch` — nunca `pull_request`.

## Secrets do GitHub Actions

Settings → Secrets and variables → Actions:

| Secret | O quê |
|---|---|
| `DATABASE_URL` | Postgres do Supabase, **Session pooler** (porta 5432, host `pooler.supabase.com`) |
| `VMPAY_INGEST_TOKEN` | Chave de operador dedicada à ingestão |
| `VMPAY_BASE` | URL do ambiente VMpay; vazio = produção |

**Nunca a "Direct connection"** (`db.<ref>.supabase.co`): ela é IPv6-only, e nem
os runners do GitHub Actions nem o Render falam IPv6 — o sintoma é `gaierror`
na primeira conexão. Session pooler dá a sessão longa que o worker quer por um
host IPv4. A API web no Render usa a variante Transaction (porta 6543).

Uma chave por consumidor: o limite de 300 req/min é por token, então a chave da
ingestão não pode ser a mesma do MCP nem a da API.

## V1 local completa (Docker)

```bash
docker compose up --build
```

Sobe Postgres com as migrations REAIS + seed local, backend real, frontend
real; só o Supabase Auth é stub. http://localhost:3210, logins em
`scripts/demo/README.md`. A escrita na VMpay nasce bloqueada — as ações
devolvem o 503 da trava, o mesmo comportamento da produção nesta fase.

É também o jeito de testar migration nova antes de aplicar no Supabase:
`docker compose down -v && docker compose up --build` recria o banco do zero.

## Trava de escrita (fase atual)

`VMPAY_ALLOW_WRITES` — default **0**. Com o banco populado de dados de
produção, nenhuma ação (reabastecer, preço) alcança a VMpay: o backend devolve
503 com mensagem clara e a UI a exibe. Leitura, ingestão e exportação seguem
normais. Ligar a escrita = subir `VMPAY_ALLOW_WRITES=1` no Render, de
preferência primeiro com `VMPAY_BASE` apontando para homologação.

## Chaves do Supabase (nomenclatura nova)

| Chave | Onde vive |
|---|---|
| `sb_publishable_...` | Vercel (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), tipo Config |
| `sb_secret_...` | Render (`SUPABASE_SERVICE_ROLE_KEY`), Secret |
| senha do banco | dentro das `DATABASE_URL` — só letras e números (símbolos como `@` quebram a URI) |

Com a Data API do Supabase **desligada** (nosso caso — só o Auth é usado), a
publishable vira ainda mais inofensiva: não existe REST de dados para ela
alcançar.

## Primeira subida (seed da PoC)

1. Aplique `supabase/migrations/0001_init.sql` e `0002_core.sql` (SQL Editor ou
   `psql`), nesta ordem.
2. Crie o primeiro usuário no painel: Authentication → Add user.
3. Edite o email em `supabase/seed-poc.sql` e rode — cria a organização
   `mercadinho`, a integração VMpay e a membership master.
4. Confirme que os schemas `core` e `vmpay` **não** estão na lista de schemas
   expostos da API (Settings → API → Exposed schemas).
5. Rode a ingestão (Actions → Ingestão VMpay → Run workflow) para popular
   catálogo e estoque.

## Backfill histórico

O cron traz só o que é novo. Para carregar o histórico, dispare o workflow à mão
(Actions → Ingestão VMpay → Run workflow) com `max_rows = 0`. Ele vai varrer do
cursor atual até o fim, respeitando o rate limit por conta do balde no cliente.

Atenção: `transaction_id_greater_than` faz a API **ignorar** `start_date` e
`end_date`. Backfill por janela de data é outro modo, ainda não implementado —
o que existe hoje varre do cursor para frente.

## Variáveis de ambiente dos serviços

**Vercel** (`apps/web`):

| Env | O quê |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a **publishable** (`sb_publishable_...`, pública por design). JAMAIS a `sb_secret` — `NEXT_PUBLIC_*` vai embutida no JavaScript público, e uma secret ali é vazamento (aconteceu na primeira subida; a chave foi rotacionada) |
| `API_URL` | URL do Render (fetch no servidor/SSR) |
| `NEXT_PUBLIC_API_URL` | URL do Render (fetch no browser: ações, export) |

**Render** (`apps/api`): as do `.env.example`, com uma diferença — use o
**Transaction pooler** do Supabase (porta 6543; a Direct connection é IPv6-only
e falha com `gaierror`). O engine já vai
com `statement_cache_size=0`, necessário porque o pgbouncer em transaction mode
não suporta prepared statements nomeados. Além delas, para o auth:

| Env | O quê |
|---|---|
| `SUPABASE_URL` | base do JWKS para validar o JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | a **secret** (`sb_secret_...`); SÓ servidor, nunca no frontend |
| `SUPABASE_JWT_SECRET` | opcional — só projetos antigos (HS256); projetos novos usam o JWKS |
| `CORS_ORIGINS` | domínio da Vercel |

Health check do Render: `/health`. Não use `/health/db` — ele toca no banco, e
Supabase indisponível viraria loop de restart.
