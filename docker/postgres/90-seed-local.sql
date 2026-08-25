-- Seed do compose LOCAL. Nunca roda em produção — em produção o seed é o
-- supabase/seed-poc.sql, e os dados vêm da ingestão real.
--
-- Os UUIDs dos usuários batem com os do stub de auth (scripts/demo).

insert into auth.users (id, email) values
    ('11111111-1111-1111-1111-111111111111', 'master@mercadinho.dev'),
    ('22222222-2222-2222-2222-222222222222', 'viewer@mercadinho.dev');

insert into core.organization (id, name, slug) values
    ('00000000-0000-0000-0000-00000000bbbb', 'Mercadinho do Condomínio', 'mercadinho');

insert into core.integration (id, org_id, kind, config) values
    ('00000000-0000-0000-0000-00000000dddd', '00000000-0000-0000-0000-00000000bbbb',
     'vmpay', '{"token_env": "VMPAY_INGEST_TOKEN"}'::jsonb);

insert into core.membership (user_id, org_id, role) values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000bbbb', 'master'),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-00000000bbbb', 'viewer');

-- ----------------------------------------------------- catálogo e estoque

insert into core.location (id, org_id, name) values
    ('00000000-0000-0000-0000-00000000eeee', '00000000-0000-0000-0000-00000000bbbb',
     'Condomínio Jardins — 1072');

insert into core.location_link
    (integration_id, external_id, location_id, machine_id, installation_id)
values
    ('00000000-0000-0000-0000-00000000dddd', '3184:857',
     '00000000-0000-0000-0000-00000000eeee', 3184, 857);

insert into core.product (id, org_id, name, barcode, unit_price, cost_price) values
    ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000bbbb',
     'Água Mineral 500ml', '7891000100103', 3.50, 1.20),
    ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000bbbb',
     'Ruffles 50g', '7892840222949', 8.00, 4.10),
    ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000bbbb',
     'Coca-Cola Lata 350ml', '7894900011517', 5.50, 2.80);

insert into core.product_link (integration_id, external_id, product_id) values
    ('00000000-0000-0000-0000-00000000dddd', '163', '00000000-0000-0000-0000-0000000000f1'),
    ('00000000-0000-0000-0000-00000000dddd', '164', '00000000-0000-0000-0000-0000000000f2'),
    ('00000000-0000-0000-0000-00000000dddd', '165', '00000000-0000-0000-0000-0000000000f3');

insert into core.stock_balance (location_id, product_id, quantity) values
    ('00000000-0000-0000-0000-00000000eeee', '00000000-0000-0000-0000-0000000000f1', 18),
    ('00000000-0000-0000-0000-00000000eeee', '00000000-0000-0000-0000-0000000000f2', 4),
    ('00000000-0000-0000-0000-00000000eeee', '00000000-0000-0000-0000-0000000000f3', 22);

-- ------------------------------------------------- vendas no staging vmpay

insert into vmpay.client (id, name) values (2854, 'Mercadinho do Condomínio');
insert into vmpay.location (id, name) values (3515, 'Condomínio Jardins');
insert into vmpay.machine (id, asset_number, model_id, model_name)
    values (3184, '1072', 32, 'Micro Market');

-- 30 dias de vendas determinísticas: ~8/dia com valores variados, e uma
-- cancelada por dia para a view vmpay.sale ter o que filtrar.
insert into vmpay.cashless_fact
    (id, occurred_at, status, kind, client_id, location_id, machine_id,
     quantity, value, payload)
select
    d * 100 + n                                             as id,
    now() - (30 - d) * interval '1 day'
          + (9 + (n * 83 % 12)) * interval '1 hour'         as occurred_at,
    case when n = 0 then 'CANCEL' else 'OK' end             as status,
    'eft_pinpad'                                            as kind,
    2854, 3515, 3184,
    1                                                       as quantity,
    round((3.5 + ((d * 7 + n * 13) % 90) / 10.0)::numeric, 2) as value,
    '{}'::jsonb
from generate_series(1, 30) d, generate_series(0, 7 + (d % 5)) n;
