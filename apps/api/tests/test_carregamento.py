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


def instalacao(estrategia="require_pending_pick_list"):
    respx.get(INST).mock(return_value=httpx.Response(200, json={"id": 857, "restock_strategy": estrategia}))


def lista(*pick_lists):
    respx.get(f"{INST}/pick_lists").mock(return_value=httpx.Response(200, json=list(pick_lists)))


def detalhe(pick_id, itens, pending=False):
    respx.get(f"{INST}/pick_lists/{pick_id}").mock(
        return_value=httpx.Response(200, json={"id": pick_id, "pending": pending, "items": itens})
    )


@respx.mock
async def test_carregar_cria_pick_list_reabastece_e_diz_o_que_entrou():
    instalacao()
    lista({"id": 1, "pending": False})
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    pl = respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9001}))
    rs = respx.post(f"{INST}/restock").mock(return_value=httpx.Response(200, json={"ok": True}))
    detalhe(9001, [{"good_id": 163, "quantity": 6, "ignored": False}])

    r = await conector().carregar(49, 857, [(163, 4.0), (163, 2.0)], "Carga pelo painel (cupom) — ação nº 7", "ação nº 7")

    assert r == {"pick_list_id": 9001, "carregados": {163: 6.0}, "ignorados": []}
    corpo = json.loads(pl.calls.last.request.content)["pick_list"]
    assert corpo["planogram_id"] == 777
    # o mesmo produto em duas linhas vira um item só
    assert corpo["items_attributes"] == [{"planogram_item_id": 5001, "quantity": 6, "skip_rules": True}]
    assert json.loads(rs.calls.last.request.content) == {"restock_mode": "restock_only"}
    assert pl.call_count == 1 and rs.call_count == 1


@respx.mock
async def test_instalacao_fora_de_somente_pick_list_recusa():
    """Em outra estratégia o /restock pode virar reabastecimento COMPLETO."""
    instalacao("allow_pick_list_or_full")
    pl = respx.post(f"{INST}/pick_lists")
    with pytest.raises(ConnectorError, match="somente por pick list"):
        await conector().carregar(49, 857, [(163, 1.0)], "x", "m")
    assert not pl.called


@respx.mock
async def test_pick_list_pendente_da_loja_recusa_sem_criar_nada():
    """O /restock executaria a pick list pendente — que não é a nossa."""
    instalacao()
    lista({"id": 55, "pending": True})
    pl = respx.post(f"{INST}/pick_lists")
    rs = respx.post(f"{INST}/restock")
    with pytest.raises(ConnectorError, match="nº 55"):
        await conector().carregar(49, 857, [(163, 1.0)], "x", "m")
    assert not pl.called and not rs.called


@respx.mock
async def test_fracionado_recusa_antes_de_criar():
    instalacao()
    lista()
    pl = respx.post(f"{INST}/pick_lists")
    with pytest.raises(ConnectorError, match="fracionada"):
        await conector().carregar(49, 857, [(163, 1.5)], "x", "m")
    assert not pl.called


@respx.mock
async def test_reabastecimento_recusado_e_pendente_apaga_a_pick_list():
    """Pick list pendente trava alteração de planograma: não pode sobrar."""
    instalacao()
    lista()
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9002}))
    rs = respx.post(f"{INST}/restock").mock(return_value=httpx.Response(422, json={"error": "não"}))
    detalhe(9002, [], pending=True)
    apaga = respx.delete(f"{INST}/pick_lists/9002").mock(return_value=httpx.Response(204))
    with pytest.raises(VMpayError):
        await conector().carregar(49, 857, [(163, 1.0)], "x", "m")
    assert apaga.called and rs.call_count == 1


@respx.mock
async def test_erro_na_resposta_mas_aplicada_conta_como_sucesso():
    """Timeout/5xx com a carga aplicada do lado de lá: marcar erro levaria a
    lançar de novo — e a VMpay carregaria duas vezes."""
    instalacao()
    lista()
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9003}))
    rs = respx.post(f"{INST}/restock").mock(return_value=httpx.Response(502))
    respx.get(f"{INST}/pick_lists/9003").mock(
        return_value=httpx.Response(
            200, json={"id": 9003, "pending": False, "status": "applied", "items": [{"good_id": 163, "quantity": 1}]}
        )
    )
    apaga = respx.delete(f"{INST}/pick_lists/9003")
    r = await conector().carregar(49, 857, [(163, 1.0)], "x", "m")
    assert r["carregados"] == {163: 1.0}
    assert rs.call_count == 1  # sem retry: repetir poderia carregar de novo
    assert not apaga.called


