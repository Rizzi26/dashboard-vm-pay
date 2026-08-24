"""Autenticação (JWT do Supabase Auth) e autorização (papel por organização).

O frontend autentica no Supabase e manda o access token em Authorization:
Bearer. Aqui o token é validado e o papel vem do banco (core.membership) — nunca
de claim controlável pelo cliente. O superadmin da plataforma
(core.platform_admin) age como master em qualquer organização.

Dois modos de validação:
- JWKS assimétrico (default dos projetos Supabase novos): busca a chave pública
  em /auth/v1/.well-known/jwks.json, com cache.
- HS256 via SUPABASE_JWT_SECRET (projetos antigos e testes).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .models_core import ROLE_ORDER, Membership, Organization, PlatformAdmin


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    email: str | None


@dataclass(frozen=True)
class OrgContext:
    principal: Principal
    org_id: uuid.UUID
    org_slug: str
    role: str  # papel efetivo; superadmin aparece como master
    is_platform_admin: bool


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(settings().jwks_url, cache_keys=True, lifespan=3600)


def decode_token(token: str) -> dict[str, Any]:
    """Valida assinatura, expiração e audience; devolve as claims."""
    cfg = settings()
    if cfg.supabase_jwt_secret:
        return jwt.decode(
            token,
            cfg.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=cfg.supabase_jwt_aud,
        )
    key = _jwks_client().get_signing_key_from_jwt(token).key
    return jwt.decode(
        token,
        key,
        algorithms=["RS256", "ES256"],
        audience=cfg.supabase_jwt_aud,
    )


async def current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "credencial ausente")
    try:
        claims = decode_token(authorization.split(" ", 1)[1])
    except jwt.PyJWTError as exc:
        # O tipo do erro (expirado, assinatura, audience) ajuda o frontend a
        # decidir entre renovar a sessão e mandar para o login.
        raise HTTPException(401, f"token inválido: {type(exc).__name__}") from exc
    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(401, "token sem sub válido") from exc
    return Principal(user_id=user_id, email=claims.get("email"))


async def _load_org(session: AsyncSession, slug: str) -> Organization:
    org = await session.scalar(select(Organization).where(Organization.slug == slug))
    if org is None:
        # 404, não 403: o slug é público na URL; o que não se revela é se o
        # usuário teria acesso a uma org existente.
        raise HTTPException(404, "organização não encontrada")
    return org


async def _is_platform_admin(session: AsyncSession, user_id: uuid.UUID) -> bool:
    found = await session.scalar(
        select(PlatformAdmin.user_id).where(PlatformAdmin.user_id == user_id)
    )
    return found is not None


async def org_context(
    org: Annotated[str, Path(description="slug da organização")],
    principal: Annotated[Principal, Depends(current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrgContext:
    """Resolve organização + papel efetivo do usuário nela."""
    organization = await _load_org(session, org)
    if await _is_platform_admin(session, principal.user_id):
        return OrgContext(principal, organization.id, organization.slug, "master", True)
    membership = await session.scalar(
        select(Membership).where(
            Membership.user_id == principal.user_id,
            Membership.org_id == organization.id,
        )
    )
    if membership is None:
        raise HTTPException(403, "sem acesso a esta organização")
    return OrgContext(principal, organization.id, organization.slug, membership.role, False)


def require_role(minimum: str):
    """Dependência de papel mínimo: require_role("admin") aceita admin e master."""
    if minimum not in ROLE_ORDER:
        raise ValueError(f"papel desconhecido: {minimum}")

    async def dependency(
        ctx: Annotated[OrgContext, Depends(org_context)],
    ) -> OrgContext:
        if ROLE_ORDER[ctx.role] < ROLE_ORDER[minimum]:
            raise HTTPException(
                403, f"esta ação exige papel {minimum}; o seu é {ctx.role}"
            )
        return ctx

    return dependency
