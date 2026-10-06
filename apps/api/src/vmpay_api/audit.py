"""Registro de auditoria: login e ações de cada usuário, por organização.

Escrita na VMpay continua em core.action_log (com o pendente commitado antes
do write-back); aqui vai todo o resto. A tela de auditoria junta as duas.
"""

from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from .auth import OrgContext

# Sessões cujo login já foi registrado neste processo: evita um INSERT por
# requisição. Reinício do processo só custa um INSERT a mais — o índice único
# do banco descarta o repetido.
_logins_vistos: set[tuple[uuid.UUID, uuid.UUID]] = set()
_LIMITE_CACHE = 10_000


async def registrar_login(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    session_id: uuid.UUID | None,
    ip: str | None,
    user_agent: str | None,
) -> None:
    """Primeira requisição de uma sessão nesta organização = login."""
    if session_id is None or (org_id, session_id) in _logins_vistos:
        return
    await session.execute(
        text(
            """
            insert into core.audit_event (org_id, user_id, session_id, action, ip, user_agent)
            values (:org_id, :user_id, :session_id, 'login', :ip, :ua)
            on conflict (org_id, session_id) where action = 'login' do nothing
            """
        ),
        {
            "org_id": str(org_id),
            "user_id": str(user_id),
            "session_id": str(session_id),
            "ip": ip,
            "ua": (user_agent or "")[:300] or None,
        },
    )
    await session.commit()
    if len(_logins_vistos) > _LIMITE_CACHE:
        _logins_vistos.clear()
    _logins_vistos.add((org_id, session_id))


async def registrar(
    session: AsyncSession,
    ctx: OrgContext,
    action: str,
    target: dict[str, Any] | None = None,
    *,
    commit: bool = True,
) -> None:
    """Uma ação do usuário. `target` diz sobre o quê (chave do cupom, email…).

    commit=False quando a ação grava mais coisas na mesma transação e o
    registro deve entrar junto com elas (ou não entrar).
    """
    await session.execute(
        text(
            """
            insert into core.audit_event (org_id, user_id, session_id, action, target)
            values (:org_id, :user_id, :session_id, :action, cast(:target as jsonb))
            """
        ),
        {
            "org_id": str(ctx.org_id),
            "user_id": str(ctx.principal.user_id),
            "session_id": str(ctx.principal.session_id) if ctx.principal.session_id else None,
            "action": action,
            "target": json.dumps(target or {}, ensure_ascii=False, default=str),
        },
    )
    if commit:
        await session.commit()