@respx.mock
async def test_criacao_sem_resposta_apaga_a_nossa_pela_marca():
    instalacao()
    respx.get(f"{INST}/pick_lists").mock(
        side_effect=[
            httpx.Response(200, json=[]),  # guard: nada pendente
            httpx.Response(200, json=[{"id": 9004, "pending": True, "notes": "Carga — [ação 8]"}]),
        ]
    )
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    pl = respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(504))
    apaga = respx.delete(f"{INST}/pick_lists/9004").mock(return_value=httpx.Response(204))
    with pytest.raises(VMpayError):
        await conector().carregar(49, 857, [(163, 1.0)], "Carga — [ação 8]", "[ação 8]")
    assert pl.call_count == 1 and apaga.called


@respx.mock
async def test_item_ignorado_pela_vmpay_nao_conta_como_carregado():
    instalacao()
    lista()
    respx.get(f"{INST}/current_planogram").mock(
        return_value=httpx.Response(
            200, json={"id": 777, "items": [{"id": 5001, "good_id": 163}, {"id": 5002, "good_id": 164}]}
        )
    )
    respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9005}))
    respx.post(f"{INST}/restock").mock(return_value=httpx.Response(200, json={}))
    detalhe(
        9005,
        [
            {"good_id": 163, "quantity": 2, "ignored": False},
            {"good_id": 164, "quantity": 3, "ignored": True, "ignore_reason": "Estoque disponível insuficiente"},
        ],
    )
    r = await conector().carregar(49, 857, [(163, 2.0), (164, 3.0)], "x", "m")
    assert r["carregados"] == {163: 2.0}
    assert r["ignorados"] == [{"good_id": 164, "motivo": "Estoque disponível insuficiente"}]


class Carregador(FakeConnector):
    def __init__(self, ignorar=None):
        super().__init__()
        self.ignorar = ignorar

    async def carregar(self, machine_id, installation_id, items, notas, marcador):
        self.calls.append(("carregar", machine_id, installation_id, items, notas, marcador))
        carregados = {g: q for g, q in items if g != self.ignorar}
        ignorados = [{"good_id": self.ignorar, "motivo": "Estoque disponível insuficiente"}] if self.ignorar else []
        return {"pick_list_id": 9001, "carregados": carregados, "ignorados": ignorados}


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


async def test_item_ignorado_nao_entra_no_saldo_do_painel(monkeypatch):
    fake = Carregador(ignorar=163)
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    rotas = [r if r[0] != "join core.location_link" else (r[0], [{**TARGET_ROW, "carga_como_carregamento": True}]) for r in rotas_de_sucesso()]
    sessao = use_session(rotas)
    resp = await call(
        "POST", "/orgs/mercadinho/stock/restock",
        json={"location_id": str(LOC_ID), "items": [{"product_id": str(PROD_ID), "quantity": 6}]},
    )
    assert resp.status_code == 201 and resp.json()["status"] == "parcial"
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "update core.stock_balance" not in sqls  # nada entrou de fato


@respx.mock
async def test_cancelada_depois_do_erro_nao_conta_como_carregada():
    """pending=false também é 'cancelled': só 'applied' é sucesso."""
    instalacao()
    lista()
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9006}))
    respx.post(f"{INST}/restock").mock(return_value=httpx.Response(502))
    respx.get(f"{INST}/pick_lists/9006").mock(
        return_value=httpx.Response(200, json={"id": 9006, "pending": False, "status": "cancelled"})
    )
    with pytest.raises(VMpayError):
        await conector().carregar(49, 857, [(163, 1.0)], "x", "m")


@respx.mock
async def test_sem_saber_se_entrou_e_carga_incerta():
    from vmpay_api.connector import CargaIncerta

    instalacao()
    lista()
    respx.get(f"{INST}/current_planogram").mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    respx.post(f"{INST}/pick_lists").mock(return_value=httpx.Response(201, json={"id": 9007}))
    respx.post(f"{INST}/restock").mock(return_value=httpx.Response(502))
    respx.get(f"{INST}/pick_lists/9007").mock(return_value=httpx.Response(503))
    apaga = respx.delete(f"{INST}/pick_lists/9007")
    with pytest.raises(CargaIncerta):
        await conector().carregar(49, 857, [(163, 1.0)], "x", "m")
    assert not apaga.called


async def test_carga_incerta_nao_vira_recusa(monkeypatch):
    from vmpay_api.connector import CargaIncerta

    class Incerto(Carregador):
        async def carregar(self, *a, **k):
            raise CargaIncerta(9007)

    fake = Incerto()
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    rotas = [r if r[0] != "join core.location_link" else (r[0], [{**TARGET_ROW, "carga_como_carregamento": True}]) for r in rotas_de_sucesso()]
    use_session(rotas)
    resp = await call(
        "POST", "/orgs/mercadinho/stock/restock",
        json={"location_id": str(LOC_ID), "items": [{"product_id": str(PROD_ID), "quantity": 1}]},
    )
    assert resp.status_code == 502 and "9007" in resp.json()["detail"] and "relançar" in resp.json()["detail"]
