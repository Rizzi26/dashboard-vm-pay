"""Quem sou eu — o frontend monta menu e navegação a partir disto."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import Principal, current_user
from ..db import get_session

router = APIRouter(tags=["conta"])


@router.get("/me")
async def me(
    principal: Annotated[Principal, Depends(current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    rows = (
        await session.execute(
            text(
                """
                select o.slug, o.name, m.role
                  from core.membership m
                  join core.organization o on o.id = m.org_id
                 where m.user_id = :user_id
                 order by o.name
                """
            ),
            {"user_id": str(principal.user_id)},
        )
    ).mappings().all()
    is_platform = (
        await session.execute(
            text("select 1 from core.platform_admin where user_id = :user_id"),
            {"user_id": str(principal.user_id)},
        )
    ).first() is not None
    return {
        "user_id": str(principal.user_id),
        "email": principal.email,
        "platform_admin": is_platform,
        "organizations": [
            {"slug": r["slug"], "name": r["name"], "role": r["role"]} for r in rows
        ],
    }
