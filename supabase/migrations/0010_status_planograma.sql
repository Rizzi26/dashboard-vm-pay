-- Situação do item no planograma da loja: active, suspended ou inactive.
--
-- A VMpay não apaga item de planograma — tirar produto de linha é inativar
-- (para de vender na hora) ou suspender (vende o que sobrou, não repõe). Sem
-- saber disso, o painel mostrava o produto tirado de linha como "zerado" e a
-- Reposição mandava comprar de novo. O snapshot preenche a coluna a partir do
-- planograma que já baixa para o preço; nulo = planograma não respondeu na
-- última rodada (tratado como ativo).

alter table core.stock_balance
    add column if not exists planogram_status text;

comment on column core.stock_balance.planogram_status is
    'active | suspended | inactive, do current_planogram da loja; nulo = desconhecido (tratado como ativo)';
