"""Cadastro em lote: prévia, criação um a um e entrada na prateleira."""

import json
import uuid

import httpx
import pytest
import respx
from test_stock_routes import (
    LOC_ID,
    TARGET_ROW,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    use_role,
    use_session,
)
from vmpay import VMpayClient, VMpayError

from vmpay_api.connector import PlanogramView, VMpayConnector
from vmpay_api.routers import stock as stock_router
from vmpay_api.routers.cadastro_lote import _ean_valido

EXISTENTE = uuid.UUID("00000000-0000-0000-0000-0000000000c1")
NA_PRATELEIRA = uuid.UUID("00000000-0000-0000-0000-0000000000c2")

REFS = {
    "fabricantes": [{"id": 1, "nome": "Coca-Cola"}, {"id": 2, "nome": "Nestlé"}],
    "categorias": [{"id": 10, "nome": "Bebidas"}],
    "categorias_abastecimento": [{"id": 20, "nome": "Geladeira"}],
}

VIEW = PlanogramView(
    planogram_id=1,
    items=[
        {"id": 1, "good_id": 900, "type": "Coil", "logical_locator": "7", "capacity": 50.0, "par_level": 10.0, "alert_level": 2.0},
        {"id": 2, "good_id": 901, "type": "Coil", "logical_locator": "8", "capacity": 50.0, "par_level": 10.0, "alert_level": 2.0},
    ],
    items_by_good={},
)
VIEW.items_by_good = {i["good_id"]: i for i in VIEW.items}


class FakeConnector:
    def __init__(self, recusar_nome=None, recusar_prateleira=False):
        self.recusar_nome = recusar_nome
        self.recusar_prateleira = recusar_prateleira
        self.criados = []
        self.prateleira = []
        self.proximo_id = 5000

        class _Client:
            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, *a):
                return None

        self.client = _Client()

    async def product_refs(self):
        return REFS

    async def current_planogram(self, machine_id, installation_id):
        return VIEW

    async def create_product(self, fields):
        if fields["name"] == self.recusar_nome:
            raise VMpayError("nome já existe", status=422)
        self.criados.append(fields)
        self.proximo_id += 1
        return {"id": self.proximo_id, **fields}

    async def incluir_no_planograma(self, machine_id, installation_id, itens, view=None):
        if self.recusar_prateleira:
            raise VMpayError("pick list pendente", status=422)
        self.prateleira.extend(itens)
        return {"ok": True}


@pytest.fixture
def conector(monkeypatch):
    fake = FakeConnector()
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    return fake


def rotas():
    return [
        (
            "join core.product_link pl on pl.product_id = p.id",
            [
                {"id": EXISTENTE, "name": "Guaraná 2L", "barcode": "7891991000123", "external_id": "777"},
                {"id": NA_PRATELEIRA, "name": "Coca 2L", "barcode": "7894900027013", "external_id": "900"},
            ],
        ),
        ("join core.location_link", [TARGET_ROW]),
        ("insert into core.action_log", [(91,)]),
        ("insert into core.product ", [(uuid.uuid4(),)]),
    ]


CAB = "nome;codigo_barras;preco;fabricante;categoria;categoria_abastecimento;capacidade;nivel_ideal;nivel_alerta\n"


