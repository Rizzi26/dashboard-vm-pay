-- Rotinas agendadas no próprio Supabase (pg_cron + pg_net).
--
-- O cron do GitHub Actions promete "de hora em hora" e entrega a cada 3–6h
-- (agendador best-effort do plano gratuito). O pg_cron roda no minuto certo
-- e chama a API por HTTP (pg_net); a API faz a ingestão. O cron do GitHub
-- fica de reserva — a ingestão é por cursor e idempotente, sobreposição não
-- duplica dado.
--
-- Quem agenda é a própria API ao subir (core.agendar_rotinas): ela sabe o
-- próprio endereço (RENDER_EXTERNAL_URL) e guarda no Vault o token que
-- autentica a chamada ('vmpay_cron_token'). Nenhum passo manual por ambiente.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function core.agendar_rotinas(api_url text, manter_acordado boolean)
returns void
language plpgsql
as $fn$
begin
    -- Ingestão de hora em hora, no minuto 7 (fora da virada da hora, quando o
    -- cron do GitHub tenta rodar). Timeout longo: o Render gratuito pode estar
    -- dormindo e leva ~1 min para acordar.
    perform cron.schedule(
        'vmpay-ingestao',
        '7 * * * *',
        format(
            $job$select net.http_post(
                url := %L,
                headers := jsonb_build_object(
                    'x-cron-token',
                    (select decrypted_secret from vault.decrypted_secrets where name = 'vmpay_cron_token'),
                    'content-type', 'application/json'
                ),
                body := '{}'::jsonb,
                timeout_milliseconds := 120000
            )$job$,
            api_url || '/interno/ingestao'
        )
    );

    -- Manter acordado: ping a cada 10 min das 8h às 23h de Brasília (11–02
    -- UTC). Só em produção — homologação acordada o dia todo estouraria as
    -- 750 h/mês do Render gratuito, que são da conta inteira.
    if manter_acordado then
        perform cron.schedule(
            'vmpay-acordado',
            '*/10 0-2,11-23 * * *',
            format($job$select net.http_get(url := %L, timeout_milliseconds := 60000)$job$, api_url || '/health')
        );
    else
        perform cron.unschedule(jobid) from cron.job where jobname = 'vmpay-acordado';
    end if;
end
$fn$;

comment on function core.agendar_rotinas(text, boolean) is
    'Chamada pela API ao subir; idempotente (cron.schedule com nome substitui o job).';
