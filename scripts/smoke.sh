#!/usr/bin/env bash
# Smoke test da API VMpay. O token NUNCA aparece no script nem no output.
# Uso:
#   export VMPAY_TOKEN='seu-token'          # ou: read -rs VMPAY_TOKEN && export VMPAY_TOKEN
#   ./smoke.sh
set -euo pipefail

: "${VMPAY_TOKEN:?defina VMPAY_TOKEN no ambiente antes de rodar}"
BASE="${VMPAY_BASE:-https://vmpay.vertitecnologia.com.br/api/v1}"

call() { # call <recurso> [query extra]
  local path="$1" extra="${2:-}"
  local code
  code=$(curl -sS -o /tmp/vmpay.out -w '%{http_code}' \
    --get "$BASE/$path" \
    --data-urlencode "access_token=$VMPAY_TOKEN" \
    ${extra:+--data-urlencode "$extra"})
  printf '%-28s HTTP %s  ' "$path" "$code"
  if [ "$code" = 200 ]; then
    python3 -c 'import json,sys; d=json.load(open("/tmp/vmpay.out")); print(f"{len(d)} registro(s)" if isinstance(d,list) else "objeto")'
  else
    head -c 200 /tmp/vmpay.out; echo
  fi
}

echo "== auth / conectividade =="
call categories 'per_page=1'

echo
echo "== cadastros =="
call machines      'per_page=3'
call products      'per_page=3'
call clients       'per_page=3'
call locations     'per_page=3'

echo
echo "== relatorios =="
call installations 'per_page=3'
call cashless_facts 'transaction_id_greater_than=0'
