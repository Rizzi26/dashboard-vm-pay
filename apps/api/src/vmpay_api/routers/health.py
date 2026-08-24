"""Saúde do serviço — usado pelo health check do Render."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session

router = APIRouter(tags=["infra"])


@router.get("/health")
async def health() -> dict:
    """Vivo? Não toca no banco — o Render usa isto para saber se derruba o pod."""
    return {"status": "ok"}


@router.get("/health/db")
async def health_db(session: AsyncSession = Depends(get_session)) -> dict:
    """Vivo e com banco? Separado de /health de propósito.

    Se o Supabase cair, o serviço continua de pé e devolve erro claro em vez de
    entrar em loop de restart.
    """
    try:
        await session.execute(text("select 1"))
        return {"status": "ok", "database": "ok"}
    except Exception as exc:  # noqa: BLE001 — vira resposta, não propaga
        return {"status": "degraded", "database": type(exc).__name__}
