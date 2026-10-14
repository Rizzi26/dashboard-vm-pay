"""Preço em lote: leitura da planilha, prévia e aplicação."""

import uuid
from decimal import Decimal

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
from vmpay_api.planilha_precos import PlanilhaInvalida, ler_planilha, ler_preco
from vmpay_api.routers import stock as stock_router

PROD_2 = uuid.UUID("00000000-0000-0000-0000-00000000f002")
PROD_3 = uuid.UUID("00000000-0000-0000-0000-00000000f003")


# ------------------------------------------------------------ leitura do CSV


@pytest.mark.parametrize(
    ("bruto", "esperado"),
    [
        ("6,99", "6.99"),
        ("R$ 6,99", "6.99"),
        ("6.99", "6.99"),
        ("10", "10.00"),
        ("1.299,90", "1299.90"),
        (" 4,5 ", "4.50"),
    ],
)
def test_preco_aceita_o_que_o_excel_produz(bruto, esperado):
    assert ler_preco(bruto) == Decimal(esperado)


@pytest.mark.parametrize("bruto", ["1.299", "0", "-3", "6,999", "abc", "15000"])
def test_preco_ambiguo_ou_absurdo_e_recusado(bruto):
    with pytest.raises(ValueError):
        ler_preco(bruto)


def test_planilha_com_virgula_do_google_sheets_e_bom():
    conteudo = f'﻿id,loja,produto,preco_novo\n{PROD_ID},Loja,Água,"7,50"\n{PROD_2},Loja,Suco,\n'
    linhas = ler_planilha(conteudo)
    assert [(ln.product_id, ln.preco_novo) for ln in linhas] == [
        (PROD_ID, Decimal("7.50")),
        (PROD_2, None),  # em branco = não mexer
    ]


def test_planilha_sem_coluna_obrigatoria_e_recusada_inteira():
    with pytest.raises(PlanilhaInvalida, match="preco_novo"):
        ler_planilha("id;produto\nx;y\n")


def test_id_estragado_vira_erro_da_linha_nao_do_arquivo():
    linhas = ler_planilha(f"id;preco_novo\nnao-e-uuid;5,00\n{PROD_ID};6,00\n")
    assert linhas[0].erro and linhas[0].linha == 2
    assert linhas[1].erro is None


# -------------------------------------------------------------- prévia/aplicar


def item(id_, good, preco, **extra):
    return {"id": id_, "good_id": good, "desired_price": preco, "status": "active", **extra}


PLANOGRAMA = PlanogramView(
    planogram_id=1,
    items=[
        item(501, 163, 3.5),
        item(502, 164, 5.0, use_default_price_product=True),
        item(503, 165, 2.0, promotional_price=1.5),
    ],
    items_by_good={},
)
PLANOGRAMA.items_by_good = {i["good_id"]: i for i in PLANOGRAMA.items}


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
        return PLANOGRAMA

    async def set_price(self, machine_id, installation_id, changes, view=None):
        self.calls.append(("price", machine_id, installation_id, changes))
        if self.fail:
            raise VMpayError(self.fail, status=422)
        return {"ok": True}


@pytest.fixture
def conector(monkeypatch):
    fake = FakeConnector()
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    return fake


def produto(pid, nome, external, preco):
    return {
        "product_id": pid,
        "name": nome,
        "barcode": "789",
        "quantity": 4,
        "preco": preco,
        "external_id": external,
    }


def rotas():
    return [
        (
            "left join core.product_link pl",
            [
                produto(PROD_ID, "Água", "163", 3.5),
                produto(PROD_2, "Suco", "164", 5.0),
                produto(PROD_3, "Bala", "165", 2.0),
            ],
        ),
        ("join core.location_link", [TARGET_ROW]),
        (
            "from core.product_link",
            [
                {"product_id": PROD_ID, "external_id": "163"},
                {"product_id": PROD_2, "external_id": "164"},
            ],
        ),
        ("insert into core.action_log", [(88,)]),
    ]


def csv_(*linhas):
    return "id;loja;produto;preco_novo\n" + "\n".join(linhas) + "\n"


