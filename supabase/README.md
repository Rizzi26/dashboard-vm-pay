# Supabase

Postgres da ingestão. As tabelas ficam no schema `vmpay`, **não** em `public`.

## Por que schema próprio

O Supabase só expõe via PostgREST os schemas listados na configuração da API
(por padrão `public` e `graphql_public`). Com as tabelas em `vmpay`, a chave
anônima não alcança dado de venda — o acesso é só pelo FastAPI, com a connection
string do Postgres.

**Não adicione `vmpay` à lista de schemas expostos.** O dashboard lê pelo backend.

## Aplicar

Pelo SQL Editor do painel, ou:

```bash
psql "$DATABASE_URL" -f migrations/0001_init.sql
```

## O que o schema tem

- `sync_cursor` — uma linha por recurso, com o maior id já ingerido
- `client`, `location`, `machine`, `good` — dimensões, preenchidas a partir do
  payload das próprias vendas (vêm aninhadas ali, o que poupa varrer os cadastros)
- `cashless_fact`, `vend` — os fatos, com `payload jsonb` guardando o retorno
  inteiro para nenhum campo novo do fornecedor se perder
- `sale` — view de `cashless_fact` filtrada por `status = 'OK'`

Essa última view existe por um motivo específico: `status` vem `OK` ou `CANCEL`, e
somar `value` sem filtrar infla o faturamento. Todo cálculo parte de `sale`.
