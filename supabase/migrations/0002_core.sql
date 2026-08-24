-- Domínio canônico (white-label).
--
-- `vmpay` é staging do conector; `core` é o que o produto entende: organizações,
-- papéis, produtos, locais, estoque, movimentos e ações. A VMpay é o primeiro
-- conector a alimentar este schema — outros sistemas (ou entrada manual) chegam
-- pelo mesmo caminho sem tocar nas tabelas daqui.
--
-- Como `vmpay`, o schema `core` NÃO entra na lista de schemas expostos do
-- PostgREST. Todo acesso é pelo FastAPI, que valida o JWT do Supabase Auth e
-- aplica papel/organização. A chave anônima não alcança nada disto.

create schema if not exists core;

-- -------------------------------------------------------------- organizações

create table core.organization (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    slug        text not null unique,
    created_at  timestamptz not null default now()
);

comment on table core.organization is
    'O tenant. O mercadinho de condomínio é a primeira; cada operador é uma.';

-- Papéis por organização. viewer lê e exporta; admin executa ações de operação
-- (estoque, preço); master gerencia usuários por cima disso.
create type core.member_role as enum ('viewer', 'admin', 'master');

create table core.membership (
    user_id     uuid not null references auth.users (id) on delete cascade,
    org_id      uuid not null references core.organization (id) on delete cascade,
    role        core.member_role not null default 'viewer',
    created_at  timestamptz not null default now(),
    primary key (user_id, org_id)
);

create index membership_org_idx on core.membership (org_id);

-- Superadmins da plataforma (nós). Fora da hierarquia das organizações e
-- invisível para os clientes: age como master em qualquer organização.
create table core.platform_admin (
    user_id     uuid primary key references auth.users (id) on delete cascade,
    created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- integrações

create table core.integration (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid not null references core.organization (id) on delete cascade,
    kind        text not null,
    config      jsonb not null default '{}'::jsonb,
    active      boolean not null default true,
    created_at  timestamptz not null default now()
);

comment on table core.integration is
    'Conector de um sistema externo para uma organização. kind=vmpay por ora.';
comment on column core.integration.config is
    'NUNCA guarda segredo. Para a VMpay: {"token_env": "NOME_DA_ENV_VAR"} — o '
    'valor vive no ambiente do worker. Migrar para Vault quando houver mais de '
    'um tenant não muda este schema.';

create index integration_org_idx on core.integration (org_id);
create index integration_active_idx on core.integration (kind) where active;

-- ------------------------------------------------------- produtos e vínculos
--
-- O produto canônico é separado do vínculo com o sistema externo: um produto
-- pode estar ligado a mais de um sistema no futuro, e um conector novo não
-- altera a tabela canônica.

create table core.product (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid not null references core.organization (id) on delete cascade,
    name        text not null,
    barcode     text,
    category    text,
    unit_price  numeric(14, 4),
    cost_price  numeric(14, 4),
    active      boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index product_org_idx on core.product (org_id);

create table core.product_link (
    product_id      uuid not null references core.product (id) on delete cascade,
    integration_id  uuid not null references core.integration (id) on delete cascade,
    external_id     text not null,
    raw             jsonb not null default '{}'::jsonb,
    synced_at       timestamptz not null default now(),
    primary key (integration_id, external_id)
);

create index product_link_product_idx on core.product_link (product_id);

-- --------------------------------------------------------- locais e vínculos

create table core.location (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid not null references core.organization (id) on delete cascade,
    name        text not null,
    created_at  timestamptz not null default now()
);

create index location_org_idx on core.location (org_id);

create table core.location_link (
    location_id      uuid not null references core.location (id) on delete cascade,
    integration_id   uuid not null references core.integration (id) on delete cascade,
    external_id      text not null,
    -- Na VMpay o write-back precisa do par máquina+instalação; desnormalizado
    -- aqui para a ação não depender de parse do external_id.
    machine_id       bigint,
    installation_id  bigint,
    raw              jsonb not null default '{}'::jsonb,
    synced_at        timestamptz not null default now(),
    primary key (integration_id, external_id)
);

create index location_link_location_idx on core.location_link (location_id);

-- ------------------------------------------------------------------- estoque

-- Snapshot do saldo atual. A ingestão sobrescreve a cada rodada; o histórico
-- fica nos movimentos, não aqui.
create table core.stock_balance (
    location_id  uuid not null references core.location (id) on delete cascade,
    product_id   uuid not null references core.product (id) on delete cascade,
    quantity     numeric not null default 0,
    updated_at   timestamptz not null default now(),
    primary key (location_id, product_id)
);

create type core.movement_kind as enum ('restock', 'adjustment');
create type core.movement_source as enum ('manual', 'ingest');

create table core.stock_movement (
    id             bigint generated always as identity primary key,
    org_id         uuid not null references core.organization (id) on delete cascade,
    location_id    uuid not null references core.location (id),
    product_id     uuid not null references core.product (id),
    kind           core.movement_kind not null,
    quantity       numeric not null,
    actor_user_id  uuid references auth.users (id),
    source         core.movement_source not null default 'manual',
    occurred_at    timestamptz not null default now()
);

comment on table core.stock_movement is
    'Histórico de movimentos manuais. Vendas como movimento: adiado de '
    'propósito — vêm do staging de vendas quando forem canonicalizadas.';

create index stock_movement_org_time_idx
    on core.stock_movement (org_id, occurred_at desc);

-- --------------------------------------------------------------------- audit

create type core.action_status as enum ('pending', 'success', 'error');

-- Toda ação executada na plataforma passa por aqui: quem, o quê, em quê, com
-- que parâmetros e como terminou. Preenchido só pelo backend.
create table core.action_log (
    id             bigint generated always as identity primary key,
    org_id         uuid not null references core.organization (id) on delete cascade,
    actor_user_id  uuid not null references auth.users (id),
    action         text not null,
    target         jsonb not null default '{}'::jsonb,
    params         jsonb not null default '{}'::jsonb,
    status         core.action_status not null default 'pending',
    error          text,
    created_at     timestamptz not null default now(),
    finished_at    timestamptz
);

create index action_log_org_time_idx on core.action_log (org_id, created_at desc);