async def test_previa_separa_alterar_igual_branco_e_erro(conector):
    use_role("admin")
    use_session(rotas())
    loja = TARGET_ROW["name"]
    conteudo = csv_(
        f"{PROD_ID};{loja};Água;7,00",  # +100% → alterar com aviso
        f"{PROD_3};{loja};Bala;2,00",  # igual ao planograma
        f"{PROD_2};{loja};Suco;",  # em branco
        f"{uuid.uuid4()};{loja};Fantasma;1,00",  # não é desta loja
        f"{PROD_2};Outra loja;Suco;3,00",  # loja errada
    )
    resp = await call("POST", "/orgs/mercadinho/stock/precos/previa", json={"location_id": str(LOC_ID), "conteudo": conteudo})
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert corpo["resumo"] == {"alterar": 1, "iguais": 1, "em_branco": 1, "erros": 2}
    alt = corpo["alterar"][0]
    assert (alt["preco_atual"], alt["preco_novo"]) == (3.5, 7.0)
    assert any("variação" in a for a in alt["avisos"])
    assert {e["linha"] for e in corpo["erros"]} == {5, 6}
    assert conector.calls == []  # prévia nunca escreve


async def test_previa_avisa_preco_padrao_e_promocao(conector):
    use_role("admin")
    use_session(rotas())
    conteudo = csv_(f"{PROD_2};;Suco;5,00", f"{PROD_3};;Bala;2,20")
    corpo = (await call("POST", "/orgs/mercadinho/stock/precos/previa", json={"location_id": str(LOC_ID), "conteudo": conteudo})).json()
    avisos = {a["produto"]: " ".join(a["avisos"]) for a in corpo["alterar"]}
    # mesmo preço, mas com "usar preço padrão" ligado o desired_price é ignorado
    assert "preço padrão" in avisos["Suco"]
    assert "promocional" in avisos["Bala"]


async def test_produto_repetido_na_planilha_e_erro(conector):
    use_role("admin")
    use_session(rotas())
    conteudo = csv_(f"{PROD_ID};;Água;4,00", f"{PROD_ID};;Água;4,50")
    corpo = (await call("POST", "/orgs/mercadinho/stock/precos/previa", json={"location_id": str(LOC_ID), "conteudo": conteudo})).json()
    assert corpo["resumo"]["erros"] == 2 and corpo["resumo"]["alterar"] == 0


async def test_viewer_nao_gera_previa():
    use_role("viewer")
    use_session(rotas())
    resp = await call("POST", "/orgs/mercadinho/stock/precos/previa", json={"location_id": str(LOC_ID), "conteudo": "id;preco_novo\n"})
    assert resp.status_code == 403


async def test_aplicar_manda_um_patch_e_so_o_que_mudou(conector):
    use_role("admin")
    sessao = use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/precos/aplicar",
        json={
            "location_id": str(LOC_ID),
            "itens": [
                {"product_id": str(PROD_ID), "preco": 4.25},
                {"product_id": str(PROD_2), "preco": 5.0},  # mesmo preço, mas usava o padrão
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["aplicados"] == 2
    assert conector.calls == [("price", 49, 857, [(163, 4.25), (164, 5.0)])]
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "insert into core.action_log" in sqls
    assert "update core.product " not in sqls  # preço é da loja


async def test_reaplicar_a_mesma_planilha_nao_escreve(conector):
    use_role("admin")
    use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/precos/aplicar",
        json={"location_id": str(LOC_ID), "itens": [{"product_id": str(PROD_ID), "preco": 3.5}]},
    )
    assert resp.json()["status"] == "sem_mudancas"
    assert conector.calls == []


async def test_recusa_da_vmpay_fecha_o_log_com_erro(monkeypatch):
    fake = FakeConnector(fail="pick list pendente")
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    sessao = use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/precos/aplicar",
        json={"location_id": str(LOC_ID), "itens": [{"product_id": str(PROD_ID), "preco": 4.0}]},
    )
    assert resp.status_code == 502
    assert "nenhum foi alterado" in resp.json()["detail"]
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "update core.stock_balance" not in sqls


async def test_aplicar_respeita_a_trava_de_escrita(monkeypatch, conector):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("master")
    use_session(rotas())
    resp = await call(
        "POST",
        "/orgs/mercadinho/stock/precos/aplicar",
        json={"location_id": str(LOC_ID), "itens": [{"product_id": str(PROD_ID), "preco": 4.0}]},
    )
    assert resp.status_code == 503
    assert conector.calls == []


async def test_planilha_da_loja_sai_com_preco_novo_em_branco():
    use_role("viewer")
    use_session(rotas())
    resp = await call("GET", f"/orgs/mercadinho/stock/precos/planilha.csv?location_id={LOC_ID}")
    assert resp.status_code == 200
    texto = resp.content.decode("utf-8")
    assert texto.startswith("﻿id;loja;produto;codigo_barras;saldo;preco_atual;preco_novo")
    assert f"{PROD_ID};{TARGET_ROW['name']};Água;789;4;3,50;\r\n" in texto
