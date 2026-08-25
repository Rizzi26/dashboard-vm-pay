-- Preço por saldo (local), não só por produto.
--
-- No VMpay o preço vigente mora no planograma da INSTALAÇÃO (desired_price) —
-- produto pode nem ter preço padrão (o catálogo real da PoC não tem). O
-- relatório de saldos já traz o desired_price; agora ele tem onde morar.
alter table core.stock_balance add column price numeric(14, 4);

comment on column core.stock_balance.price is
    'desired_price do planograma da instalação — o preço vigente NESTE local. '
    'product.unit_price é fallback (preço padrão do catálogo, quando existe).';
