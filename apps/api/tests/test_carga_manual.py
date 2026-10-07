"""Carga manual: recibo avulso (sem chave) montado com produtos do sistema."""

import uuid
from datetime import datetime, timezone

from test_stock_routes import (
    LOC_ID,
    ORG_ID,
    PROD_ID,
    TARGET_ROW,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    use_connector,
    use_role,
    use_session,
)

RECEIPT_ID = uuid.UUID("00000000-0000-0000-0000-0000000ca7a0")
OUTRO_PROD = uuid.UUID("00000000-0000-0000-0000-00000000f00f")
URL = "/orgs/mercadinho/picklist/manual"


def body(**extra):
    base = {
        "location_id": str(LOC_ID),
        "fornecedor": "  Atacadão  ",
        "valor_total": "87.40",
        "itens": [
            {"product_id": str(PROD_ID), "quantidade": "6"},
            {"product_id": str(OUTRO_PROD), "quantidade": "2"},
            {"product_id": str(PROD_ID), "quantidade": "4"},
        ],
    }
    return {**base, **extra}


def rotas(nomes=None, links=None):
    return [
        ("join core.location_link", [TARGET_ROW]),
        ("from core.product_link", links if links is not None else [
            {"product_id": PROD_ID, "external_id": "163"},
            {"product_id": OUTRO_PROD, "external_id": "164"},
        ]),
        ("from core.product\n", nomes if nomes is not None else [
            {"id": PROD_ID, "name": "Água Mineral Crystal 500ml"},
            {"id": OUTRO_PROD, "name": "Biscoito Look"},
        ]),
        ("insert into core.purchase_receipt_item", []),
        ("insert into core.purchase_receipt", [(RECEIPT_ID,)]),
        ("insert into core.action_log", [(91,)]),
    ]


async def test_carga_manual_grava_recibo_avulso_antes_do_restock(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas())
    fake = use_connector(monkeypatch)

    resp = await call("POST", URL, json=body())
    assert resp.status_code == 201, resp.text
    assert resp.json()["receipt_id"] == str(RECEIPT_ID)

    # O mesmo produto adicionado duas vezes vira um ajuste só (6 + 4).
    assert fake.calls == [("restock", 49, 857, [(163, 10.0), (164, 2.0)])]

    sqls = [sql for sql, _ in sessao.executed]
    i_recibo = next(i for i, s in enumerate(sqls) if "insert into core.purchase_receipt\n" in s)
    i_log = next(i for i, s in enumerate(sqls) if "insert into core.action_log" in s)
    assert i_recibo < i_log  # o recibo vai no commit do log pendente

    recibo = next(p for s, p in sessao.executed if "insert into core.purchase_receipt\n" in s)
    assert "'avulsa'" in next(s for s in sqls if "insert into core.purchase_receipt\n" in s)
    assert recibo["nome"] == "Atacadão"  # aparado
    assert str(recibo["total"]) == "87.40"
    assert recibo["org_id"] == str(ORG_ID)

    itens = [p for s, p in sessao.executed if "insert into core.purchase_receipt_item" in s]
    assert [(i["linha"], i["descricao"], float(i["quantidade"])) for i in itens] == [
        (1, "Água Mineral Crystal 500ml", 10.0),
        (2, "Biscoito Look", 2.0),
    ]

    log = next(p for s, p in sessao.executed if "insert into core.action_log" in s)
    assert log["action"] == "picklist.manual"
    assert str(RECEIPT_ID) in log["params"]
    # Nada de supplier_product_map: sem código de fornecedor não há de-para.
    assert not any("supplier_product_map" in s for s in sqls)
    status = [p["status"] for s, p in sessao.executed if "update core.purchase_receipt" in s]
    assert status == ["approved"]


async def test_carga_manual_sem_fornecedor_nem_valor(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas())
    use_connector(monkeypatch)
    resp = await call("POST", URL, json=body(fornecedor="   ", valor_total=None))
    assert resp.status_code == 201, resp.text
    recibo = next(p for s, p in sessao.executed if "insert into core.purchase_receipt\n" in s)
    assert recibo["nome"] is None and recibo["total"] is None


async def test_produto_de_outra_conta_recusado(monkeypatch):
    use_role("admin")
    # OUTRO_PROD não tem vínculo com a integração da loja.
    sessao = use_session(rotas(links=[{"product_id": PROD_ID, "external_id": "163"}]))
    fake = use_connector(monkeypatch)
    resp = await call("POST", URL, json=body())
    assert resp.status_code == 422
    assert str(OUTRO_PROD) in resp.text
    assert fake.calls == []
    assert not any("insert into" in s for s, _ in sessao.executed)


