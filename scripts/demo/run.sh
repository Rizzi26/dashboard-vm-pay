#!/usr/bin/env bash
# Modo demo: frontend real + stubs de Supabase Auth e backend. Sem credenciais.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

for port in 9999 8123 3210; do
  if lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "porta $port já está em uso — derrube o processo antes (lsof -i :$port)" >&2
    exit 1
  fi
done

cleanup() { kill 0 2>/dev/null; }
trap cleanup EXIT INT TERM

python3 "$DIR/stub_supabase.py" &
python3 "$DIR/stub_backend.py" &
sleep 1

echo
echo "──────────────────────────────────────────────────────"
echo "  Painel:  http://localhost:3210"
echo "  master:  master@mercadinho.dev / senha-master"
echo "  viewer:  viewer@mercadinho.dev / senha-viewer"
echo "  Ctrl+C encerra tudo."
echo "──────────────────────────────────────────────────────"
echo

cd "$ROOT/apps/web"
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9999 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key \
API_URL=http://127.0.0.1:8123 \
NEXT_PUBLIC_API_URL=http://127.0.0.1:8123 \
exec pnpm dev --port 3210
