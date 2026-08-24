# Documentação oficial da VMpay

Esta pasta fica **fora do git**. O conteúdo é da Verti Tecnologia / Nayax, e este
repositório é público — redistribuir doc de terceiro aqui não é nosso direito.

O que falta em um clone novo:

```
docs/vendor/doc_api/                 doc oficial em HTML (Sphinx, offline)
docs/vendor/doc_api.txt              a mesma doc em texto puro, grepável
docs/vendor/manual-acesso-nayax.pdf  manual de acesso e geração de token
```

## Você precisa disso?

Na maior parte do tempo, **não**:

- [`docs/api-reference.md`](../api-reference.md) é a destilação e está versionada;
- [`docs/endpoints.txt`](../endpoints.txt) tem os 176 endpoints;
- `apps/mcp/src/vmpay_mcp/catalog.json` é derivado e também está versionado — o
  servidor MCP funciona sem esta pasta.

Só precisa repopular para **regenerar o catálogo** (`build_catalog.py`) ou para
consultar detalhe que a destilação não cobre.

## Como repopular

1. Entre no portal VMpay com um usuário de perfil **Administrador**.
2. **Configurações → Chaves de Operador**.
3. Botão **Documentação API**, no canto superior direito.
4. O download vem como `Operator Keys API.zip` — o nome muda, o manual chama de
   `doc_api.zip`.
5. Descompacte o conteúdo em `docs/vendor/doc_api/` (o `index.html` tem que ficar
   em `docs/vendor/doc_api/index.html`).

Para regenerar o texto puro:

```bash
python3 apps/mcp/tools/build_catalog.py   # regenera o catalog.json
```

## Não há espelho público

`vmpay-api.readthedocs.io` existe, mas é uma casca vazia: nenhuma página de
conteúdo e copyright de 2023. A doc atual (2026, com `cashless_facts`) só sai
pelo portal. Não tente sincronizar de lá.

## Suporte

integracoes@nayax.com · WhatsApp +55 41 99212-8602 · +55 (41) 3338-0044
