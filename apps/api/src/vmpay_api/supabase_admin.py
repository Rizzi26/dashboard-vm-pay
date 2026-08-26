"""Cliente mínimo da Admin API do Supabase Auth — só convite e remoção.

Usa a service role key; nada daqui é alcançável pelo frontend. A criação de
usuário fica no Supabase (que manda o email de convite); papel e organização
ficam no nosso banco.
"""

from __future__ import annotations

import uuid

import httpx
from fastapi import HTTPException

from .config import settings


def _headers() -> dict[str, str]:
    key = settings().supabase_service_role_key
    if not key:
        raise HTTPException(503, "SUPABASE_SERVICE_ROLE_KEY não configurada")
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _base() -> str:
    return settings().supabase_url.rstrip("/")


async def invite_or_find(email: str) -> uuid.UUID:
    """Convida o email; se já existe usuário, devolve o id dele.

    O convite dispara o email do Supabase com o link de definir senha. Usuário
    repetido não é erro do nosso lado — vira busca.
    """
    # Sem redirect_to o Supabase usa a Site URL do painel — que por default é
    # localhost e ninguém lembra de trocar. A página de destino ainda precisa
    # estar na lista "Redirect URLs" do painel, senão o Supabase ignora.
    redirect_to = f"{settings().dashboard_url.rstrip('/')}/definir-senha"
    async with httpx.AsyncClient(timeout=15) as http:
        resp = await http.post(
            f"{_base()}/auth/v1/invite",
            headers=_headers(),
            json={"email": email, "redirect_to": redirect_to},
        )
        if resp.status_code in (200, 201):
            return uuid.UUID(resp.json()["id"])
        # 422/400: já registrado — buscar pelo email.
        lookup = await http.get(
            f"{_base()}/auth/v1/admin/users",
            headers=_headers(),
            params={"email": email},
        )
        if lookup.status_code == 200:
            users = lookup.json().get("users", [])
            match = next(
                (u for u in users if u.get("email", "").lower() == email.lower()), None
            )
            if match:
                return uuid.UUID(match["id"])
        raise HTTPException(
            502, f"Supabase Auth recusou o convite (HTTP {resp.status_code})"
        )