async def test_produto_de_outra_organizacao_recusado(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas(nomes=[{"id": PROD_ID, "name": "Água"}]))
    fake = use_connector(monkeypatch)
    resp = await call("POST", URL, json=body())
    assert resp.status_code == 422
    assert "fora desta organização" in resp.text
    assert fake.calls == []
    assert not any("insert into" in s for s, _ in sessao.executed)
    _, params = next((q, p) for q, p in sessao.executed if "from core.product\n" in q)
    assert params["org_id"] == str(ORG_ID)


async def test_viewer_nao_lanca_carga():
    use_role("viewer")
    use_session([])
    assert (await call("POST", URL, json=body())).status_code == 403


async def test_quantidade_zero_422():
    use_role("admin")
    use_session(rotas())
    resp = await call("POST", URL, json=body(itens=[{"product_id": str(PROD_ID), "quantidade": "0"}]))
    assert resp.status_code == 422


async def test_vmpay_recusa_marca_erro(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas())
    use_connector(monkeypatch, fail="fora do planograma")
    resp = await call("POST", URL, json=body())
    assert resp.status_code == 502
    status = [p for s, p in sessao.executed if "update core.purchase_receipt" in s]
    assert status == [{"status": "error", "action_id": 91, "id": str(RECEIPT_ID)}]


async def test_escrita_travada_503_sem_gravar_nada(monkeypatch):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings
    settings.cache_clear()
    use_role("admin")
    sessao = use_session(rotas())
    resp = await call("POST", URL, json=body())
    assert resp.status_code == 503
    assert not any("insert into" in s for s, _ in sessao.executed)


async def test_historico_e_detalhe_com_recibo_sem_chave():
    use_role("admin")
    quando = datetime(2026, 10, 7, tzinfo=timezone.utc)
    use_session([
        ("left join core.purchase_receipt_item i on i.receipt_id", [{
            "id": RECEIPT_ID, "access_key": None, "number": None, "supplier_name": "Atacadão",
            "total": 87.4, "status": "approved", "source": "avulsa", "created_at": quando,
            "location_name": "Loja", "itens": 2,
        }]),
    ])
    lista = await call("GET", "/orgs/mercadinho/picklist")
    assert lista.status_code == 200, lista.text
    assert lista.json()[0]["access_key"] is None
    assert lista.json()[0]["source"] == "avulsa"

    use_session([
        ("from core.purchase_receipt r", [{
            "id": RECEIPT_ID, "access_key": None, "number": None, "series": None, "issued_at": None,
            "supplier_tax_id": None, "supplier_name": None, "total": None, "source": "avulsa",
            "status": "approved", "created_at": quando, "location_name": "Loja",
            "aprovado_por": "op@teste.dev", "vmpay_status": "success", "vmpay_erro": None,
        }]),
        ("from core.purchase_receipt_item i", [
            {"line": 1, "supplier_code": None, "description": "Biscoito Look", "quantity": 3, "unit": "UN",
             "unit_price": None, "total": None, "factor": 1, "ignored": False,
             "product_id": OUTRO_PROD, "product_name": "Biscoito Look"},
        ]),
    ])
    resp = await call("GET", f"/orgs/mercadinho/picklist/{RECEIPT_ID}")
    assert resp.status_code == 200, resp.text
    det = resp.json()
    assert det["chave"] is None and det["origem"] == "avulsa"
    assert det["fornecedor"] == {"cnpj": None, "nome": None}
    assert det["itens"][0]["entrou"] == 3.0


async def test_cargas_do_produto_com_recibo_sem_chave():
    use_role("admin")
    use_session([
        ("from core.purchase_receipt_item i", [{
            "id": RECEIPT_ID, "number": None, "access_key": None, "source": "avulsa",
            "supplier_name": "Atacadão", "created_at": datetime(2026, 10, 7, tzinfo=timezone.utc),
            "status": "approved", "location_name": "Loja", "aprovado_por": "op@teste.dev",
            "vmpay_status": "success", "vmpay_erro": None, "unidades": 6,
        }]),
    ])
    resp = await call("GET", f"/orgs/mercadinho/stock/cargas/{PROD_ID}")
    assert resp.status_code == 200, resp.text
    c = resp.json()[0]
    assert c["chave"] is None and c["origem"] == "avulsa" and c["fornecedor"] == "Atacadão"
    assert c["unidades"] == 6.0
