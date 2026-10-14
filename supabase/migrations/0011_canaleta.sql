-- Canaleta: o número da posição do produto na loja (o `name` do item no
-- planograma da VMpay — "500", ou "1,2" quando são canaletas agrupadas).
--
-- É o "código" com que o operador trabalha: anota a canaleta na lista de
-- compra e, para lançar a carga, procura o produto pela canaleta — é o que
-- garante que é aquele produto e não um parecido (Coca 2 L × Coca 600 ml).
-- O snapshot preenche a partir do planograma que já baixa. Produto em mais
-- de uma canaleta: "500, 501". Nulo = planograma não respondeu.

alter table core.stock_balance
    add column if not exists canaleta text;

comment on column core.stock_balance.canaleta is
    'posição(ões) do produto no planograma da loja (item.name da VMpay), separadas por ", "';
