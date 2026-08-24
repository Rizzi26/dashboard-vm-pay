-- Seed da PoC: o mercadinho de condomínio.
--
-- Rode DEPOIS das migrations, e DEPOIS de criar o primeiro usuário no painel do
-- Supabase (Authentication → Add user). Substitua o email abaixo pelo dele.
--
-- Não é migration de propósito: cria dados de UM ambiente, não estrutura.

-- 1) A organização
insert into core.organization (name, slug)
values ('Mercadinho do Condomínio', 'mercadinho')
on conflict (slug) do nothing;

-- 2) A integração VMpay. config aponta o NOME da env var do token do worker —
--    o valor nunca entra no banco.
insert into core.integration (org_id, kind, config)
select o.id, 'vmpay', '{"token_env": "VMPAY_INGEST_TOKEN"}'::jsonb
  from core.organization o
 where o.slug = 'mercadinho'
   and not exists (
       select 1 from core.integration i
        where i.org_id = o.id and i.kind = 'vmpay'
   );

-- 3) O primeiro master. TROQUE O EMAIL.
insert into core.membership (user_id, org_id, role)
select u.id, o.id, 'master'
  from auth.users u, core.organization o
 where u.email = 'email-do-master@example.com'
   and o.slug = 'mercadinho'
on conflict (user_id, org_id) do update set role = 'master';

-- 4) (Opcional) Vocês como superadmin da plataforma. TROQUE O EMAIL.
-- insert into core.platform_admin (user_id)
-- select id from auth.users where email = 'dev@adsscanner.com'
-- on conflict (user_id) do nothing;
