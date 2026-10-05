"""Pick list: consulta na SEFAZ, conferência e aprovação como restock."""

import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import respx
from test_stock_routes import (
    LOC_ID,
    PROD_ID,
    TARGET_ROW,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    use_connector,
    use_role,
    use_session,
)

from vmpay_api import nfce
from vmpay_api.routers import picklist

PAGINA = (Path(__file__).parent / "fixtures" / "nfce_sp_qrcode.html").read_text(encoding="utf-8")
CHAVE = "35260911222333000181650010000141921386520530"
CNPJ = "11222333000181"
P = f"{CHAVE}|2|1|2|{'0' * 40}"
RECEIPT_ID = uuid.UUID("00000000-0000-0000-0000-0000000c0de0")
OUTRO_PROD = uuid.UUID("00000000-0000-0000-0000-00000000f00f")


def aprovar_body(**extra):
    base = {
        "chave": CHAVE,
        "origem": "qrcode",
        "location_id": str(LOC_ID),
        "numero": "14192",
        "fornecedor_nome": "DISTRIBUIDORA EXEMPLO LTDA",
        "valor_total": "616.92",
        "itens": [
            {"linha": 1, "codigo": "24344", "descricao": "BISC. BAUDUCCO", "quantidade": "3",
             "product_id": str(PROD_ID)},
            {"linha": 2, "codigo": "6315", "descricao": "BISC. LOOK", "quantidade": "2",
             "product_id": str(PROD_ID), "fator": "6"},
            {"linha": 3, "codigo": "999", "descricao": "P.H NEVE", "quantidade": "1", "ignorar": True},
        ],
    }
    return {**base, **extra}


def rotas_aprovacao(existente=None):
    return [
        ("from core.purchase_receipt\n", [existente] if existente else []),
        ("join core.location_link", [TARGET_ROW]),
        ("from core.product_link", [{"product_id": PROD_ID, "external_id": "163"}]),
        ("insert into core.purchase_receipt_item", []),
        ("insert into core.purchase_receipt", [(RECEIPT_ID,)]),
        ("insert into core.action_log", [(77,)]),
    ]


# ------------------------------------------------------------------ consulta


@respx.mock
async def test_consulta_traz_cupom_com_de_para_lembrado():
    respx.get(nfce.SP_QRCODE_URL).mock(return_value=httpx.Response(200, text=PAGINA))
    use_role("admin")
    use_session(
        [
            ("from core.purchase_receipt", []),
            ("from core.supplier_product_map",
             [{"supplier_code": "24344", "product_id": PROD_ID, "factor": 1, "ignored": False}]),
            ("join core.product_link", [
                {"id": OUTRO_PROD, "name": "Chocolate Lacta Diamante Negro 80g", "barcode": None},
                {"id": uuid.UUID(int=1), "name": "Chocolate Lacta ao Leite 80g", "barcode": None},
                {"id": uuid.UUID(int=2), "name": "Chocolate Ouro Branco 20g", "barcode": None},
            ]),
        ]
    )
    url = f"{nfce.SP_QRCODE_URL}?p={P.replace('|', '%7C')}"
    resp = await call("POST", "/orgs/mercadinho/picklist/consulta", json={"entrada": url})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["origem"] == "qrcode"
    assert body["fornecedor_cnpj"] == CNPJ
    itens = body["cupom"]["itens"]
    assert len(itens) == 25
    assert itens[0]["product_id"] == str(PROD_ID)
    assert itens[0]["vinculo"] == "lembrado"
    diamante = next(i for i in itens if "DIAMANTE" in i["descricao"])
    assert diamante["sugestoes"][0] == str(OUTRO_PROD)
    assert diamante["product_id"] is None


async def test_consulta_so_chave_nao_bate_na_sefaz():
    use_role("admin")
    use_session([("from core.purchase_receipt", [])])
    with respx.mock:  # qualquer requisição externa falharia o teste
        resp = await call("POST", "/orgs/mercadinho/picklist/consulta", json={"entrada": CHAVE})
    body = resp.json()
    assert body["origem"] == "manual"
    assert body["cupom"] is None
    assert body["consulta_url"] == nfce.SP_CONSULTA_CHAVE_URL


async def test_consulta_avisa_cupom_ja_carregado():
    use_role("admin")
    use_session([("from core.purchase_receipt",
                  [{"id": RECEIPT_ID, "status": "approved", "created_at": datetime(2026, 10, 1, tzinfo=timezone.utc)}])])
    body = (await call("POST", "/orgs/mercadinho/picklist/consulta", json={"entrada": CHAVE})).json()
    assert body["ja_carregado"]["status"] == "approved"


async def test_consulta_url_de_outro_host_422():
    use_role("admin")
    use_session([])
    resp = await call("POST", "/orgs/mercadinho/picklist/consulta",
                      json={"entrada": f"http://169.254.169.254/latest?p={P}"})
    assert resp.status_code == 422


async def test_viewer_nao_usa_picklist():
    use_role("viewer")
    use_session([])
    resp = await call("POST", "/orgs/mercadinho/picklist/consulta", json={"entrada": CHAVE})
    assert resp.status_code == 403


