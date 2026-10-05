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


async def invite_or_find(email: str) -> tuple[uuid.UUID, str | None]:
    """Convida o email; se já existe usuário, manda o link de redefinir senha.

    Devolve (user_id, email_enviado), com email_enviado em "convite",
    "redefinir" ou None quando nenhum email saiu.

    Remover alguém da organização apaga só a membership — a conta no Auth
    fica. Reconvidar essa pessoa batia no "já registrado" do /invite e voltava
    em silêncio, sem email nenhum. Para conta existente o email certo é o de
    redefinir senha: cai na mesma página /definir-senha.
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
            return uuid.UUID(resp.json()["id"]), "convite"
        # 422/400: já registrado — buscar pelo email.
        lookup = await http.get(
            f"{_base()}/auth/v1/admin/users",
            headers=_headers(),
            params={"email": email},
        )
        match = None
        if lookup.status_code == 200:
            users = lookup.json().get("users", [])
            match = next(
                (u for u in users if u.get("email", "").lower() == email.lower()), None
            )
        if match is None:
            raise HTTPException(
                502, f"Supabase Auth recusou o convite (HTTP {resp.status_code})"
            )
        # O /recover dispara o email pelo SMTP do projeto. Falha aqui (o SMTP
        # padrão do Supabase limita poucos emails por hora) não desfaz o acesso:
        # quem chama avisa que o email não saiu.
        recover = await http.post(
            f"{_base()}/auth/v1/recover",
            headers=_headers(),
            params={"redirect_to": redirect_to},
            json={"email": email},
        )
        enviado = "redefinir" if recover.status_code in (200, 201, 204) else None
        return uuid.UUID(match["id"]), enviado
