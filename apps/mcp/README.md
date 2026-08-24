# vmpay-mcp

Servidor MCP da API VMpay.

## Desenho

A API tem ~160 operações. Uma tool por operação afogaria o modelo na lista, então
a superfície aqui é pequena e genérica:

| Tool | O que faz |
|---|---|
| `vmpay_catalog` | Lista os recursos. Comece aqui quando não souber o nome. |
| `vmpay_describe` | Filtros, campos obrigatórios e envelope de um recurso. |
| `vmpay_list` | Lista registros, já paginando por baixo. |
| `vmpay_get` | Busca por id. |
| `vmpay_create` · `vmpay_update` · `vmpay_delete` · `vmpay_action` | Escrita. |
| `vmpay_remote_command` | Comando na máquina física. |

O que o modelo não sabe — quais recursos existem, quais filtros cada um aceita,
que `POST /products` quer o corpo dentro de `{"product": {...}}` — vem do
catálogo, consultável por tool. O catálogo é **extraído da doc oficial**, não
digitado: `python3 tools/build_catalog.py` regenera a partir de
`docs/vendor/doc_api`. Rode de novo quando a Nayax publicar doc nova.

## Níveis de permissão

Três interruptores, do mais barato ao mais caro de errar. **Uma tool não liberada
não é registrada** — o modelo não vê o que não pode usar, o que funciona melhor
que registrar e recusar depois.

| Variável | Libera |
|---|---|
| *(nenhuma)* | Leitura. |
| `VMPAY_ALLOW_WRITES=1` | Cadastros, planogramas, pick lists. |
| `VMPAY_ALLOW_MACHINE_OPS=1` | Estoque e máquina física. Exige o anterior. |

Além disso:

- **Escrita exige `VMPAY_BASE` declarado.** A doc não publica a URL de
  homologação — ela vem do suporte da Nayax. Sem um default seguro para apontar,
  o jeito de não escrever em produção por distração é exigir que o ambiente seja
  dito em voz alta. Com `VMPAY_ALLOW_WRITES=1` e sem `VMPAY_BASE`, o servidor
  sobe somente-leitura e avisa no log.
- **Destrutivo exige eco.** `vmpay_delete` e `vmpay_remote_command` pedem um
  parâmetro `confirmar` com o identificador do alvo. Um id errado vira recusa em
  vez de estrago.

## Configuração

```bash
cd apps/mcp && uv venv && uv pip install -e ".[dev]"
```

No `.mcp.json` do projeto ou na config do cliente MCP:

```json
{
  "mcpServers": {
    "vmpay": {
      "command": "uv",
      "args": ["run", "--directory", "/caminho/para/vm-pay/apps/mcp", "vmpay-mcp"],
      "env": { "VMPAY_TOKEN": "..." }
    }
  }
}
```

Para liberar escrita em homologação, acrescente ao `env`:

```json
{ "VMPAY_BASE": "https://<homologacao>/api/v1", "VMPAY_ALLOW_WRITES": "1" }
```

O token vai na query string em toda chamada — é assim que a API funciona, não há
header `Authorization`. Toda URL passa por redaction antes de virar log ou
mensagem de erro, mas **não coloque o token em arquivo versionado**.

## Testes

```bash
.venv/bin/pytest
```

Cobrem os guardrails (níveis, confirmação, caminho aninhado), o envelope do
corpo, o cursor de paginação e a garantia de que o token não vaza em erro.
