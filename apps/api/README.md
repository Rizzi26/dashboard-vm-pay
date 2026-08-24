# vmpay-api

Backend FastAPI: ingere da VMpay para o Supabase e serve os agregados que o
dashboard consome. Roda no Render.

## Por que existe

A API da VMpay não agrega nada — todo relatório é lista crua paginada, no máximo
1000 por request, limitada a 300 req/min por token. Um painel de 12 meses seriam
dezenas de milhares de chamadas. Então: ingerimos uma vez, agregamos no Postgres.

## Duas metades

**Ingestão** (`ingest.py`, roda como cron job) traz o que é novo por cursor de id
e grava em lote. Duas garantias que valem o código a mais:

- **Idempotência** — a chave primária é o id da VMpay e a gravação é upsert.
  Reprocessar a mesma janela não duplica linha, e correção do fornecedor chega.
- **O cursor só avança com o dado já gravado**, na mesma transação. Queda no meio
  faz a próxima rodada reprocessar o último lote, nunca pular.

**API web** (`main.py`) expõe os agregados. Toda leitura de faturamento parte da
view `vmpay.sale`, que já exclui transação cancelada — somar `cashless_fact`
direto infla o número.

## Rodar local

```bash
uv venv && uv pip install -e ".[dev]"
cp .env.example .env      # preencha DATABASE_URL e VMPAY_INGEST_TOKEN
.venv/bin/uvicorn vmpay_api.main:app --reload
```

Uma rodada de ingestão:

```bash
.venv/bin/vmpay-ingest
```

## Endpoints

| Rota | O que devolve |
|---|---|
| `GET /health` | Vivo. Não toca no banco — é o health check do Render. |
| `GET /health/db` | Vivo e com banco. Separado de propósito: Supabase fora não deve virar loop de restart. |
| `GET /sales/summary` | Faturamento, transações, ticket médio do período. |
| `GET /sales/daily` | Série diária. |
| `GET /sales/by-machine` | Ranking de máquinas. |
| `GET /sales/sync-status` | Frescor do dado. Sem isto, worker parado passa por dia fraco. |

Janela padrão: últimos 30 dias. `start` e `end` são inclusivos.

## Testes

```bash
.venv/bin/pytest
```

32 testes, sem banco: o mapeamento do payload é função pura, e a ingestão roda
contra uma sessão falsa que registra *quando* o cursor avança — que é a parte que
pode dar errado em silêncio.
