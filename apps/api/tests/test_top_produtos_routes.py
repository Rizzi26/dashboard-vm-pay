"""GET /sales/top-produtos: ranking + série com todos os baldes da janela."""

import uuid
from datetime import date

import httpx
import pytest

from vmpay_api.auth import OrgContext, Principal, org_context
from vmpay_api.db import get_session
from vmpay_api.main import app

ORG = uuid.UUID("00000000-0000-0000-0000-00000000bbbb")
USER = uuid.UUID("00000000-0000-0000-0000-00000000aaaa")
PROD = "11111111-1111-1111-1111-111111111111"


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class Sessao:
    """Cada execute() consome o próximo lote (ranking, depois série) e guarda
    o SQL e os parâmetros recebidos."""

    def __init__(self, lotes):
        self._lotes = list(lotes)
        self.sqls: list[str] = []
        self.params: list[dict] = []

    async def execute(self, stmt, params=None):
        self.sqls.append(str(stmt))
        self.params.append(params or {})
        return FakeResult(self._lotes.pop(0) if self._lotes else [])


def com_sessao(*lotes):
    sessao = Sessao(lotes)

    async def _sessao():
        yield sessao

    async def _ctx():
        return OrgContext(Principal(USER, None), ORG, "mercadinho", "viewer", False)

    app.dependency_overrides[get_session] = _sessao
    app.dependency_overrides[org_context] = _ctx
    return sessao


@pytest.fixture(autouse=True)
def limpa():
    yield
    app.dependency_overrides.clear()


async def get(url: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        return await c.get(url)


RANKING = [
    {"product_id": uuid.UUID(PROD), "nome": "Coca 350", "good_id": 10, "revenue": 90, "units": 18},
    {"product_id": None, "nome": "Água", "good_id": 20, "revenue": 40, "units": 20},
]
URL = "/orgs/mercadinho/sales/top-produtos"


async def test_formato_e_ordem_do_ranking():
    com_sessao(RANKING, [
        {"good_id": 10, "inicio": date(2026, 9, 1), "revenue": 50, "units": 10},
        {"good_id": 10, "inicio": date(2026, 9, 3), "revenue": 40, "units": 8},
        {"good_id": 20, "inicio": date(2026, 9, 2), "revenue": 40, "units": 20},
    ])
    body = (await get(f"{URL}?start=2026-09-01&end=2026-09-03")).json()
    assert body["granularidade"] == "dia"
    assert body["periodo"] == {"inicio": "2026-09-01", "fim": "2026-09-03"}
    assert [p["posicao"] for p in body["produtos"]] == [1, 2]
    assert body["produtos"][0] == {
        "posicao": 1, "chave": PROD, "product_id": PROD, "produto": "Coca 350",
        "faturamento": 90.0, "unidades": 18.0,
    }
    # Sem vínculo canônico, a chave é o good da VMpay.
    assert body["produtos"][1]["chave"] == "20"
    assert body["produtos"][1]["product_id"] is None
    assert body["pontos"][0] == {
        "inicio": "2026-09-01",
        "valores": {PROD: {"faturamento": 50.0, "unidades": 10.0},
                    "20": {"faturamento": 0.0, "unidades": 0.0}},
    }


async def test_todos_os_baldes_vem_mesmo_sem_venda():
    com_sessao(RANKING[:1], [
        {"good_id": 10, "inicio": date(2026, 9, 1), "revenue": 5, "units": 1},
        {"good_id": 10, "inicio": date(2026, 9, 5), "revenue": 5, "units": 1},
    ])
    body = (await get(f"{URL}?start=2026-09-01&end=2026-09-07")).json()
    inicios = [p["inicio"] for p in body["pontos"]]
    assert inicios == [f"2026-09-0{d}" for d in range(1, 8)]
    # Buraco no meio e cauda vazia viram zero — a linha não pula o dia.
    assert body["pontos"][2]["valores"][PROD] == {"faturamento": 0.0, "unidades": 0.0}
    assert body["pontos"][6]["valores"][PROD]["faturamento"] == 0.0


async def test_granularidade_pelo_tamanho_da_janela():
    sessao = com_sessao(RANKING[:1], [
        {"good_id": 10, "inicio": date(2026, 6, 1), "revenue": 5, "units": 1},
    ])
    body = (await get(f"{URL}?start=2026-06-03&end=2026-08-31")).json()  # 90 dias
    assert body["granularidade"] == "semana"
    # Semana começa na segunda: 03/06/2026 é quarta → balde de 01/06.
    assert body["pontos"][0]["inicio"] == "2026-06-01"
    assert body["pontos"][-1]["inicio"] == "2026-08-31"
    assert "'week'" in sessao.sqls[1]
    assert "America/Sao_Paulo" in sessao.sqls[1]

    com_sessao(RANKING[:1], [{"good_id": 10, "inicio": date(2025, 11, 1), "revenue": 5, "units": 1}])
    body = (await get(f"{URL}?start=2025-10-07&end=2026-10-07")).json()
    assert body["granularidade"] == "mes"
    assert body["pontos"][-1]["inicio"] == "2026-10-01"


async def test_tudo_nao_comeca_em_2000():
    com_sessao(RANKING[:1], [{"good_id": 10, "inicio": date(2025, 11, 1), "revenue": 5, "units": 1}])
    body = (await get(f"{URL}?start=2000-01-01&end=2026-01-15")).json()
    assert [p["inicio"] for p in body["pontos"]] == ["2025-11-01", "2025-12-01", "2026-01-01"]


async def test_n_chega_na_consulta_e_e_limitado():
    sessao = com_sessao([], [])
    body = (await get(f"{URL}?n=3")).json()
    assert sessao.params[0]["n"] == 3
    assert body["produtos"] == [] and body["pontos"] == []
    # Sem ranking, nem consulta a série.
    assert len(sessao.sqls) == 1

    assert (await get(f"{URL}?n=11")).status_code == 422
    assert (await get(f"{URL}?n=0")).status_code == 422
    sessao = com_sessao([], [])
    await get(URL)
    assert sessao.params[0]["n"] == 5


async def test_so_as_maquinas_e_os_produtos_da_organizacao():
    loja = "00000000-0000-0000-0000-0000000000aa"
    sessao = com_sessao(RANKING, [])
    await get(f"{URL}?loja={loja}")
    for sql, params in zip(sessao.sqls, sessao.params):
        assert "core.location_link" in sql
        assert "i.org_id = :org_id" in sql  # vínculo de produto da própria org
        assert params["org_id"] == str(ORG)
        assert params["loja"] == loja
    assert sessao.params[1]["goods"] == [10, 20]
