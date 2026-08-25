# Modo demo

Sobe o painel completo **sem credencial nenhuma** — sem Supabase, sem Postgres,
sem token da VMpay. Dois stubs fazem os papéis:

- `stub_supabase.py` (porta 9999) — o mínimo do Supabase Auth: login por senha,
  getUser, logout. Emite JWT HS256 de mentira.
- `stub_backend.py` (porta 8123) — o FastAPI com dados plausíveis: vendas de 30
  dias, estoque de 3 produtos, membros. As ações (reabastecer, preço, convite)
  mutam o estado em memória, então a UI reage de verdade.

O que você vê é o **frontend real** contra dados falsos. A lógica real do
backend tem 81 testes próprios; o e2e contra Supabase/Postgres reais acontece
quando os projetos estiverem conectados.

## Rodar

```bash
./scripts/demo/run.sh
```

Abra http://localhost:3210 e entre com:

| Papel | Email | Senha |
|---|---|---|
| master | `master@mercadinho.dev` | `senha-master` |
| viewer | `viewer@mercadinho.dev` | `senha-viewer` |

O master vê ações (reabastecer/preço) e a página Usuários; o viewer só lê e
exporta. Ctrl+C derruba os três processos.