# ----------------------------------------------------------------- aprovação


async def test_aprovar_soma_por_produto_aplica_fator_e_lembra_vinculo(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_aprovacao())
    fake = use_connector(monkeypatch)

    resp = await call("POST", "/orgs/mercadinho/picklist/aprovar", json=aprovar_body())
    assert resp.status_code == 201, resp.text
    assert resp.json()["receipt_id"] == str(RECEIPT_ID)

    # 3 + 2×6 do mesmo produto viram UM ajuste de 15; o ignorado fica fora
    assert fake.calls == [("restock", 49, 857, [(163, 15.0)])]

    sqls = [sql for sql, _ in sessao.executed]
    i_cupom = next(i for i, s in enumerate(sqls) if "insert into core.purchase_receipt\n" in s)
    i_log = next(i for i, s in enumerate(sqls) if "insert into core.action_log" in s)
    assert i_cupom < i_log  # o cupom vai no commit do log pendente

    mapas = [p for s, p in sessao.executed if "insert into core.supplier_product_map" in s]
    assert {m["codigo"]: m["ignorar"] for m in mapas} == {"24344": False, "6315": False, "999": True}
    assert all(m["cnpj"] == CNPJ for m in mapas)

    status = [p["status"] for s, p in sessao.executed if "update core.purchase_receipt" in s]
    assert status == ["approved"]
    params = next(p for s, p in sessao.executed if "insert into core.action_log" in s)
    assert params["action"] == "picklist.approve"


async def test_aprovar_vmpay_recusa_marca_erro(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_aprovacao())
    use_connector(monkeypatch, fail="planograma inválido")
    resp = await call("POST", "/orgs/mercadinho/picklist/aprovar", json=aprovar_body())
    assert resp.status_code == 502
    status = [p for s, p in sessao.executed if "update core.purchase_receipt" in s]
    assert status == [{"status": "error", "action_id": 77, "id": str(RECEIPT_ID)}]


async def test_aprovar_cupom_ja_carregado_409(monkeypatch):
    use_role("admin")
    use_session(rotas_aprovacao({"id": RECEIPT_ID, "status": "approved", "created_at": None}))
    fake = use_connector(monkeypatch)
    resp = await call("POST", "/orgs/mercadinho/picklist/aprovar", json=aprovar_body())
    assert resp.status_code == 409
    assert fake.calls == []


async def test_reaprovar_depois_de_erro_substitui(monkeypatch):
    use_role("admin")
    sessao = use_session(rotas_aprovacao({"id": RECEIPT_ID, "status": "error", "created_at": None}))
    use_connector(monkeypatch)
    resp = await call("POST", "/orgs/mercadinho/picklist/aprovar", json=aprovar_body())
    assert resp.status_code == 201
    assert any("delete from core.purchase_receipt" in s for s, _ in sessao.executed)


async def test_aprovar_item_sem_vinculo_422(monkeypatch):
    use_role("admin")
    use_session(rotas_aprovacao())
    body = aprovar_body()
    body["itens"][0]["product_id"] = None
    resp = await call("POST", "/orgs/mercadinho/picklist/aprovar", json=body)
    assert resp.status_code == 422
    assert "item 1" in resp.text


async def test_aprovar_com_escrita_travada_503(monkeypatch):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings
    settings.cache_clear()
    use_role("admin")
    sessao = use_session(rotas_aprovacao())
    resp = await call("POST", "/orgs/mercadinho/picklist/aprovar", json=aprovar_body())
    assert resp.status_code == 503
    assert not any("insert into" in s for s, _ in sessao.executed)


def _produto(nome, i):
    return {"id": f"p{i}", "name": nome, "_palavras": picklist._palavras(nome)}


def test_sugestao_entende_abreviacao_de_cupom():
    catalogo = [
        _produto(n, i)
        for i, n in enumerate(
            [
                "PRESUNTO COZIDO FATIADO SEARA 180G",
                "PRESUNTO COZIDO SEARA 150G",
                "MORTADELA SEARA DEF FAT 180G",
                "QUEIJO PRATO FATIADO 150G IPANEMA",
                "MUSSARELA  IPANEMA 150 G",
                "AGUA MINERAL CRYSTAL S/GAS 500",
            ]
        )
    ]
    assert picklist._sugerir("PRES.SEARA FAT.", catalogo)[0] == "p0"
    assert picklist._sugerir("QJO PRATO IPANEMA", catalogo)[0] == "p3"
    # ambíguo (é mussarela, mas "QJO … FAT" puxa o prato): os dois aparecem
    assert {"p3", "p4"} <= set(picklist._sugerir("QJO MUSS.IPANEMA FAT", catalogo))
    # marca que o catálogo não tem não derruba o produto certo
    catalogo.append(_produto("TORTUGUITA BRIGADEIRO 15,5G", 9))
    catalogo.append(_produto("CHOCOLATE LACTA SHOT 80G", 10))
    assert picklist._sugerir("CHOC ARCOR TORTUGUIT", catalogo)[0] == "p9"
    # número sozinho não sugere nada
    assert picklist._sugerir("500", catalogo) == []
