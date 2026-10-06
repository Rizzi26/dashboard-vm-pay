"""Rotinas agendadas no Supabase (pg_cron) — a API se agenda ao subir.

Em PRODUÇÃO o pg_cron chama POST /interno/ingestao de hora em hora e /health
a cada 10 min no horário de uso (o Render gratuito não dorme). Homologação
não agenda nada: lá se atualiza pelo botão. A
chamada se autentica com um token aleatório guardado no Vault: a API o cria
na primeira subida e compara o cabeçalho com ele. Nenhuma variável de
ambiente nova, nenhum passo manual por ambiente.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .db import session_factory

log = logging.getLogger(__name__)

NOME_SEGREDO = "vmpay_cron_token"

#: O serviço de produção no Render. Só ele fica acordado no horário de uso —
#: as 750 h/mês do plano gratuito são da conta inteira (ver 0008_rotinas.sql).
SERVICO_DE_PRODUCAO = "vmpay-api"


async def token_interno(session: AsyncSession) -> str | None:
    return await session.scalar(
        text("select decrypted_secret from vault.decrypted_secrets where name = :nome"),
        {"nome": NOME_SEGREDO},
    )


async def conferir_token(session: AsyncSession, recebido: str | None) -> bool:
    esperado = await token_interno(session)
    # compare_digest: tempo constante, não revela quantos caracteres bateram.
    return bool(esperado and recebido) and hmac.compare_digest(esperado, recebido)


async def agendar() -> None:
    """Garante o token no Vault e (re)agenda os jobs. Idempotente.

    Fora do Render (local, testes, CI) não há RENDER_EXTERNAL_URL: não agenda.
    Falha aqui não derruba a API — fica no log, e a próxima subida tenta de
    novo (o deploy pode subir antes da migration que cria a função).
    """
    url = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
    if not url:
        return
    producao = os.environ.get("RENDER_SERVICE_NAME") == SERVICO_DE_PRODUCAO
    try:
        async with session_factory()() as session:
            if await token_interno(session) is None:
                await session.execute(
                    text("select vault.create_secret(:valor, :nome, :descricao)"),
                    {
                        "valor": secrets.token_urlsafe(32),
                        "nome": NOME_SEGREDO,
                        "descricao": "Autentica o pg_cron em POST /interno/ingestao (gerado pela API)",
                    },
                )
            await session.execute(
                text("select core.agendar_rotinas(:url, :acordado)"),
                {"url": url, "acordado": producao},
            )
            if not producao:
                # Homologação não tem venda real: atualizar de hora em hora só
                # acordaria o serviço ~6 h/dia à toa, gastando as 750 h/mês da
                # conta Render. Lá se atualiza pelo botão, quando for testar.
                await session.execute(
                    text("select cron.unschedule(jobid) from cron.job where jobname = 'vmpay-ingestao'")
                )
            await session.commit()
        log.info(
            "rotinas: %s",
            "ingestão horária + manter acordado" if producao else "sem agendamento (homologação)",
        )
    except Exception:
        log.exception("não foi possível agendar as rotinas no pg_cron")
