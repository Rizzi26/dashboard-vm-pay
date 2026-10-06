# vm-pay

Integração com a **API VMpay** (Nayax / Verti Tecnologia): servidor MCP +
dashboard. Remote: `git@github.com:Rizzi26/dashboard-vm-pay.git` (a pasta local
chama `vm-pay`).

## Leia primeiro

- [`docs/api-reference.md`](docs/api-reference.md) — a API destilada. **Consulte
  antes de escrever qualquer chamada.**
- [`docs/architecture.md`](docs/architecture.md) — decisões tomadas e por quê.
- [`docs/deploy.md`](docs/deploy.md) — onde cada peça roda, secrets, e as
  armadilhas de repositório público.
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

## O produto

Plataforma **white-label** de gestão para operadores de autosserviço. A VMpay é
o primeiro *conector*; o domínio canônico (schema `core`: organizações, papéis,
produtos, locais, estoque, movimentos, action_log) não sabe o que é planograma.
Papéis por organização: viewer (leitura/export), admin (+ações de operação),
master (+usuários); superadmin de plataforma fora da hierarquia. Detalhes em
docs/architecture.md.

## Estrutura

```
packages/vmpay/     cliente Python compartilhado — toda quirk da API mora aqui
apps/mcp/           servidor MCP (catálogo extraído da doc + guardrails)
apps/api/           FastAPI no Render — auth/RBAC, ingestão, ações, agregação
apps/web/           Next.js na Vercel — login, vendas, estoque, usuários
supabase/           migrations (schemas `vmpay` e `core`) + seed-poc.sql
```

O caminho do dado é sempre o mesmo: **VMpay → worker → Supabase → FastAPI →
Next.js**. O dashboard nunca fala com a VMpay, e nada além do FastAPI fala com o
Postgres. Ações fazem o caminho inverso: FastAPI → conector → VMpay, sempre
passando pelo action_log.

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

**Os schemas `core` e `vmpay` ficam FORA do PostgREST.** É o que impede a
chave anônima do Supabase de alcançar qualquer dado. O frontend lê tudo pelo
FastAPI, autenticado.

**Papel se resolve no banco, nunca em claim do JWT.** O guard é `require_role`
sobre `core.membership`; a UI apenas esconde botão — segurança é no servidor.

**Toda ação passa pelo action_log**, com o registro pendente commitado ANTES do
write-back. Não crie caminho de escrita que fale com a VMpay sem passar por ele.

**Não edite catalog.json nem o schema na mão em produção** — migrations novas
em `supabase/migrations/`, numeradas, validadas com pglast antes de aplicar.

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

**V1 EM PRODUÇÃO desde 2026-08-25**, com dados reais e reconciliação fechando
no centavo:

- Frontend: https://dashboard-vm-pay.vercel.app (Vercel, root `apps/web`)
- API: https://vmpay-api.onrender.com (Render, Docker via `render.yaml`, Ohio)
- Banco: Supabase `bjmcakvubmggwqkigfle` (schemas `core`+`vmpay`, Data API OFF)
- Ingestão: GitHub Actions de hora em hora (desde 2026-08-29; antes 3× ao
  dia); histórico completo desde o go-live do mercadinho (06/11/2025)
- **Escrita na VMpay TRAVADA** em produção (`VMPAY_ALLOW_WRITES=0` no Render)
  até ser provada em homologação
- **Homologação** (desde 2026-10-05): Supabase `vmpay-hml`, Render
  `vmpay-api-hml` (branch `homolog`, escrita ligada, VMpay demo), Preview da
  Vercel na `homolog`. Detalhes e armadilhas em docs/deploy.md

Validação de integridade (2026-08-25): soma dos vends = faturamento cashless
OK = R$ 116.320,15; 15.612 transações − 1.626 não-OK = 13.986 vends exatos.
O kiosk é 100% cashless, um item por transação.

## Roadmap V1.1 (dados já no banco; nada toca a ingestão)

1. ~~**Painel de vendas perdidas**~~ — FEITO (rota `/sales/lost` + página /perdidas).
2. ~~**Visão por produto no painel**~~ — FEITO (ficha /produto/{id} via vends).
2b. ~~**Cadastro de produto**~~ — FEITO: `POST /orgs/{org}/products` cria na
   VMpay (envelope `product`; exige manufacturer/category/supply_category, as
   opções vêm ao vivo de `GET /orgs/{org}/products/refs`) e espelha em
   core.product + product_link. Mesmo action_log e mesma trava
   VMPAY_ALLOW_WRITES das outras ações. Cadastro ≠ prateleira: entrar no
   planograma continua manual na VMpay — a UI avisa.
