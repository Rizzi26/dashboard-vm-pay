-- Schema da ingestão VMpay.
--
-- Fica num schema próprio, fora de `public`. O Supabase só expõe via PostgREST
-- os schemas listados na configuração da API (por padrão public e
-- graphql_public), então `vmpay` não é alcançável pela chave anônima. O acesso
-- é só pelo FastAPI, com a connection string do Postgres.
--
-- NÃO adicione `vmpay` à lista de schemas expostos. O dashboard lê pelo backend.

create schema if not exists vmpay;

-- ---------------------------------------------------------------- cursores
--
-- A API não tem webhook e não agrega: a ingestão é polling incremental por id.
-- Uma linha por recurso, guardando o maior id já visto.

create table vmpay.sync_cursor (
    resource      text primary key,
    cursor_value  bigint      not null default 0,
    last_run_at   timestamptz,
    last_success  timestamptz,
    last_error    text,
    rows_ingested bigint      not null default 0
);

comment on table vmpay.sync_cursor is
    'Cursor por recurso. cursor_value é o maior id já ingerido; a próxima '
    'rodada pede transaction_id_greater_than/vend_id_greater_than a partir dele.';

-- ------------------------------------------------------------- dimensões
--
-- Vêm embutidas no payload das vendas (client, location, machine, good), então
-- são preenchidas pela própria ingestão — sem varrer os cadastros. O `raw`
-- guarda o objeto inteiro: a API pode acrescentar campo a qualquer momento e
-- não queremos perder dado por não ter previsto coluna.

create table vmpay.client (
    id         bigint primary key,
    name       text,
    raw        jsonb       not null default '{}'::jsonb,
    synced_at  timestamptz not null default now()
);

create table vmpay.location (
    id         bigint primary key,
    name       text,
    raw        jsonb       not null default '{}'::jsonb,
    synced_at  timestamptz not null default now()
);

create table vmpay.machine (
    id            bigint primary key,
    asset_number  text,
    model_id      bigint,
    model_name    text,
    raw           jsonb       not null default '{}'::jsonb,
    synced_at     timestamptz not null default now()
);

create table vmpay.good (
    id         bigint primary key,
    name       text,
    raw        jsonb       not null default '{}'::jsonb,
    synced_at  timestamptz not null default now()
);

-- ------------------------------------------------- fatos: transações cashless
--
-- `id` é o id da VMpay, não um serial nosso: é ele que dá idempotência à
-- ingestão. Reprocessar a mesma janela é seguro — o upsert não duplica.

create table vmpay.cashless_fact (
    id                        bigint primary key,
    occurred_at               timestamptz not null,
    status                    text,
    kind                      text,
    point_of_sale             text,
    place                     text,

    installation_id           bigint,
    planogram_item_id         bigint,
    equipment_id              bigint,
    equipment_label_number    text,
    equipment_serial_number   text,

    client_id                 bigint references vmpay.client (id),
    location_id               bigint references vmpay.location (id),
    machine_id                bigint references vmpay.machine (id),
    good_id                   bigint references vmpay.good (id),

    quantity                  numeric,
    value                     numeric(14, 4),
    discount_value            numeric(14, 4),
    cost_price                numeric(14, 4),
    number_of_payments        integer,

    eft_provider_name         text,
    eft_authorizer_name       text,
    eft_card_brand_name       text,
    eft_card_type_name        text,

    uuid                      text,
    request_number            text,
    order_id                  bigint,
    physical_locator          text,
    cashless_error_friendly   text,

    -- O payload inteiro, sempre. Coluna nova depois se preenche a partir daqui,
    -- sem precisar reprocessar a API.
    payload                   jsonb       not null,
    ingested_at               timestamptz not null default now()
);

comment on column vmpay.cashless_fact.status is
    'A doc não enumera os valores; o exemplo oficial mostra OK e CANCEL. '
    'Somar `value` sem filtrar status infla o faturamento — use vmpay.sale.';

create index cashless_fact_occurred_at_idx
    on vmpay.cashless_fact (occurred_at desc);
create index cashless_fact_machine_occurred_idx
    on vmpay.cashless_fact (machine_id, occurred_at desc);
create index cashless_fact_location_occurred_idx
    on vmpay.cashless_fact (location_id, occurred_at desc);
create index cashless_fact_status_idx
    on vmpay.cashless_fact (status) where status is distinct from 'OK';

-- ------------------------------------------------------------ fatos: vendas
--
-- /vends é a visão por item vendido; /cashless_facts é a visão por transação de
-- pagamento. Não são a mesma coisa e nenhuma substitui a outra: venda em
-- dinheiro não aparece em cashless, e transação cancelada não vira venda.

create table vmpay.vend (
    id                 bigint primary key,
    occurred_at        timestamptz not null,
    client_id          bigint references vmpay.client (id),
    location_id        bigint references vmpay.location (id),
    machine_id         bigint references vmpay.machine (id),
    installation_id    bigint,
    planogram_item_id  bigint,
    good_id            bigint references vmpay.good (id),
    audit_id           bigint,
    coil               text,
    quantity           numeric,
    value              numeric(14, 4),
    payload            jsonb       not null,
    ingested_at        timestamptz not null default now()
);

create index vend_occurred_at_idx on vmpay.vend (occurred_at desc);
create index vend_machine_occurred_idx on vmpay.vend (machine_id, occurred_at desc);
create index vend_good_occurred_idx on vmpay.vend (good_id, occurred_at desc);

-- ------------------------------------------------------------------- views

-- Transação que de fato virou dinheiro. Todo cálculo de faturamento parte daqui,
-- nunca de cashless_fact direto.
create view vmpay.sale as
select *
  from vmpay.cashless_fact
 where status = 'OK';

comment on view vmpay.sale is
    'cashless_fact filtrado por status OK. Existe para que ninguém some valor '
    'de transação cancelada por esquecimento.';

create view vmpay.daily_sales as
select date_trunc('day', s.occurred_at)      as day,
       s.machine_id,
       s.location_id,
       count(*)                              as transactions,
       sum(s.value)                          as revenue,
       sum(coalesce(s.discount_value, 0))    as discounts,
       sum(coalesce(s.cost_price, 0))        as cost
  from vmpay.sale s
 group by 1, 2, 3;

create view vmpay.sync_status as
select c.resource,
       c.cursor_value,
       c.rows_ingested,
       c.last_run_at,
       c.last_success,
       c.last_error,
       now() - c.last_success as since_last_success
  from vmpay.sync_cursor c;

-- Semeia os recursos que a ingestão conhece. O nome do filtro de cursor de cada
-- um está em CURSORS, em apps/mcp/src/vmpay_mcp/catalog.py.
insert into vmpay.sync_cursor (resource) values ('cashless_facts'), ('vends')
on conflict (resource) do nothing;
