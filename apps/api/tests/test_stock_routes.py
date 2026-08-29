"""Rotas de estoque: papéis, action_log e reflexo local do write-back."""

import uuid
from datetime import datetime, timezone

import httpx
import pytest
from conftest import USER_ID, make_token
from vmpay import VMpayError

from vmpay_api.auth import OrgContext, Principal, org_context
from vmpay_api.db import get_session
from vmpay_api.main import app
from vmpay_api.routers import stock as stock_router

ORG_ID = uuid.UUID("00000000-0000-0000-0000-00000000bbbb")
LOC_ID = uuid.UUID("00000000-0000-0000-0000-00000000eeee")
PROD_ID = uuid.UUID("00000000-0000-0000-0000-00000000ffff")
AGORA = datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)


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
    """Devolve linhas conforme um trecho do SQL; grava tudo que executou."""

    def __init__(self, routes):
        self.routes = routes  # [(trecho_do_sql, rows)]
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

    async def scalar(self, stmt, params=None):
        sql = str(stmt).lower()
        self.executed.append((sql, params or {}))
        for needle, rows in self.routes:
            if needle in sql and rows:
                return rows[0]
        return None


TARGET_ROW = {
    "location_id": LOC_ID,
    "name": "Condomínio — 0010",
    "machine_id": 49,
    "installation_id": 857,
    "integration_id": uuid.UUID("00000000-0000-0000-0000-00000000dddd"),
    "config": {"token_env": "VMPAY_INGEST_TOKEN"},
}

STOCK_ROW = {
    "location_id": LOC_ID,
    "location_name": "Condomínio — 0010",
    "product_id": PROD_ID,
    "product_name": "Água Mineral",
    "barcode": "789",
    "unit_price": 3.5,
    "quantity": 18,
    "updated_at": AGORA,
}


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


class FakeConnector:
    """Grava chamadas; opcionalmente falha como a VMpay falharia."""

    def __init__(self, fail: str | None = None):
        self.fail = fail
        self.calls: list = []

        class _Client:
            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, *a):
                return None

        self.client = _Client()

    async def restock(self, machine_id, installation_id, items):
        self.calls.append(("restock", machine_id, installation_id, items))
        if self.fail:
            raise VMpayError(self.fail, status=422)
        return {"id": 900}

    async def set_price(self, machine_id, installation_id, changes):
        self.calls.append(("price", machine_id, installation_id, changes))
        if self.fail:
            raise VMpayError(self.fail, status=422)
        return {"ok": True}


def use_connector(monkeypatch, fail=None) -> FakeConnector:
    fake = FakeConnector(fail)
    monkeypatch.setattr(stock_router, "get_connector", lambda config: fake)
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


RESTOCK_BODY = {
    "location_id": str(LOC_ID),
    "items": [{"product_id": str(PROD_ID), "quantity": 6}],
}


# -------------------------------------------------------------------- leitura


async def test_viewer_le_o_estoque():
    use_role("viewer")
    use_session([("from core.stock_balance", [STOCK_ROW])])
    body = (await call("GET", "/orgs/mercadinho/stock")).json()
    assert body[0]["produto"] == "Água Mineral"
    assert body[0]["quantidade"] == 18.0


async def test_csv_vem_como_anexo_com_separador_pt_br():
    use_role("viewer")
    use_session([("from core.stock_balance", [STOCK_ROW])])
    resp = await call("GET", "/orgs/mercadinho/stock/export.csv")
    assert "attachment" in resp.headers["content-disposition"]
    linhas = resp.text.strip().splitlines()
    assert linhas[0].startswith("local;produto")
    assert "Água Mineral" in linhas[1]
    assert "3,50" in linhas[1]  # preço com vírgula


# ------------------------------------------------------------- sincronização


INTEG_ROW = {
    "id": uuid.UUID("00000000-0000-0000-0000-00000000dddd"),
    "config": {"token_env": "VMPAY_INGEST_TOKEN"},
}


async def test_sync_agenda_o_snapshot_em_segundo_plano(monkeypatch):
    use_role("admin")
    use_session([("from core.integration", [INTEG_ROW])])
    monkeypatch.setenv("VMPAY_INGEST_TOKEN", "tok-teste")
    chamadas: list[str] = []

    async def fake_exec(integration_id: str):
        chamadas.append(integration_id)

    monkeypatch.setattr(stock_router, "_executar_sync", fake_exec)
    resp = await call("POST", "/orgs/mercadinho/stock/sync")
    assert resp.status_code == 202
    assert chamadas == [str(INTEG_ROW["id"])]


