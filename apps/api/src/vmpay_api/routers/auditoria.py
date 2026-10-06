"""Auditoria: a linha do tempo do que cada usuário fez na organização.

Junta duas fontes: core.audit_event (login, consultas, exportações, gestão de
usuários) e core.action_log (escrita na VMpay — carga, preço, produto, pick
list), ordenadas por hora. Só master lê: é a tela de quem responde pela loja.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import registrar
from ..auth import OrgContext, require_role
from ..db import get_session

router = APIRouter(prefix="/orgs/{org}", tags=["auditoria"])

Session = Annotated[AsyncSession, Depends(get_session)]
ViewerCtx = Annotated[OrgContext, Depends(require_role("viewer"))]
MasterCtx = Annotated[OrgContext, Depends(require_role("master"))]

LINHA_DO_TEMPO_SQL = """
with eventos as (
    select 'evento'          as fonte,
           e.id,
           e.created_at      as em,
           e.user_id,
           e.session_id,
           e.action,
           e.target          as alvo,
           null::text        as status,
           null::text        as erro,
           e.ip,
           e.user_agent
      from core.audit_event e
     where e.org_id = :org_id
    union all
    select 'vmpay',
           a.id,
           a.created_at,
           a.actor_user_id,
           a.session_id,
           a.action,
           a.target || a.params,
           a.status::text,
           a.error,
           null,
           null
      from core.action_log a
     where a.org_id = :org_id
)
select ev.*, u.email,
       -- Total do filtro na mesma ida ao banco: a tela mostra "51–100 de 340".
       count(*) over () as total_filtro
  from eventos ev
  left join auth.users u on u.id = ev.user_id
 where ev.em >= :desde and ev.em < :ate
   and (cast(:usuario as uuid) is null or ev.user_id = cast(:usuario as uuid))
   and (cast(:sessao as uuid) is null or ev.session_id = cast(:sessao as uuid))
   and (cast(:antes as timestamptz) is null or ev.em < cast(:antes as timestamptz))
 order by ev.em desc
 limit :limite offset :offset
"""


@router.get("/auditoria")
async def linha_do_tempo(
    ctx: MasterCtx,
    session: Session,
    usuario: uuid.UUID | None = None,
    sessao: uuid.UUID | None = None,
    desde: date | None = None,
    ate: date | None = None,
    antes: datetime | None = None,
    limite: int = Query(default=50, ge=1, le=500),
    pagina: int = Query(default=1, ge=1),
) -> dict:
    """Eventos do mais recente para o mais antigo, `limite` por `pagina`."""
    ate = ate or date.today()
    desde = desde or ate - timedelta(days=30)
    rows = (
        await session.execute(
            text(LINHA_DO_TEMPO_SQL),
            {
                "org_id": str(ctx.org_id),
                "desde": desde,
                "ate": ate + timedelta(days=1),
                "usuario": str(usuario) if usuario else None,
                "sessao": str(sessao) if sessao else None,
                "antes": antes,
                "limite": limite,
                "offset": (pagina - 1) * limite,
            },
        )
    ).mappings().all()

    membros = (
        await session.execute(
            text(
                """
                select m.user_id, u.email, m.role
                  from core.membership m
                  join auth.users u on u.id = m.user_id
                 where m.org_id = :org_id
                 order by u.email
                """
            ),
            {"org_id": str(ctx.org_id)},
        )
    ).mappings().all()

    return {
        "periodo": {"inicio": desde.isoformat(), "fim": ate.isoformat()},
        "eventos": [
            {
                "fonte": r["fonte"],
                "id": r["id"],
                "em": r["em"].isoformat(),
                "usuario_id": str(r["user_id"]),
                "usuario": r["email"] or "(conta removida)",
                "sessao": str(r["session_id"]) if r["session_id"] else None,
                "acao": r["action"],
                "alvo": r["alvo"] or {},
                "status": r["status"],
                "erro": r["erro"],
                "ip": r["ip"],
                "navegador": r["user_agent"],
            }
            for r in rows
        ],
        "pagina": pagina,
        "por_pagina": limite,
        "total": int(rows[0]["total_filtro"]) if rows else 0,
        # Cursor (compatibilidade): o "em" do último evento desta página.
        "proxima": rows[-1]["em"].isoformat() if len(rows) == limite else None,
        "membros": [
            {"id": str(m["user_id"]), "email": m["email"], "papel": m["role"]} for m in membros
        ],
    }


@router.post("/sessao/sair", status_code=204)
async def sair(ctx: ViewerCtx, session: Session) -> None:
    """O dashboard chama antes de encerrar a sessão no Supabase: fecha o
    "desde o login" com o logout na mesma linha do tempo."""
    await registrar(session, ctx, "logout")
