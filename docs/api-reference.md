# VMpay API v1 — referência destilada

Destilado da documentação oficial (Sphinx offline, © Verti Tecnologia / Nayax),
baixada do portal VMpay em Configurações → Chaves de Operador → Documentação API.

- Doc original navegável: `vendor/doc_api/index.html`
- Mesma doc em texto puro (grepável): `vendor/doc_api.txt`
- Os 176 endpoints com arquivo de origem: `endpoints.txt`
- Manual de acesso/geração de token: `vendor/manual-acesso-nayax.pdf`

## Básico

- **Base URL (produção):** `https://vmpay.vertitecnologia.com.br/api/v1`
- **Homologação:** existe, token **diferente** do de produção — pedir ao suporte.
  As bases não sincronizam; popular as duas é responsabilidade do operador.
- **Formato:** REST/JSON.
- **Modelo:** VMpay é agente *passivo* — nunca chama você. Não há webhook; todo
  polling parte do nosso lado.

## Autenticação

Token na **query string**, em toda requisição:

    GET /api/v1/categories?access_token=SEU_TOKEN

Não há header `Authorization`. Consequências práticas:
- o token vaza em log de proxy/CDN e em histórico de shell — cuidado com `curl` sem `--data-urlencode`;
- rotação é manual: gerar chave nova em Configurações → Chaves de Operador (perfil Administrador), trocar, revogar a antiga.

**Operadores filhos:** sufixo `@id_filho` no próprio token —
`?access_token=TOKEN@id_filho`. Precisa ser habilitado pelo suporte
(integracoes@nayax.com). Os ids vêm de `GET /operator_childrens`.

## Paginação

- `page` (default 1), `per_page` (default 100, **máx 1000**; acima disso → 400).
- Não há header de total nem cursor. **Última página = quando o retorno vier com
  menos registros que `per_page`.**

## Rate limit

- **300 req/min por access_token.** Estouro → `429` com body `{"error": "Too many requests"}`.
- Recomendações da própria doc: `per_page` alto em vez de muitas chamadas pequenas,
  evitar polling agressivo, backoff progressivo no 429, cache do que muda pouco,
  e agrupar escritas numa requisição só (ex.: planogramas).

## Códigos de retorno

| Código | Significado |
|---|---|
| 200 | Sucesso / entidade salva |
| 201 | Entidade criada |
| 204 | Entidade excluída |
| 400 | Parâmetro obrigatório faltando ou formato errado (inclui `per_page` > 1000 e data inválida) |
| 401 | Token inválido ou ausente |
| 404 | Entidade não encontrada |
| 409 | Conflito |
| 422 | Erro de validação |
| 429 | Rate limit |

## Datas

Filtros `start_date` / `end_date` aceitam `dd/mm/yyyy hh:mi:ss` (**em UTC**) ou
ISO 8601. Hora é obrigatória na prática — se omitida assume `00:00 UTC`.
Formato inválido → 400.

## Ingestão incremental (o caminho recomendado)

Para vendas cashless, **não** paginar por data. Usar o cursor por id:

    GET /cashless_facts?transaction_id_greater_than=<ultimo_id_visto>

A cada rodada guarda o maior `id` retornado e usa na próxima. `start_date`/`end_date`
são **ignorados** quando esse parâmetro é passado. A doc sugere intervalo de ~10 min.
`GET /vends` tem o equivalente: `vend_id_greater_than`.

## Mapa de recursos

### Relatórios (somente leitura)
| Recurso | Endpoint |
|---|---|
| Vendas | `GET /vends` — filtros: datas, client_id, location_id, machine_id, installation_id, category_id, manufacturer_id, good_id, audit_id, `vend_id_greater_than` |
| Transações cashless (Novo) | `GET /cashless_facts` — ~20 filtros + `transaction_id_greater_than` |
| Transações cashless (legado) | `GET /cashless_transactions`, `GET /cashless_sales` |
| Notas fiscais | `GET /invoices`, `/invoices/[id]/sat_data`, `/invoices/[id]/sat_data_pdf` |
| Instalações | `GET /installations` |
| Saldos das instalações | `GET /installation_stock_balances` |
| Planogramas (links) | `GET /planograms/export_links`, `GET /planograms/[id]/export` |
| Pick lists | `GET /pick_lists`, `GET /pick_lists/[id]`, `GET /pick_list_items` |
| Caixas / giro de caixa | `GET /sessions`, `/sessions/[id]`, `GET /working_sessions` |
| Visitas | `GET /visits` |
| Rupturas | `GET /ruptures` |
| Alertas | `GET /alerts` |
| Abertura de portas | `GET /door_accesses` |
| Ativos | `GET /device_configs` |
| Canaletas ignoradas | `GET /ignored_coils` |
| Seleções disponíveis | `GET /available_selections` |
| Usuários VMmarket | `GET /market_users` — filtros por created_at/updated_at + `sort_column`/`sort_direction` |
| Movimentos dos CDs | `GET /distribution_center_inventories` |

### Cadastros (CRUD completo: GET lista, GET /[id], POST, PATCH /[id], DELETE /[id])
`categories` · `clients` · `locations` · `machines` · `manufacturers` · `products`
(+ `PATCH /products/[id]/reactivate`) · `vendibles` · `compound_products` ·
`fractionable_products` · `inputs` · `packings` · `routes` · `supply_categories` ·
`tax_operations` · `scheduled_visits` (+ `complete` / `undo_complete`) ·
`distribution_centers`

Somente leitura: `units`, `no_vend_schedules`, `scheduled_visit_checkpoints`
(+ `/adjust`, `/confirm`), `storables` (GET + PATCH).

### Aninhados em máquina/instalação
Prefixo `/machines/[machine_id]/installations/[installation_id]`:

- `installations` (CRUD) + `POST .../restock`
- `virtual_installations` (CRUD) + `restock` — sob `/machines/[machine_id]`
- `planograms` (CRUD) · `current_planogram` (GET, PATCH) ·
  `POST .../create_from_current_planogram`
- `audits` (GET lista, GET /[id], GET /[id].txt, `last_audit`)
- `inventory_adjustments` (GET, POST)
- `pick_lists` (CRUD) — o comportamento de status muda conforme a estratégia
  configurada: Padrão / ERP Interno / ERP Externo (três páginas distintas na doc)
- `external_efts` (POST) — lançar transação cashless externa
- `remote_commands` (GET, POST)

### Tabelas de domínio (`info/`, somente leitura)
`equipments` · `machine_types` · `machine_models` · `machine_manufacturers` ·
`store_models` · `eft_providers` · `eft_authorizers` · `eft_card_brands` ·
`eft_card_types` · `payment_authorizers` · `returned_amount_types` ·
`operator_childrens`

## Pegadinhas anotadas na doc

- **Estoque de máquina não tem endpoint próprio.** Ajustes e reabastecimentos
  atualizam o *último planograma*; o estoque atual se lê pela API de planograma.
- **Estoque de CD** (`storables`) exige que o suporte habilite controle de estoque
  para o operador.
- `audit_id` em vendas só é preenchido a partir de **09/10/2021**; vendas anteriores vêm sem.
- `GET /vends` vem ordenado por data **decrescente** — paginar por data com dados
  chegando em tempo real pula registros. Por isso o cursor por id.
- Operadores filhos e pick list por ERP externo precisam de habilitação do suporte.

## Suporte

integracoes@nayax.com · WhatsApp +55 41 99212-8602 · +55 (41) 3338-0044
