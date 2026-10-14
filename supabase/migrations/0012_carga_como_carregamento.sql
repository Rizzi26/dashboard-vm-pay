-- Carga como "carregamento" na VMpay, por loja.
--
-- Até aqui toda carga do painel (Repor, pick list, carga manual) entrava na
-- VMpay como AJUSTE DE INVENTÁRIO: o saldo certo, mas o operador não via um
-- carregamento. Carregamento na VMpay é pick list + reabastecimento (POST
-- .../pick_lists e POST .../restock) — o jeito de quem tem a instalação em
-- "somente por pick list". A demo não executa o reabastecimento (máquina
-- virtual), então isto nasce DESLIGADO e se liga loja a loja, depois de
-- provado em produção.

alter table core.location
    add column if not exists carga_como_carregamento boolean not null default false;

comment on column core.location.carga_como_carregamento is
    'true = carga do painel vira pick list + reabastecimento na VMpay; false = ajuste de inventário';