async def test_sync_sem_token_no_ambiente_explica_o_que_falta(monkeypatch):
    """Render sem VMPAY_INGEST_TOKEN: 503 legível, não tarefa morrendo à toa."""
    use_role("admin")
    use_session([("from core.integration", [INTEG_ROW])])
    monkeypatch.delenv("VMPAY_INGEST_TOKEN", raising=False)
    resp = await call("POST", "/orgs/mercadinho/stock/sync")
    assert resp.status_code == 503
    assert "VMPAY_INGEST_TOKEN" in resp.json()["detail"]


async def test_sync_respeita_o_cooldown(monkeypatch):
    use_role("admin")
    monkeypatch.setenv("VMPAY_INGEST_TOKEN", "tok-teste")
    use_session(
        [
            ("from core.integration", [INTEG_ROW]),
            ("max(b.updated_at)", [datetime.now(timezone.utc)]),
        ]
    )
    resp = await call("POST", "/orgs/mercadinho/stock/sync")
    assert resp.status_code == 429


async def test_viewer_nao_dispara_sync():
    use_role("viewer")
    use_session([])
    assert (await call("POST", "/orgs/mercadinho/stock/sync")).status_code == 403


# ------------------------------------------------------------------ histórico


QUEBRA_ROW = {
    "location_id": LOC_ID,
    "location_name": "Condomínio — 0010",
    "product_id": PROD_ID,
    "product_name": "Água Mineral",
    "barcode": "789",
    "foto_anterior": AGORA,
    "snapshot_at": AGORA,
    "saida": 3,
    "vendidas": 1,
    "quebra": 2,
    "preco": 6.99,
}


async def test_viewer_ve_quebras_com_valor_calculado():
    use_role("viewer")
    use_session([("core.stock_snapshot", [QUEBRA_ROW])])
    body = (await call("GET", "/orgs/mercadinho/stock/quebras")).json()

    evento = body["eventos"][0]
    assert evento["quebra"] == 2.0
    assert evento["vendidas"] == 1.0
    assert evento["valor"] == 13.98  # 2 × 6,99
    assert body["resumo"] == {"eventos": 1, "unidades": 2.0, "valor": 13.98}


async def test_quebra_sem_preco_nao_inventa_valor():
    use_role("viewer")
    use_session([("core.stock_snapshot", [{**QUEBRA_ROW, "preco": None}])])
    body = (await call("GET", "/orgs/mercadinho/stock/quebras")).json()
    assert body["eventos"][0]["valor"] is None
    assert body["resumo"]["valor"] == 0  # só soma o que tem preço conhecido


async def test_historico_do_produto_vem_em_serie():
    use_role("viewer")
    use_session(
        [
            (
                "core.stock_snapshot",
                [
                    {
                        "snapshot_at": AGORA,
                        "location_id": LOC_ID,
                        "location_name": "Condomínio — 0010",
                        "quantity": 5,
                    }
                ],
            )
        ]
    )
    body = (await call("GET", f"/orgs/mercadinho/stock/history/{PROD_ID}")).json()
    assert body == [
        {"em": AGORA.isoformat(), "local": "Condomínio — 0010", "quantidade": 5.0}
    ]


# --------------------------------------------------------------------- papéis


async def test_viewer_nao_executa_restock():
    use_role("viewer")
    use_session([])
    resp = await call("POST", "/orgs/mercadinho/stock/restock", json=RESTOCK_BODY)
    assert resp.status_code == 403


async def test_viewer_nao_ve_o_historico_de_acoes():
    use_role("viewer")
    use_session([])
    assert (await call("GET", "/orgs/mercadinho/stock/actions")).status_code == 403


# -------------------------------------------------------------------- restock


def rotas_de_sucesso():
    return [
        ("join core.location_link", [TARGET_ROW]),
        ("from core.product_link", [{"product_id": PROD_ID, "external_id": "163"}]),
        ("insert into core.action_log", [(77,)]),
        ("from core.stock_balance", [STOCK_ROW]),
    ]


