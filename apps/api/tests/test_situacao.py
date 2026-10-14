"""Tirar de linha em lote: situação do item no planograma."""

import uuid

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
from vmpay_api.routers import stock as stock_router

PROD_2 = uuid.UUID("00000000-0000-0000-0000-00000000f002")

VIEW = PlanogramView(
    planogram_id=1,
    items=[
        {"id": 501, "good_id": 163, "status": "active", "current_balance": 4.0},
        {"id": 502, "good_id": 164, "status": "suspended", "current_balance": 0.0},
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

    async def set_status(self, machine_id, installation_id, changes, view=None):
        self.calls.append(changes)
        if self.fail:
            raise VMpayError(self.fail, status=422)
        return {"ok": True}


@pytest.fixture
def conector(monkeypatch):
    fake = FakeConnector()
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    return fake


def rotas():
    return [
        (
            "left join core.product_link pl",
            [
                {"product_id": PROD_ID, "name": "Água", "barcode": "1", "quantity": 4, "external_id": "163"},
                {"product_id": PROD_2, "name": "Suco", "barcode": "2", "quantity": 0, "external_id": "164"},
            ],
        ),
        ("join core.location_link", [TARGET_ROW]),
        ("from core.product_link", [{"product_id": PROD_ID, "external_id": "163"}, {"product_id": PROD_2, "external_id": "164"}]),
        ("insert into core.action_log", [(93,)]),
    ]


async def test_previa_entende_portugues_e_avisa_inativo_com_saldo(conector):
    use_role("admin")
    use_session(rotas())
    conteudo = f"id;produto;nova_situacao\n{PROD_ID};Água;Inativar\n{PROD_2};Suco;suspenso\n"
    corpo = (
        await call("POST", "/orgs/mercadinho/stock/situacao/previa", json={"location_id": str(LOC_ID), "conteudo": conteudo})
    ).json()
    assert corpo["resumo"] == {"mudar": 1, "iguais": 1, "em_branco": 0, "erros": 0}
    m = corpo["mudar"][0]
    assert (m["de"], m["para"]) == ("active", "inactive")
    assert "suspenso deixa vender" in m["avisos"][0]


async def test_situacao_desconhecida_e_erro_da_linha(conector):
    use_role("admin")
    use_session(rotas())
    conteudo = f"id;nova_situacao\n{PROD_ID};apagar\n"
    corpo = (
        await call("POST", "/orgs/mercadinho/stock/situacao/previa", json={"location_id": str(LOC_ID), "conteudo": conteudo})
    ).json()
    assert "não existe" in corpo["erros"][0]["motivo"]


async def test_aplicar_manda_so_o_que_muda_e_grava_a_situacao(conector):
    use_role("admin")
    sessao = use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/situacao/aplicar",
        json={
            "location_id": str(LOC_ID),
            "itens": [{"product_id": str(PROD_ID), "situacao": "suspended"}, {"product_id": str(PROD_2), "situacao": "suspended"}],
        },
    )
    assert resp.status_code == 200, resp.text
    assert conector.calls == [[(163, "suspended")]]
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "set planogram_status" in sqls


async def test_recusa_da_vmpay_nao_grava(monkeypatch):
    fake = FakeConnector(fail="pick list pendente")
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    sessao = use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/situacao/aplicar",
        json={"location_id": str(LOC_ID), "itens": [{"product_id": str(PROD_ID), "situacao": "inactive"}]},
    )
    assert resp.status_code == 502
    assert "set planogram_status" not in " ".join(sql for sql, _ in sessao.executed)