async def previa(conteudo):
    use_role("admin")
    use_session(rotas())
    resp = await call(
        "POST", "/orgs/mercadinho/products/lote/previa", json={"location_id": str(LOC_ID), "conteudo": conteudo}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_digito_verificador_do_ean():
    assert _ean_valido("7894900027013")
    assert not _ean_valido("7894900027014")
    assert _ean_valido("12345")  # código interno: sem regra


async def test_previa_cria_inclui_e_explica_os_erros(conector):
    corpo = await previa(
        CAB
        + "Água Nova 500ml;7891000315507;3,50;coca-cola;bebidas;GELADEIRA;;;\n"  # criar, padrões da loja
        + "Guaraná;7891991000123;8,00;;;;;;\n"  # já no cadastro → só incluir
        + "Coca;7894900027013;9,00;;;;;;\n"  # já na prateleira
        + "Suco;7891000315508;4,00;Coca-Cola;Bebidas;Geladeira;;;\n"  # dígito errado
        + "Chá;;5,00;Nestle;Bebidas;Geladera;;;\n"  # categoria de abastecimento com erro
        + "Bala;;1,00;Nestlé;Bebidas;Geladeira;10;20;2\n"  # ideal > capacidade
        + "Sem preço;;;Nestlé;Bebidas;Geladeira;;;\n"
    )
    assert corpo["resumo"] == {"criar": 1, "incluir": 1, "erros": 5}
    criar = next(i for i in corpo["itens"] if i["acao"] == "criar")
    assert criar["fabricante"] == {"id": 1, "nome": "Coca-Cola"}
    assert (criar["capacidade"], criar["nivel_ideal"], criar["nivel_alerta"]) == (50.0, 10.0, 2.0)
    incluir = next(i for i in corpo["itens"] if i["acao"] == "incluir")
    assert incluir["product_id"] == str(EXISTENTE)
    motivos = {e["linha"]: e["motivo"] for e in corpo["erros"]}
    assert "já na prateleira" in motivos[4]
    assert "dígito verificador" in motivos[5]
    assert 'seria "Geladeira"' in motivos[6]
    assert "maior que a capacidade" in motivos[7]
    assert "preço obrigatório" in motivos[8]
    assert conector.criados == [] and conector.prateleira == []  # prévia não escreve


async def test_codigo_repetido_na_planilha_e_erro(conector):
    corpo = await previa(
        CAB
        + "A;7891000315507;3,50;Nestlé;Bebidas;Geladeira;;;\n"
        + "B;7891000315507;3,50;Nestlé;Bebidas;Geladeira;;;\n"
    )
    assert corpo["resumo"]["erros"] == 2


def item(linha, acao="criar", nome="Água Nova", codigo="7891000315507", product_id=None):
    base = {
        "linha": linha,
        "acao": acao,
        "nome": nome,
        "codigo_barras": codigo,
        "product_id": product_id,
        "preco": 3.5,
        "capacidade": 50,
        "nivel_ideal": 10,
        "nivel_alerta": 2,
    }
    if acao == "criar":
        base |= {
            "fabricante": {"id": 1, "nome": "Coca-Cola"},
            "categoria": {"id": 10, "nome": "Bebidas"},
            "categoria_abastecimento": {"id": 20, "nome": "Geladeira"},
        }
    return base


async def aplicar(itens):
    use_role("admin")
    sessao = use_session(rotas())
    resp = await call("POST", "/orgs/mercadinho/products/lote/aplicar", json={"location_id": str(LOC_ID), "itens": itens})
    assert resp.status_code == 200, resp.text
    return resp.json(), sessao


async def test_aplicar_cria_um_a_um_e_inclui_todos_numa_prateleira_so(conector):
    corpo, sessao = await aplicar(
        [
            item(2),
            item(3, nome="Chá Gelado", codigo="7891000315514"),
            item(4, acao="incluir", nome="Guaraná 2L", codigo="7891991000123", product_id=str(EXISTENTE)),
        ]
    )
    assert [c["name"] for c in conector.criados] == ["Água Nova", "Chá Gelado"]
    assert [p["good_id"] for p in conector.prateleira] == [5001, 5002, 777]
    assert corpo["resumo"] == {"criados": 2, "na_prateleira": 3, "erros": 0}
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "insert into core.product_link" in sqls
    assert "insert into core.stock_balance" in sqls  # já aparece zerado na Prateleira


async def test_produto_recusado_nao_impede_os_outros(monkeypatch):
    fake = FakeConnector(recusar_nome="Chá Gelado")
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    corpo, _ = await aplicar([item(2), item(3, nome="Chá Gelado", codigo="7891000315514")])
    linhas = {r["linha"]: r for r in corpo["linhas"]}
    assert linhas[2]["status"] == "criado" and linhas[2]["prateleira"] == "incluido"
    assert linhas[3]["status"] == "erro" and "nome já existe" in linhas[3]["motivo"]
    assert [p["good_id"] for p in fake.prateleira] == [5001]


async def test_prateleira_recusada_deixa_o_cadastro_e_avisa(monkeypatch):
    fake = FakeConnector(recusar_prateleira=True)
    monkeypatch.setattr(stock_router, "get_connector", lambda config, token=None: fake)
    corpo, sessao = await aplicar([item(2)])
    assert corpo["linhas"][0] == {"linha": 2, "status": "criado", "product_id": corpo["linhas"][0]["product_id"], "prateleira": "erro"}
    assert "pick list pendente" in corpo["erro_prateleira"]
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "insert into core.stock_balance" not in sqls


async def test_codigo_que_ja_existe_no_aplicar_nao_duplica(conector):
    # Prévia velha: entre ela e o clique o Guaraná foi cadastrado.
    corpo, _ = await aplicar([item(2, nome="Guaraná", codigo="7891991000123")])
    assert conector.criados == []
    assert corpo["linhas"][0]["status"] == "ja_cadastrado"
    assert [p["good_id"] for p in conector.prateleira] == [777]


async def test_aplicar_respeita_a_trava(monkeypatch, conector):
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "0")
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("master")
    use_session(rotas())
    resp = await call("POST", "/orgs/mercadinho/products/lote/aplicar", json={"location_id": str(LOC_ID), "itens": [item(2)]})
    assert resp.status_code == 503
    assert conector.criados == []


