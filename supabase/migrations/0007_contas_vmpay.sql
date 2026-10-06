-- Contas VMpay por lojista: uma organização com N contas, cada uma com token
-- próprio. É o caso real: o mesmo dono tem um mercadinho por conta VMpay
-- (um email de operador por loja), e a VMpay não junta contas.
--
-- O token NÃO fica nesta tabela. Contas adicionadas pelo painel guardam o
-- token no Supabase Vault (cifrado) e aqui só o id do segredo, em
-- config.secret_id. A conta original continua com config.token_env (o valor
-- vive na env var do Render/Actions) — nada muda para ela.

alter table core.integration add column nome text;
alter table core.integration add column created_by uuid;

comment on column core.integration.nome is
    'Como o lojista chama esta conta/loja no painel (ex.: "Jardins III").';

comment on column core.integration.config is
    'NUNCA guarda segredo. {"token_env": "NOME_DA_ENV"} (conta original, valor '
    'na env do Render/Actions) ou {"secret_id": "<uuid do vault.secrets>"} '
    '(contas adicionadas pelo painel, token cifrado no Supabase Vault).';

-- A conta que já existe ganha um nome para aparecer na lista.
update core.integration set nome = 'Conta principal' where nome is null;
