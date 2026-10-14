"""Contagem de inventário: diferença sistema × contado, com as vendas no meio."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from test_stock_routes import (
    LOC_ID,
    PROD_ID,
    TARGET_ROW,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    use_role,
    use_session,
)
from vmpay import VMpayError

from vmpay_api.connector import PlanogramView
from vmpay_api.routers import contagem as contagem_router
from vmpay_api.routers import stock as stock_router

PROD_2 = uuid.UUID("00000000-0000-0000-0000-00000000f002")
PROD_3 = uuid.UUID("00000000-0000-0000-0000-00000000f003")

VIEW = PlanogramView(
    planogram_id=1,
    items=[
        {"id": 501, "good_id": 163, "current_balance": 12.0},
        {"id": 502, "good_id": 164, "current_balance": 5.0},
        {"id": 503, "good_id": 165, "current_balance": -2.0},  # oversell
    ],
    items_by_good={},
)
VIEW.items_by_good = {i["good_id"]: i for i in VIEW.items}


class FakeConnector:
    def __init__(self, fail=None):
        self.fail = fail
        self.calls = []

        class _Client:
            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, *a):
                return None

        self.client = _Client()

    async def current_planogram(self, machine_id, installation_id):
        return VIEW

    async def contar(self, machine_id, installation_id, contagens, view=None):
        self.calls.append(contagens)
        if self.fail:
            raise VMpayError(self.fail, status=422)
        return {"id": 1}


@pytest.fixture(autouse=True)
def _vendas_frescas(monkeypatch):
    """A rodada de vendas sob demanda fala com a VMpay e o banco: fora do teste."""

    async def _ok(target, token):
        return True

    monkeypatch.setattr(contagem_router, "_atualizar_vendas", _ok)


@pytest.fixture
def conector(monkeypatch):
    fake = FakeConnector()
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    return fake


def rotas(vendas=None):
    return [
        ("from vmpay.vend v", vendas or []),
        (
            "left join core.product_link pl",
            [
                {"product_id": PROD_ID, "name": "Água", "barcode": "1", "quantity": 12, "external_id": "163"},
                {"product_id": PROD_2, "name": "Suco", "barcode": "2", "quantity": 5, "external_id": "164"},
                {"product_id": PROD_3, "name": "Bala", "barcode": "3", "quantity": -2, "external_id": "165"},
            ],
        ),
        ("join core.location_link", [TARGET_ROW]),
        (
            "from core.product_link",
            [
                {"product_id": PROD_ID, "external_id": "163"},
                {"product_id": PROD_2, "external_id": "164"},
                {"product_id": PROD_3, "external_id": "165"},
            ],
        ),
        ("insert into core.action_log", [(92,)]),
    ]


def csv_(*linhas):
    return "id;produto;contado\n" + "\n".join(linhas) + "\n"


async def previa(conteudo, vendas=None, contado_em=None):
    use_role("admin")
    use_session(rotas(vendas))
    body = {"location_id": str(LOC_ID), "conteudo": conteudo}
    if contado_em:
        body["contado_em"] = contado_em
    resp = await call("POST", "/orgs/mercadinho/stock/contagem/previa", json=body)
    return resp


async def test_previa_mostra_falta_sobra_e_ignora_nao_contado(conector):
    resp = await previa(csv_(f"{PROD_ID};Água;9", f"{PROD_2};Suco;5", f"{PROD_3};Bala;1"))
    corpo = resp.json()
    assert corpo["resumo"]["diferencas"] == 2 and corpo["resumo"]["conferem"] == 1
    por = {d["produto"]: d for d in corpo["diferencas"]}
    assert (por["Água"]["sistema"], por["Água"]["diferenca"]) == (12.0, -3.0)
    assert (por["Bala"]["sistema"], por["Bala"]["diferenca"]) == (0.0, 1.0)  # oversell vira zero
    assert corpo["resumo"]["faltam"] == 3.0 and corpo["resumo"]["sobram"] == 1.0
    assert conector.calls == []


async def test_linha_em_branco_nao_vira_zero(conector):
    corpo = (await previa(csv_(f"{PROD_ID};Água;", f"{PROD_2};Suco;5"))).json()
    assert corpo["resumo"]["nao_contados"] == 1 and corpo["diferencas"] == []


async def test_vendas_durante_a_contagem_nao_viram_perda(conector):
    # Contou 9 há 1 h; desde então vendeu 2 e o planograma mostra 12 - 2 = 10.
    VIEW.items_by_good[163]["current_balance"] = 10.0
    try:
        uma_hora = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        corpo = (
            await previa(csv_(f"{PROD_ID};Água;9"), vendas=[{"good_id": 163, "unidades": 2}], contado_em=uma_hora)
        ).json()
        d = corpo["diferencas"][0]
        assert (d["sistema"], d["diferenca"], d["vendidas_desde"]) == (12.0, -3.0, 2.0)
    finally:
        VIEW.items_by_good[163]["current_balance"] = 12.0


async def test_contagem_velha_e_recusada(conector):
    ontem = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
    resp = await previa(csv_(f"{PROD_ID};Água;9"), contado_em=ontem)
    assert resp.status_code == 422 and "24 h" in resp.json()["detail"]


async def test_aplicar_manda_o_contado_menos_as_vendas(conector):
    use_role("admin")
    sessao = use_session(rotas([{"good_id": 163, "unidades": 2}]))
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/contagem/aplicar",
        json={
            "location_id": str(LOC_ID),
            "contado_em": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
            "itens": [{"product_id": str(PROD_ID), "contado": 9}, {"product_id": str(PROD_2), "contado": 5}],
        },
    )
    assert resp.status_code == 200, resp.text
    # Água: contou 9, vendeu 2 depois → hoje são 7. Suco: confere, não vai.
    assert conector.calls == [[(163, 7.0)]]
    corpo = resp.json()
    assert corpo["ajustados"] == 1 and corpo["faltam"] == 5.0  # sistema era 12+2=14, contou 9
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "'adjustment'" in sqls


async def test_recusa_da_vmpay_nao_mexe_no_saldo(monkeypatch):
    fake = FakeConnector(fail="pick list pendente")
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    sessao = use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/contagem/aplicar",
        json={"location_id": str(LOC_ID), "itens": [{"product_id": str(PROD_ID), "contado": 9}]},
    )
    assert resp.status_code == 502
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "update core.stock_balance" not in sqls and "stock_movement" not in sqls


async def test_aplicar_respeita_a_trava(monkeypatch, conector):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("master")
    use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/contagem/aplicar",
        json={"location_id": str(LOC_ID), "itens": [{"product_id": str(PROD_ID), "contado": 9}]},
    )
    assert resp.status_code == 503 and conector.calls == []


async def test_sem_vendas_frescas_nao_aplica(monkeypatch, conector):
    async def _falha(target, token):
        return False

    monkeypatch.setattr(contagem_router, "_atualizar_vendas", _falha)
    use_role("admin")
    use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/contagem/aplicar",
        json={"location_id": str(LOC_ID), "itens": [{"product_id": str(PROD_ID), "contado": 9}]},
    )
    assert resp.status_code == 503 and conector.calls == []
