"""Rotas chamadas pelo próprio sistema (pg_cron), não pelo dashboard.

Sem JWT de usuário: a chamada se autentica com o token interno do Vault
(ver rotinas.py). Responde 202 na hora — a ingestão roda em segundo plano,
na mesma trava de "uma rodada por vez" do botão Atualizar dados.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..rotinas import conferir_token
from .sync import _rodada, _rodando

router = APIRouter(prefix="/interno", tags=["interno"], include_in_schema=False)

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/ingestao", status_code=202)
async def ingestao(
    session: Session,
    background: BackgroundTasks,
    x_cron_token: Annotated[str | None, Header()] = None,
) -> dict:
    if not await conferir_token(session, x_cron_token):
        raise HTTPException(401, "não autorizado")
    if _rodando.locked():
        return {"status": "em_andamento"}
    background.add_task(_rodada)
    return {"status": "agendado"}