async def test_restock_empurra_para_a_vmpay_e_reflete_local(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_de_sucesso())
    fake = use_connector(monkeypatch)

    resp = await call("POST", "/orgs/mercadinho/stock/restock", json=RESTOCK_BODY)
    assert resp.status_code == 201
    assert resp.json()["action_id"] == 77

    # write-back com os ids EXTERNOS, traduzidos pelo product_link
    assert fake.calls == [("restock", 49, 857, [(163, 6.0)])]

    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "update core.stock_balance" in sqls
    assert "insert into core.stock_movement" in sqls
    fechamento = [p for sql, p in sessao.executed if "update core.action_log" in sql]
    assert fechamento[-1]["status"] == "success"


async def test_recusa_da_vmpay_fecha_o_log_com_erro_e_nao_mexe_no_saldo(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_de_sucesso())
    use_connector(monkeypatch, fail="pick list pendente")

    resp = await call("POST", "/orgs/mercadinho/stock/restock", json=RESTOCK_BODY)
    assert resp.status_code == 502
    assert "pick list" in resp.json()["detail"]

    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "update core.stock_balance" not in sqls  # saldo local intocado
    fechamento = [p for sql, p in sessao.executed if "update core.action_log" in sql]
    assert fechamento[-1]["status"] == "error"
    assert "pick list" in fechamento[-1]["error"]


async def test_log_pendente_e_commitado_antes_do_write_back(monkeypatch):
    """Morte no meio da chamada deixa rastro 'pending', não escrita órfã."""
    use_role("admin")
    sessao = use_session(rotas_de_sucesso())

    commits_antes_do_connector = []

    class Espiao(FakeConnector):
        async def restock(self, *a):
            commits_antes_do_connector.append(sessao.commits)
            return await super().restock(*a)

    fake = Espiao()
    monkeypatch.setattr(stock_router, "get_connector", lambda config: fake)

    await call("POST", "/orgs/mercadinho/stock/restock", json=RESTOCK_BODY)
    assert commits_antes_do_connector == [1]  # o log pendente já estava salvo


async def test_produto_sem_vinculo_e_422_antes_de_qualquer_escrita(monkeypatch):
    use_role("admin")
    use_session([("join core.location_link", [TARGET_ROW]), ("from core.product_link", [])])
    fake = use_connector(monkeypatch)
    resp = await call("POST", "/orgs/mercadinho/stock/restock", json=RESTOCK_BODY)
    assert resp.status_code == 422
    assert fake.calls == []


async def test_local_de_outra_org_e_404(monkeypatch):
    use_role("admin")
    use_session([("join core.location_link", [])])
    resp = await call("POST", "/orgs/mercadinho/stock/restock", json=RESTOCK_BODY)
    assert resp.status_code == 404


# --------------------------------------------------------------------- preço


async def test_preco_atualiza_o_produto_canonico_apos_aceite(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_de_sucesso())
    fake = use_connector(monkeypatch)

    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/price",
        json={"location_id": str(LOC_ID), "product_id": str(PROD_ID), "price": 4.25},
    )
    assert resp.status_code == 200
    assert fake.calls == [("price", 49, 857, [(163, 4.25)])]
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "update core.product" in sqls


# ------------------------------------------------------------ trava de escrita


async def test_escrita_desligada_bloqueia_restock_mesmo_para_master(monkeypatch):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("master")
    sessao = use_session(rotas_de_sucesso())
    fake = use_connector(monkeypatch)

    resp = await call("POST", "/orgs/mercadinho/stock/restock", json=RESTOCK_BODY)
    assert resp.status_code == 503
    assert "VMPAY_ALLOW_WRITES" in resp.json()["detail"]
    assert fake.calls == []  # nada alcançou a VMpay
    assert sessao.executed == []  # nem o banco foi tocado


async def test_escrita_desligada_e_o_default(monkeypatch):
    """Sem a env, a trava está fechada — seguro por omissão."""
    monkeypatch.delenv("VMPAY_ALLOW_WRITES", raising=False)
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("admin")
    use_session(rotas_de_sucesso())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/price",
        json={"location_id": str(LOC_ID), "product_id": str(PROD_ID), "price": 4.0},
    )
    assert resp.status_code == 503


async def test_leitura_continua_com_escrita_desligada(monkeypatch):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("viewer")
    use_session([("from core.stock_balance", [STOCK_ROW])])
    resp = await call("GET", "/orgs/mercadinho/stock")
    assert resp.status_code == 200
