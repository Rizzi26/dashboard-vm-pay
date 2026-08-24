"""Validação de token e resolução de papel — o coração do RBAC."""

import uuid

import pytest
from fastapi import HTTPException

from vmpay_api import auth
from vmpay_api.auth import OrgContext, Principal, current_user, decode_token, require_role

from conftest import USER_ID, make_token

ORG_ID = uuid.UUID("00000000-0000-0000-0000-00000000bbbb")


# ---------------------------------------------------------------------- token


def test_token_valido_e_decodificado():
    claims = decode_token(make_token())
    assert claims["sub"] == str(USER_ID)


def test_token_expirado_e_recusado():
    import jwt as pyjwt

    with pytest.raises(pyjwt.ExpiredSignatureError):
        decode_token(make_token(expires_in=-10))


def test_token_com_audience_errada_e_recusado():
    import jwt as pyjwt

    with pytest.raises(pyjwt.InvalidAudienceError):
        decode_token(make_token(aud="anon"))


def test_token_com_assinatura_errada_e_recusado():
    import jwt as pyjwt

    with pytest.raises(pyjwt.InvalidSignatureError):
        decode_token(make_token(secret="outro-segredo"))


async def test_current_user_sem_header_da_401():
    with pytest.raises(HTTPException) as exc:
        await current_user(None)
    assert exc.value.status_code == 401


async def test_current_user_extrai_o_principal():
    principal = await current_user(f"Bearer {make_token()}")
    assert principal.user_id == USER_ID
    assert principal.email == "pessoa@teste.dev"


async def test_erro_de_token_diz_o_tipo_sem_vazar_o_token():
    token = make_token(expires_in=-10)
    with pytest.raises(HTTPException) as exc:
        await current_user(f"Bearer {token}")
    assert exc.value.status_code == 401
    assert "ExpiredSignature" in exc.value.detail
    assert token not in exc.value.detail


# ----------------------------------------------------------- papel e contexto


class ScriptedSession:
    """session.scalar devolve os valores na ordem: org, platform_admin, membership."""

    def __init__(self, *results):
        self._results = list(results)

    async def scalar(self, _stmt):
        return self._results.pop(0)


def org(slug="mercadinho"):
    class Org:
        id = ORG_ID

    Org.slug = slug
    return Org()


def membership(role):
    class M:
        pass

    M.role = role
    return M()


PRINCIPAL = Principal(user_id=USER_ID, email=None)


async def test_membro_recebe_o_papel_do_banco():
    ctx = await auth.org_context("mercadinho", PRINCIPAL, ScriptedSession(org(), None, membership("admin")))
    assert ctx.role == "admin"
    assert not ctx.is_platform_admin


async def test_superadmin_vira_master_em_qualquer_org():
    ctx = await auth.org_context("mercadinho", PRINCIPAL, ScriptedSession(org(), USER_ID))
    assert ctx.role == "master"
    assert ctx.is_platform_admin


async def test_nao_membro_toma_403():
    with pytest.raises(HTTPException) as exc:
        await auth.org_context("mercadinho", PRINCIPAL, ScriptedSession(org(), None, None))
    assert exc.value.status_code == 403


async def test_org_inexistente_da_404_e_nao_403():
    """O slug é público; o que não se revela é se o usuário teria acesso."""
    with pytest.raises(HTTPException) as exc:
        await auth.org_context("fantasma", PRINCIPAL, ScriptedSession(None))
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------- guard


def ctx_with_role(role: str) -> OrgContext:
    return OrgContext(PRINCIPAL, ORG_ID, "mercadinho", role, False)


async def test_viewer_nao_passa_em_guard_de_admin():
    dep = require_role("admin")
    with pytest.raises(HTTPException) as exc:
        await dep(ctx_with_role("viewer"))
    assert exc.value.status_code == 403
    assert "admin" in exc.value.detail


async def test_admin_passa_em_guard_de_admin_mas_nao_de_master():
    assert (await require_role("admin")(ctx_with_role("admin"))).role == "admin"
    with pytest.raises(HTTPException):
        await require_role("master")(ctx_with_role("admin"))


async def test_master_passa_em_tudo():
    for minimo in ("viewer", "admin", "master"):
        assert (await require_role(minimo)(ctx_with_role("master"))).role == "master"


def test_guard_de_papel_desconhecido_quebra_na_definicao():
    """Erro de programação aparece no import, não como 403 misterioso em runtime."""
    with pytest.raises(ValueError):
        require_role("gerente")
