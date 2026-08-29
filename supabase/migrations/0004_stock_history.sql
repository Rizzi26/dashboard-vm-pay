-- Histórico de estoque: uma foto por rodada de sincronização.
--
-- O snapshot de saldos SOBRESCREVE core.stock_balance — sem memória, não dá
-- para responder "o saldo se mexeu?" nem separar venda de quebra (furto,
-- avaria, consumo sem registro). Esta tabela é append-only: cada rodada grava
-- o relatório de saldos inteiro com o mesmo carimbo de tempo.
--
-- A análise (queda entre fotos × vendas no intervalo) acontece na LEITURA,
-- não na escrita: nada aqui é derivado, então mudança de regra de detecção
-- nunca exige reprocessar dado — só reescrever a consulta.
create table core.stock_snapshot (
    snapshot_at  timestamptz not null,
    location_id  uuid not null references core.location (id) on delete cascade,
    product_id   uuid not null references core.product (id) on delete cascade,
    quantity     numeric not null,
    price        numeric(14, 4),
    -- A série por (local, produto) é a consulta dominante; snapshot_at por
    -- último deixa o PK servir a série ordenada sem índice extra.
    primary key (location_id, product_id, snapshot_at)
);

comment on table core.stock_snapshot is
    'Foto append-only dos saldos, gravada pela ingestão. Só entram linhas que '
    'MUDARAM desde a foto anterior (a primeira rodada grava tudo, como '
    'âncora) — a série em degraus reconstrói o "não mudou". Fonte da série '
    'histórica de estoque e da detecção de quebra (queda de saldo maior que '
    'as vendas do intervalo).';

-- Varreduras por janela de tempo (detecção de quebra em todo o catálogo).
create index stock_snapshot_time_idx on core.stock_snapshot (snapshot_at);