# ---------------------------------------------------------------- conector

BASE = "https://homolog.test/api/v1"
URL = f"{BASE}/machines/49/installations/857/current_planogram"


@respx.mock
async def test_inclusao_numera_as_posicoes_depois_da_maior():
    respx.get(URL).mock(
        return_value=httpx.Response(
            200, json={"id": 1, "items": [{"id": 1, "good_id": 9, "logical_locator": "60"}, {"id": 2, "good_id": 8, "logical_locator": "A1"}]}
        )
    )
    rota = respx.patch(URL).mock(return_value=httpx.Response(200, json={"ok": True}))
    conn = VMpayConnector(VMpayClient("tok", base_url=BASE, max_retries=0))
    await conn.incluir_no_planograma(
        49, 857,
        [{"good_id": 10, "preco": 3.5, "capacidade": 50, "nivel_ideal": 10, "nivel_alerta": 2},
         {"good_id": 11, "preco": 4.0, "capacidade": 50, "nivel_ideal": 10, "nivel_alerta": 2}],
    )
    attrs = json.loads(rota.calls.last.request.content)["planogram"]["items_attributes"]
    assert [(a["good_id"], a["logical_locator"], a["name"]) for a in attrs] == [(10, 61, "61"), (11, 62, "62")]
    assert all(a["type"] == "Coil" and a["status"] == "active" and a["use_default_price_product"] is False for a in attrs)


@respx.mock
async def test_refs_sem_permissao_de_abastecimento_vem_vazia():
    """Doc da VMpay: a categoria de abastecimento só é obrigatória para quem usa
    mais de uma — e o token da demo nem enxerga a lista (401)."""
    respx.get(f"{BASE}/manufacturers").mock(return_value=httpx.Response(200, json=[{"id": 1, "name": "X"}]))
    respx.get(f"{BASE}/categories").mock(return_value=httpx.Response(200, json=[{"id": 2, "name": "Y"}]))
    respx.get(f"{BASE}/supply_categories").mock(return_value=httpx.Response(401, json={}))
    conn = VMpayConnector(VMpayClient("tok", base_url=BASE, max_retries=0))
    refs = await conn.product_refs()
    assert refs["categorias_abastecimento"] == [] and refs["fabricantes"] == [{"id": 1, "nome": "X"}]


@pytest.mark.parametrize(
    ("abastecimento", "esperado"),
    [([], None), ([{"id": 20, "nome": "Geladeira"}], {"id": 20, "nome": "Geladeira"})],
)
async def test_sem_varias_categorias_de_abastecimento_a_coluna_e_opcional(monkeypatch, conector, abastecimento, esperado):
    monkeypatch.setitem(REFS, "categorias_abastecimento", abastecimento)
    corpo = await previa(CAB + "Água Nova;;3,50;Nestlé;Bebidas;;;;\n")
    assert corpo["resumo"]["criar"] == 1, corpo["erros"]
    assert corpo["itens"][0].get("categoria_abastecimento") == esperado


async def test_com_varias_categorias_de_abastecimento_continua_obrigatoria(monkeypatch, conector):
    monkeypatch.setitem(
        REFS, "categorias_abastecimento", [{"id": 20, "nome": "Geladeira"}, {"id": 21, "nome": "Seco"}]
    )
    corpo = await previa(CAB + "Água Nova;;3,50;Nestlé;Bebidas;;;;\n")
    assert "categoria_abastecimento vazia" in corpo["erros"][0]["motivo"]
