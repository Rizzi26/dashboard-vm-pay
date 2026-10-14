"""Carga como carregamento na VMpay: pick list + reabastecimento."""

import json
import uuid

import httpx
import pytest
import respx
from test_stock_routes import (
    LOC_ID,
    PROD_ID,
    TARGET_ROW,
    FakeConnector,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    rotas_de_sucesso,
    use_role,
    use_session,
)
from vmpay import VMpayClient, VMpayError

from vmpay_api.connector import ConnectorError, VMpayConnector
from vmpay_api.routers import stock as stock_router

BASE = "https://homolog.test/api/v1"
INST = f"{BASE}/machines/49/installations/857"
PLANOGRAMA = {"id": 777, "items": [{"id": 5001, "good_id": 163, "current_balance": 3}]}


def conector():
    return VMpayConnector(VMpayClient("tok", base_url=BASE, max_retries=0))


@respx.mock
async def test_carregar_cria_pick_list_e_reabastece():
    respx.get(f"{INST}/pick_lists").mock(return_value=httpx.Response(200, json=[{"id": 1, "pending": False}]))
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    pl = respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9001}))
    rs = respx.post(f"{INST}/restock").mock(return_value=httpx.Response(200, json={"ok": True}))

    r = await conector().carregar(49, 857, [(163, 6.0)], "Carga pelo painel (cupom)")

    assert r["pick_list_id"] == 9001
    corpo = json.loads(pl.calls.last.request.content)["pick_list"]
    assert corpo["planogram_id"] == 777 and corpo["notes"] == "Carga pelo painel (cupom)"
    assert corpo["items_attributes"] == [{"planogram_item_id": 5001, "quantity": 6, "skip_rules": True}]
    assert json.loads(rs.calls.last.request.content) == {"restock_mode": "restock_only"}


@respx.mock
async def test_pick_list_pendente_da_loja_recusa_sem_criar_nada():
    """O /restock executaria a pick list pendente — que não é a nossa."""
    respx.get(f"{INST}/pick_lists").mock(return_value=httpx.Response(200, json=[{"id": 55, "pending": True}]))
    pl = respx.post(f"{INST}/pick_lists")
    rs = respx.post(f"{INST}/restock")
    with pytest.raises(ConnectorError, match="nº 55"):
        await conector().carregar(49, 857, [(163, 1.0)], "x")
    assert not pl.called and not rs.called


@respx.mock
async def test_reabastecimento_recusado_apaga_a_pick_list_criada():
    """Pick list pendente trava alteração de planograma: não pode sobrar."""
    respx.get(f"{INST}/pick_lists").mock(return_value=httpx.Response(200, json=[]))
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9002}))
    respx.post(f"{INST}/restock").mock(return_value=httpx.Response(422, json={"error": "não"}))
    apaga = respx.delete(f"{INST}/pick_lists/9002").mock(return_value=httpx.Response(204))
    with pytest.raises(VMpayError):
        await conector().carregar(49, 857, [(163, 1.0)], "x")
    assert apaga.called


class Carregador(FakeConnector):
    async def carregar(self, machine_id, installation_id, items, notas):
        self.calls.append(("carregar", machine_id, installation_id, items, notas))
        return {"pick_list_id": 9001}


async def test_loja_ligada_carrega_por_pick_list(monkeypatch):
    fake = Carregador()
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    rotas = [r if r[0] != "join core.location_link" else (r[0], [{**TARGET_ROW, "carga_como_carregamento": True}]) for r in rotas_de_sucesso()]
    sessao = use_session(rotas)
    resp = await call(
        "POST", "/orgs/mercadinho/stock/restock",
        json={"location_id": str(LOC_ID), "items": [{"product_id": str(PROD_ID), "quantity": 6}]},
    )
    assert resp.status_code == 201, resp.text
    assert fake.calls[0][0] == "carregar" and fake.calls[0][3] == [(163, 6.0)]
    assert "Carga pelo painel (reposição)" in fake.calls[0][4]
    params = next(p for sql, p in sessao.executed if "insert into core.action_log" in sql)
    assert json.loads(params["params"])["modo"] == "carregamento"


async def test_loja_desligada_segue_como_ajuste(monkeypatch):
    fake = Carregador()
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    use_session(rotas_de_sucesso())
    resp = await call(
        "POST", "/orgs/mercadinho/stock/restock",
        json={"location_id": str(LOC_ID), "items": [{"product_id": str(PROD_ID), "quantity": 6}]},
    )
    assert resp.status_code == 201
    assert fake.calls[0][0] == "restock"


async def test_so_master_liga_o_carregamento():
    use_role("admin")
    use_session([])
    resp = await call("PATCH", f"/orgs/mercadinho/lojas/{LOC_ID}/modo-carga", json={"carga_como_carregamento": True})
    assert resp.status_code == 403


async def test_master_liga_e_fica_na_auditoria():
    use_role("master")
    sessao = use_session([("update core.location set carga_como_carregamento", [("Loja 1",)])])
    resp = await call("PATCH", f"/orgs/mercadinho/lojas/{LOC_ID}/modo-carga", json={"carga_como_carregamento": True})
    assert resp.status_code == 200, resp.text
    assert any("audit_event" in sql for sql, _ in sessao.executed)


async def test_loja_de_outra_org_e_404():
    use_role("master")
    use_session([])
    resp = await call("PATCH", f"/orgs/mercadinho/lojas/{uuid.uuid4()}/modo-carga", json={"carga_como_carregamento": True})
    assert resp.status_code == 404
