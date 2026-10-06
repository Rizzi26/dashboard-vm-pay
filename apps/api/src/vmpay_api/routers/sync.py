"""Atualização sob demanda: a mesma rodada do cron, disparada pelo dashboard.

O cron do GitHub Actions é de hora em hora no papel, mas o agendador é
best-effort — na prática roda a cada 3 a 6 horas. Quem está olhando o painel
não precisa esperar: o botão "Atualizar dados" pede uma rodada agora.

Leitura pura (VMpay → banco), por isso fica aberto a qualquer papel e não passa
pelo action_log, que audita escrita NA VMpay. O que segura abuso é o intervalo
mínimo entre rodadas e a trava de uma rodada por vez.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import registrar
from ..auth import OrgContext, require_role
from ..config import settings
from ..db import get_session
from ..ingest import sync_all

log = logging.getLogger(__name__)

router = APIRouter(prefix="/orgs/{org}/sync", tags=["sincronização"])

Session = Annotated[AsyncSession, Depends(get_session)]
ViewerCtx = Annotated[OrgContext, Depends(require_role("viewer"))]

#: Uma rodada leva ~10 requisições à VMpay; o limite de 300/min do token é
#: dividido com o cron. Dois minutos entre pedidos sobram para os dois.
INTERVALO_MINIMO_S = 120

# Uma rodada por processo. O cron roda em outro lugar (Actions) e pode
# coincidir: a ingestão é por cursor e idempotente, então a sobreposição custa
# requisição, não dado duplicado.
_rodando = asyncio.Lock()
_ultima_conclusao: datetime | None = None

#: O que a tela diz sobre a atualização automática. O cron é "0 * * * *", mas o
#: agendador do Actions atrasa e pula — o texto não promete o que não cumpre.
AUTOMATICA = "automática a cada hora (pode atrasar)"


async def _rodada() -> None:
    global _ultima_conclusao
    async with _rodando:
        try:
            # Catálogo só se aparecer produto novo: o completo leva minutos e
            # quem clicou está olhando a tela (o cron faz o completo).
            await sync_all(catalogo_completo=False)
        except Exception:
            # Tarefa de fundo: ninguém espera a resposta. O erro fica no log e
            # no sync_cursor.last_error, que o rodapé do dashboard mostra.
            log.exception("atualização sob demanda falhou")
        finally:
            _ultima_conclusao = datetime.now(timezone.utc)


@router.get("")
async def situacao(ctx: ViewerCtx, session: Session) -> dict:
    """O que o botão mostra: há rodada correndo? de quando é o dado?

    "dados_de" é o MAIS ANTIGO entre vendas e estoque — se o estoque parou
    e as vendas não, a tela não pode dizer "atualizado há 5 min".
    """
    vendas = await session.scalar(text("select min(last_success) from vmpay.sync_cursor"))
    estoque = await session.scalar(
        text(
            """
            select max(b.updated_at)
              from core.stock_balance b
              join core.location l on l.id = b.location_id
             where l.org_id = :org_id
            """
        ),
        {"org_id": str(ctx.org_id)},
    )
    conhecidos = [d for d in (vendas, estoque) if d is not None]
    return {
        "rodando": _rodando.locked(),
        "ultima_conclusao": _ultima_conclusao.isoformat() if _ultima_conclusao else None,
        "dados_de": min(conhecidos).isoformat() if conhecidos else None,
        "automatica": AUTOMATICA,
    }


@router.post("", status_code=202)
async def atualizar(ctx: ViewerCtx, session: Session, background: BackgroundTasks) -> dict:
    if not settings().vmpay_token:
        raise HTTPException(
            503, "atualização indisponível: VMPAY_INGEST_TOKEN não está configurado na API"
        )
    if _rodando.locked():
        return {"status": "em_andamento"}

    # A rodada mais recente é a mais nova entre o cursor de vendas e a última
    # que este processo concluiu: conta sem vendas (homologação) nunca grava
    # o cursor, e só ele deixava o intervalo mínimo sem efeito.
    no_banco = await session.scalar(text("select max(last_run_at) from vmpay.sync_cursor"))
    candidatas = [d for d in (no_banco, _ultima_conclusao) if d is not None]
    ultima = max(candidatas) if candidatas else None
    if ultima is not None:
        idade = (datetime.now(timezone.utc) - ultima).total_seconds()
        if idade < INTERVALO_MINIMO_S:
            raise HTTPException(
                429,
                f"os dados foram atualizados há {int(idade)}s — "
                f"aguarde {INTERVALO_MINIMO_S - int(idade)}s para pedir de novo",
            )

    await registrar(session, ctx, "dados.atualizar")
    background.add_task(_rodada)
    return {"status": "agendado", "pedido_em": datetime.now(timezone.utc).isoformat()}
