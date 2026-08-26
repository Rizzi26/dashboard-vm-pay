"""Rotas de conta e membros: forma da resposta e guards nos endpoints reais."""

import uuid

import httpx
import pytest
import respx
from conftest import USER_ID, make_token

from vmpay_api.auth import OrgContext, Principal, org_context
from vmpay_api.db import get_session
from vmpay_api.main import app

ORG_ID = uuid.UUID("00000000-0000-0000-0000-00000000bbbb")
OUTRO = uuid.UUID("00000000-0000-0000-0000-00000000cccc")


class FakeResult:
    def __init__(self, rows):
        self._rows = rows
        self.rowcount = len(rows)

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class FakeSession:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.executed: list[tuple[str, dict]] = []
        self.committed = False

    async def execute(self, stmt, params=None):
        self.executed.append((str(stmt), params or {}))
        return FakeResult(self.rows)

    async def commit(self):
        self.committed = True


def use_session(rows=None):
    sessao = FakeSession(rows)

    async def _override():
        yield sessao

    app.dependency_overrides[get_session] = _override
    return sessao


def use_role(role: str):
    async def _override():
        return OrgContext(Principal(USER_ID, "chefe@teste.dev"), ORG_ID, "mercadinho", role, False)

    app.dependency_overrides[org_context] = _override


@pytest.fixture(autouse=True)
def _clean_overrides():
    yield
    app.dependency_overrides.clear()


async def call(method: str, url: str, json=None, token=None):
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {token or make_token()}"}
    async with httpx.AsyncClient(transport=transport, base_url="http://t", headers=headers) as c:
        return await c.request(method, url, json=json)


# ------------------------------------------------------------------------ /me


async def test_me_devolve_organizacoes_e_papel():
    from datetime import datetime, timezone

    use_session(
        [{"slug": "mercadinho", "name": "Mercadinho", "role": "master"}]
    )
    body = (await call("GET", "/me")).json()
    assert body["user_id"] == str(USER_ID)
    assert body["organizations"][0]["role"] == "master"


async def test_me_sem_token_da_401():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        assert (await c.get("/me")).status_code == 401


# -------------------------------------------------------------------- membros


async def test_admin_nao_gerencia_membros():
    use_role("admin")
    use_session()
    resp = await call("GET", "/orgs/mercadinho/members")
    assert resp.status_code == 403
    assert "master" in resp.json()["detail"]


async def test_viewer_nao_le_vendas_de_org_que_nao_e_membro():
    # org_context real com sessão que não encontra membership
    class Org:
        id = ORG_ID
        slug = "mercadinho"

    class ScriptedScalar:
        def __init__(self):
            self._vals = [Org(), None, None]  # org, platform_admin, membership

        async def scalar(self, _):
            return self._vals.pop(0)

        async def execute(self, stmt, params=None):
            return FakeResult([])

    sessao = ScriptedScalar()

    async def _override():
        yield sessao

    app.dependency_overrides[get_session] = _override
    resp = await call("GET", "/orgs/mercadinho/sales/summary")
    assert resp.status_code == 403


@respx.mock
async def test_master_convida_e_grava_membership():
    invite = respx.post("https://teste.supabase.co/auth/v1/invite").mock(
        return_value=httpx.Response(201, json={"id": str(OUTRO), "email": "novo@teste.dev"})
    )
    use_role("master")
    sessao = use_session()
    import os

    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service-key"
    from vmpay_api.config import settings

    settings.cache_clear()

    resp = await call(
        "POST", "/orgs/mercadinho/members", json={"email": "novo@teste.dev", "role": "admin"}
    )
    assert resp.status_code == 201
    # O convite tem que cair na página de definir senha do dashboard, não na
    # Site URL default do Supabase (localhost).
    import json

    sent = json.loads(invite.calls.last.request.content)
    assert sent["redirect_to"].endswith("/definir-senha")
    assert sessao.committed
    sql, params = sessao.executed[-1]
    assert "on conflict" in sql.lower()
    assert params["role"] == "admin"


async def test_convite_com_papel_invalido_e_recusado():
    use_role("master")
    use_session()
    resp = await call(
        "POST", "/orgs/mercadinho/members", json={"email": "x@teste.dev", "role": "gerente"}
    )
    assert resp.status_code == 422


async def test_master_nao_altera_o_proprio_papel():
    use_role("master")
    use_session()
    resp = await call(
        "PATCH", f"/orgs/mercadinho/members/{USER_ID}", json={"role": "viewer"}
    )
    assert resp.status_code == 409


async def test_master_nao_remove_a_si_mesmo():
    use_role("master")
    use_session()
    resp = await call("DELETE", f"/orgs/mercadinho/members/{USER_ID}")
    assert resp.status_code == 409
