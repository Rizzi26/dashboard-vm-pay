-- Pick list: entrada de estoque a partir do cupom fiscal de compra (NFC-e).
--
-- O operador lê o QR Code do cupom, o backend busca os itens na SEFAZ, o
-- operador confere e liga cada item a um produto, e a aprovação vira um
-- restock — o mesmo caminho do /stock/restock, pelo action_log.
--
-- O cupom só é gravado na APROVAÇÃO. A conferência acontece na tela, sobre o
-- que a SEFAZ devolveu; rascunho persistido seria estado para limpar sem
-- ganho, porque reler o QR custa uma requisição.

create type core.receipt_status as enum ('pending', 'approved', 'error');
create type core.receipt_source as enum ('qrcode', 'manual');

create table core.purchase_receipt (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid not null references core.organization (id) on delete cascade,
    location_id     uuid not null references core.location (id),
    access_key      text not null check (access_key ~ '^\d{44}$'),
    number          text,
    series          text,
    issued_at       timestamptz,
    -- O CNPJ do emitente está embutido na chave (posições 7–20); vem dela
    -- mesmo no lançamento manual, que é o que mantém o de-para funcionando.
    supplier_tax_id text not null,
    supplier_name   text,
    total           numeric(14, 2),
    source          core.receipt_source not null,
    status          core.receipt_status not null default 'pending',
    action_id       bigint references core.action_log (id),
    approved_by     uuid not null references auth.users (id),
    created_at      timestamptz not null default now(),
    -- Um cupom entra uma vez por organização: é a trava contra carregar a
    -- mesma compra duas vezes no estoque. Cupom em 'error' é regravado.
    unique (org_id, access_key)
);

create index purchase_receipt_org_time_idx
    on core.purchase_receipt (org_id, created_at desc);

create table core.purchase_receipt_item (
    receipt_id     uuid not null references core.purchase_receipt (id) on delete cascade,
    line           int not null,
    supplier_code  text,
    description    text not null,
    quantity       numeric not null,
    unit           text,
    unit_price     numeric(14, 4),
    total          numeric(14, 2),
    product_id     uuid references core.product (id),
    -- Unidades de venda por unidade de compra (1 fardo = 6). O restock é
    -- quantity × factor.
    factor         numeric not null default 1 check (factor > 0),
    ignored        boolean not null default false,
    primary key (receipt_id, line),
    check (ignored or product_id is not null)
);

-- De-para que aprende: o código do item é do EMITENTE, então a chave é
-- (fornecedor, código). Na próxima compra do mesmo fornecedor os itens já
-- chegam ligados — e "ignorar" (consumo, embalagem) também é lembrado.
create table core.supplier_product_map (
    org_id           uuid not null references core.organization (id) on delete cascade,
    supplier_tax_id  text not null,
    supplier_code    text not null,
    product_id       uuid references core.product (id) on delete cascade,
    factor           numeric not null default 1 check (factor > 0),
    ignored          boolean not null default false,
    updated_at       timestamptz not null default now(),
    primary key (org_id, supplier_tax_id, supplier_code),
    check (ignored or product_id is not null)
);
