# vm-pay

Integração com a **API VMpay** (Nayax / Verti Tecnologia): servidor MCP + dashboard.

## Estado

- [x] Documentação consolidada
- [x] `packages/vmpay` — cliente Python compartilhado (15 testes)
- [x] [`apps/mcp`](apps/mcp) — servidor MCP (28 testes)
- [ ] `apps/api` — FastAPI no Render (ingestão + agregação)
- [ ] `apps/web` — Next.js na Vercel
- [ ] `supabase/` — schema

Decisões de arquitetura em [docs/architecture.md](docs/architecture.md).

## Cliente Python

```python
from vmpay import VMpayClient

async with VMpayClient.from_env() as vm:            # lê VMPAY_TOKEN
    async for venda in vm.iter_since(
        "cashless_facts", cursor_param="transaction_id_greater_than", since_id=ultimo
    ):
        ...
```

Ele resolve as quirks da API num lugar só: token na query com redaction em log e
exceção, balde de 300 req/min com reposição contínua, retry com backoff só no que
é transitório (429 e 5xx), paginação que sabe reconhecer a última página, e cursor
incremental que avança pelo maior id do lote — não pelo último, já que a API não
garante ordem crescente.

```bash
cd packages/vmpay && uv venv && uv pip install -e ".[dev]" && .venv/bin/pytest
```

## Servidor MCP

Nove tools genéricas sobre as ~160 operações da API, com o catálogo de recursos
extraído da doc oficial e três níveis de permissão — leitura por padrão, escrita
e operação em máquina só com interruptor explícito. Detalhes em
[apps/mcp/README.md](apps/mcp/README.md).

```bash
cd apps/mcp && uv venv && uv pip install -e ".[dev]" && .venv/bin/pytest
```

## Documentação

| Arquivo | O que é |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Contexto que o Claude lê a cada sessão nova. |
| [docs/api-reference.md](docs/api-reference.md) | **Comece aqui.** Auth, paginação, rate limit, mapa dos recursos, pegadinhas. |
| [docs/endpoints.txt](docs/endpoints.txt) | Os 176 endpoints, com o arquivo de origem de cada um. |
| [docs/vendor/COMO-OBTER.md](docs/vendor/COMO-OBTER.md) | Como baixar a doc oficial do portal — ela **não** é versionada. |

A documentação oficial da VMpay é da Verti Tecnologia / Nayax e fica fora do git,
já que este repositório é público. Nada aqui depende dela: a destilação, a lista
de endpoints e o catálogo do MCP são derivados versionados. Ela só é necessária
para regenerar o catálogo.

## Resumo de 30 segundos

- Base: `https://vmpay.vertitecnologia.com.br/api/v1`
- Auth: `?access_token=...` na **query string** — não há header `Authorization`.
- Limite: **300 req/min por token**; estouro devolve `429`.
- Paginação: `page` + `per_page` (máx 1000), sem total nem cursor —
  acabou quando o retorno vier menor que `per_page`.
- Sem webhook. VMpay é passivo; o polling é nosso.
- Ingestão de vendas: cursor por id (`transaction_id_greater_than` em
  `/cashless_facts`), **não** janela de data.

## Testar um token

O token nunca deve ir para o histórico de shell nem para um arquivo versionado.

```bash
read -rs VMPAY_TOKEN && export VMPAY_TOKEN && ./scripts/smoke.sh
```

## Suporte do fornecedor

integracoes@nayax.com · WhatsApp +55 41 99212-8602 · +55 (41) 3338-0044
