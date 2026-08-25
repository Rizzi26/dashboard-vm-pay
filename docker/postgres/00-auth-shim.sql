-- Shim do Supabase Auth para Postgres puro (só no compose local).
--
-- As migrations referenciam auth.users, que no Supabase é gerenciado pela
-- plataforma. Aqui criamos o mínimo para as FKs e para o join de email dos
-- membros. Os usuários do stub de auth são inseridos no seed local.
create schema if not exists auth;

create table auth.users (
    id          uuid primary key,
    email       text unique,
    created_at  timestamptz not null default now()
);
