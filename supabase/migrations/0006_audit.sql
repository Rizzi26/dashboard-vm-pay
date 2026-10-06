-- Auditoria: o que cada usuário fez, desde o login.
--
-- core.action_log já audita a ESCRITA na VMpay (restock, preço, produto,
-- pick list). Faltava o resto: login, consulta de cupom, exportação, pedido
-- de atualização, gestão de usuários. A tela de auditoria junta as duas
-- tabelas numa linha do tempo só.
--
-- O login é do lado de cá: o Supabase deste projeto não grava histórico de
-- autenticação no banco, e auth.sessions perde a linha no logout. O JWT de
-- cada requisição traz o session_id; a primeira requisição de uma sessão
-- registra o login, e tudo depois carrega o mesmo session_id.

create table core.audit_event (
    id          bigint generated always as identity primary key,
    org_id      uuid not null references core.organization (id) on delete cascade,
    -- Sem FK para auth.users de propósito: apagar a conta de alguém não pode
    -- apagar o rastro do que essa pessoa fez.
    user_id     uuid not null,
    session_id  uuid,
    action      text not null,
    target      jsonb not null default '{}'::jsonb,
    ip          text,
    user_agent  text,
    created_at  timestamptz not null default now()
);

create index audit_event_org_time_idx on core.audit_event (org_id, created_at desc);
create index audit_event_session_idx on core.audit_event (session_id);

-- Um login por sessão e organização: a API pode registrar em paralelo (várias
-- requisições da mesma página) e o índice decide.
create unique index audit_event_login_uniq
    on core.audit_event (org_id, session_id)
 where action = 'login';

-- Escrita na VMpay ligada à mesma sessão. Nullable: linhas antigas não têm.
alter table core.action_log add column session_id uuid;
