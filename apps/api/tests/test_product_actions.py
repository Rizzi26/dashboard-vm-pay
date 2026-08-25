"""Cadastro de produto: refs ao vivo, write-back com action_log e espelho no core."""

import uuid

import httpx
import pytest
from conftest import USER_ID, make_token
from vmpay import VMpayError

from vmpay_api.auth import OrgContext, Principal, org_context
from vmpay_api.db import get_session
from vmpay_api.main import app
from vmpay_api.routers import products as products_router

ORG_ID = uuid.UUID("00000000-0000-0000-0000-00000000bbbb")
PROD_ID = uuid.UUID("00000000-0000-0000-0000-00000000ffff")
INTEG_ID = uuid.UUID("00000000-0000-0000-0000-00000000dddd")


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


class RoutedSession:
    def __init__(self, routes):
        self.routes = routes
        self.executed: list[tuple[str, dict]] = []
        self.commits = 0

    async def execute(self, stmt, params=None):
        sql = str(stmt).lower()
        self.executed.append((sql, params or {}))
        for needle, rows in self.routes:
            if needle in sql:
                return FakeResult(rows)
        return FakeResult([])

    async def commit(self):
        self.commits += 1


def use_role(role: str):
    async def _override():
        return OrgContext(Principal(USER_ID, "op@teste.dev"), ORG_ID, "mercadinho", role, False)

    app.dependency_overrides[org_context] = _override


def use_session(routes):
    sessao = RoutedSession(routes)

    async def _override():
        yield sessao

    app.dependency_overrides[get_session] = _override
    return sessao


REFS = {
    "fabricantes": [{"id": 1, "nome": "Ambev"}],
    "categorias": [{"id": 7, "nome": "Bebidas"}],
    "categorias_abastecimento": [{"id": 3, "nome": "Geladeira"}],
}


class FakeConnector:
    def __init__(self, fail: str | None = None):
        self.fail = fail
        self.calls: list = []

        class _Client:
            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, *a):
                return None

        self.client = _Client()

    async def product_refs(self):
        self.calls.append(("refs",))
        if self.fail:
            raise VMpayError(self.fail, status=500)
        return REFS

    async def create_product(self, fields):
        self.calls.append(("create", fields))
        if self.fail:
            raise VMpayError(self.fail, status=422)
        return {"id": 555, "name": fields["name"]}


def use_connector(monkeypatch, fail=None) -> FakeConnector:
    fake = FakeConnector(fail)
    monkeypatch.setattr(products_router, "get_connector", lambda config: fake)
    return fake


@pytest.fixture(autouse=True)
def _clean():
    yield
    app.dependency_overrides.clear()


async def call(method, url, json=None):
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {make_token()}"}
    async with httpx.AsyncClient(transport=transport, base_url="http://t", headers=headers) as c:
        return await c.request(method, url, json=json)


BODY = {
    "nome": "Água com gás 500ml",
    "fabricante_id": 1,
    "categoria_id": 7,
    "categoria_abastecimento_id": 3,
    "barcode": "7891234567890",
    "preco": 4.5,
}


def rotas_de_sucesso():
    return [
        ("from core.integration", [{"id": INTEG_ID, "config": {"token_env": "VMPAY_INGEST_TOKEN"}}]),
        ("insert into core.action_log", [(88,)]),
        ("insert into core.product (", [(PROD_ID,)]),
    ]


# --------------------------------------------------------------------- papéis


async def test_viewer_nao_cria_produto():
    use_role("viewer")
    use_session([])
    assert (await call("POST", "/orgs/mercadinho/products", json=BODY)).status_code == 403


async def test_viewer_nao_ve_os_refs():
    use_role("viewer")
    use_session([])
    assert (await call("GET", "/orgs/mercadinho/products/refs")).status_code == 403


# ----------------------------------------------------------------------- refs


async def test_refs_vem_ao_vivo_da_vmpay(monkeypatch):
    """A rota literal /refs não pode cair no match de /{product_id}."""
    use_role("admin")
    use_session([("from core.integration", [{"id": INTEG_ID, "config": {}}])])
    use_connector(monkeypatch)
    resp = await call("GET", "/orgs/mercadinho/products/refs")
    assert resp.status_code == 200
    assert resp.json()["fabricantes"] == [{"id": 1, "nome": "Ambev"}]


# --------------------------------------------------------------------- criação


async def test_cria_na_vmpay_e_espelha_no_core(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_de_sucesso())
    fake = use_connector(monkeypatch)

    resp = await call("POST", "/orgs/mercadinho/products", json=BODY)
    assert resp.status_code == 201
    body = resp.json()
    assert body["action_id"] == 88
    assert body["vmpay_id"] == 555
    assert body["product_id"] == str(PROD_ID)

    # payload traduzido para os nomes da VMpay, com o preço como default_price
    assert fake.calls == [
        (
            "create",
            {
                "name": "Água com gás 500ml",
                "manufacturer_id": 1,
                "category_id": 7,
                "supply_category_id": 3,
                "barcode": "7891234567890",
                "default_price": 4.5,
            },
        )
    ]

    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "insert into core.product (" in sqls
    assert "insert into core.product_link" in sqls
    fechamento = [p for sql, p in sessao.executed if "update core.action_log" in sql]
    assert fechamento[-1]["status"] == "success"


async def test_recusa_da_vmpay_fecha_o_log_e_nao_espelha(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_de_sucesso())
    use_connector(monkeypatch, fail="barcode já cadastrado")

    resp = await call("POST", "/orgs/mercadinho/products", json=BODY)
    assert resp.status_code == 502
    assert "barcode" in resp.json()["detail"]

    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "insert into core.product (" not in sqls
    fechamento = [p for sql, p in sessao.executed if "update core.action_log" in sql]
    assert fechamento[-1]["status"] == "error"


async def test_sem_integracao_ativa_e_409():
    use_role("admin")
    use_session([("from core.integration", [])])
    assert (await call("POST", "/orgs/mercadinho/products", json=BODY)).status_code == 409


async def test_escrita_desligada_bloqueia_criacao(monkeypatch):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("master")
    sessao = use_session(rotas_de_sucesso())
    fake = use_connector(monkeypatch)

    resp = await call("POST", "/orgs/mercadinho/products", json=BODY)
    assert resp.status_code == 503
    assert fake.calls == []
    assert sessao.executed == []