3. Preço unitário de item com saldo zero — a fonte exata é o
   `current_planogram` da instalação (uma chamada por instalação no snapshot);
   hoje deriva do valor total do relatório de saldos e fica nulo com saldo 0.
4. Rotação da `sb_secret` vazada no primeiro deploy da Vercel — CONFERIR se o
   Revoke + chave nova no Render foi concluído.
5. ~~**Histórico de estoque + quebras**~~ — FEITO (2026-08-29):
   `core.stock_snapshot` (migration 0004, append-only, só linha que mudou;
   primeira rodada ancora tudo). `/stock/history/{product_id}` alimenta o
   gráfico em degraus na ficha do produto. A **página /quebras foi
   descontinuada** no mesmo dia (feedback: confusa) — o endpoint
   `/stock/quebras` (agregado por produto) segue no ar sem UI, e o dado
   continua acumulando para quando a tela voltar.
6. ~~**Reposição**~~ — FEITO (2026-08-29): `/stock/reposicao` cruza saldo com
   ritmo de venda (30d) → página /reposicao em duas seções (Zerados /
   Acabando), insight em linguagem corrida, export CSV
   (`/stock/reposicao/export.csv`). Saldo negativo (oversell de planograma na
   VMpay) é tratado como zerado.
7. ~~**Sincronizar sob demanda**~~ — FEITO (2026-08-29): `POST
   /orgs/{org}/stock/sync` (admin, cooldown 120s, BackgroundTasks) + botão
   Atualizar no /estoque. **Depende de `VMPAY_INGEST_TOKEN` no Render** —
   sem a env o endpoint devolve 503 explicando.
9. **Pick list** (EM HOMOLOGAÇÃO, 2026-10-05): entrada de estoque pelo cupom
   fiscal de compra (NFC-e SP). `apps/api/.../nfce.py` lê a página do **QR
   Code** (sem CAPTCHA; a consulta só pela chave tem CAPTCHA → lançamento
   manual). A URL colada nunca é requisitada como veio — só o `p`, contra host
   fixo (anti-SSRF). Aprovação = restock (`preparar_restock`/`executar_restock`)
   com o cupom no mesmo commit do action_log; de-para por (CNPJ emitente,
   código do item) com fator de conversão. Migration 0005. Custo fora do
   escopo por decisão. A fixture de teste é anonimizada — repo público.
11. **Lojista = organização; loja = core.location** (2026-10-06). Home `/` é a
   Central das lojas (`GET /orgs/{org}/lojas`); a loja escolhida na barra vai
   num cookie e filtra Vendas/Perdas/Estoque/Reposição. Vendas são amarradas à
   organização pelas MÁQUINAS dos locais (`MAQUINAS_DA_ORG` em sales.py) — o
   staging vmpay.* não tem coluna de organização; é esse filtro que separa um
   lojista de outro. Ingestão ainda é de token único: o 2º lojista com conta
   VMpay própria exige ingestão por integração.
12. **Auditoria** (2026-10-06, master): `core.audit_event` (migration 0006) +
   `core.action_log`, numa linha do tempo em `/auditoria`. O login é
   registrado pela API na 1ª requisição de cada `session_id` do JWT (o
   Supabase do projeto não grava histórico de auth no banco). Ação nova que
   importe para auditoria: `audit.registrar(...)` na rota.
8. Migrations são **automáticas** (migrate.yml): push na `homolog` aplica no
   banco de homologação, push na `main` no de produção — só os arquivos que
   faltam em `core.schema_migration`, cada um numa transação com o próprio
   registro; sem pendência, não faz nada. Migration tem de ser ADITIVA (o
   deploy do código corre em paralelo). Nenhuma máquina local guarda
   credencial do banco.
10. **Atualizar dados** (2026-10-06): botão na barra (`POST /orgs/{org}/sync`,
   qualquer papel, intervalo mínimo 120s, uma rodada por vez) roda a mesma
   ingestão do cron. O cron é horário no papel, mas o Actions roda a cada
   3–6h na prática — o botão existe por isso.

O catálogo do MCP cobre bem os recursos que a doc documenta bem. `audits`,
`storables` e as tabelas de domínio têm pouca descrição na origem — o extrator
não inventa o que a doc não diz.
