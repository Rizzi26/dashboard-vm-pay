"""Gestão de usuários de uma organização — só master (ou superadmin)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import OrgContext, require_role
from ..db import get_session
from ..models_core import ROLE_ORDER
from ..supabase_admin import invite_or_find

router = APIRouter(prefix="/orgs/{org}/members", tags=["usuários"])

MasterCtx = Annotated[OrgContext, Depends(require_role("master"))]
Session = Annotated[AsyncSession, Depends(get_session)]


class InviteBody(BaseModel):
    email: EmailStr
    role: str = "viewer"


class RoleBody(BaseModel):
    role: str


def _check_role(role: str) -> None:
    if role not in ROLE_ORDER:
        raise HTTPException(422, f"papel inválido: {role}; use {sorted(ROLE_ORDER)}")


@router.get("")
async def list_members(ctx: MasterCtx, session: Session) -> list[dict]:
    # O email vem de auth.users direto — mesmo Postgres, leitura apenas. Assim a
    # membership não carrega cópia desnormalizada que envelhece.
    rows = (
        await session.execute(
            text(
                """
                select m.user_id, m.role, m.created_at, u.email
                  from core.membership m
                  join auth.users u on u.id = m.user_id
                 where m.org_id = :org_id
                 order by u.email
                """
            ),
            {"org_id": str(ctx.org_id)},
        )
    ).mappings().all()
    return [
        {
            "user_id": str(r["user_id"]),
            "email": r["email"],
            "role": r["role"],
            "member_since": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def invite_member(body: InviteBody, ctx: MasterCtx, session: Session) -> dict:
    _check_role(body.role)
    user_id = await invite_or_find(body.email)
    await session.execute(
        text(
            """
            insert into core.membership (user_id, org_id, role)
            values (:user_id, :org_id, :role)
            on conflict (user_id, org_id) do update set role = excluded.role
            """
        ),
        {"user_id": str(user_id), "org_id": str(ctx.org_id), "role": body.role},
    )
    await session.commit()
    return {"user_id": str(user_id), "email": body.email, "role": body.role}


@router.patch("/{user_id}")
async def change_role(
    user_id: uuid.UUID, body: RoleBody, ctx: MasterCtx, session: Session
) -> dict:
    _check_role(body.role)
    # Ninguém mexe na própria membership: um master não se rebaixa por engano e
    # não se remove — trancar a porta com a chave dentro vira chamado de suporte.
    if user_id == ctx.principal.user_id:
        raise HTTPException(409, "não é possível alterar o próprio papel")
    result = await session.execute(
        text(
            """
            update core.membership set role = :role
             where user_id = :user_id and org_id = :org_id
            """
        ),
        {"role": body.role, "user_id": str(user_id), "org_id": str(ctx.org_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(404, "membro não encontrado nesta organização")
    await session.commit()
    return {"user_id": str(user_id), "role": body.role}


@router.delete("/{user_id}", status_code=204)
async def remove_member(user_id: uuid.UUID, ctx: MasterCtx, session: Session) -> None:
    if user_id == ctx.principal.user_id:
        raise HTTPException(409, "não é possível remover a si mesmo")
    result = await session.execute(
        text(
            "delete from core.membership where user_id = :user_id and org_id = :org_id"
        ),
        {"user_id": str(user_id), "org_id": str(ctx.org_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(404, "membro não encontrado nesta organização")
    await session.commit()
