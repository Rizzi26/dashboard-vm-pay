"""Cadastro unitário já na prateleira, e exclusão de produto pelo painel."""

import uuid

import pytest
from test_product_actions import (
    BODY,
    INTEG_ID,
    PROD_ID,
    FakeConnector,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    rotas_de_sucesso,
    use_role,
    use_session,
)
from vmpay import VMpayError

from vmpay_api.routers import products as products_router

LOJA = uuid.UUID("00000000-0000-0000-0000-00000000eeee")
ALVO = {
    "location_id": LOJA,
    "name": "Loja",
    "machine_id": 49,
    "installation_id": 857,
    "integration_id": INTEG_ID,
    "config": {},
}


class Conector(FakeConnector):
    def __init__(self, fail=None, recusar_prateleira=False):
        super().__init__(fail)
        self.recusar_prateleira = recusar_prateleira

    async def incluir_no_planograma(self, machine_id, installation_id, itens, view=None):
        self.calls.append(("prateleira", machine_id, installation_id, itens))
        if self.recusar_prateleira:
            raise VMpayError("pick list pendente", status=422)

    async def delete_product(self, good_id):
        self.calls.append(("delete", good_id))


@pytest.fixture
def conector(monkeypatch):
    fake = Conector()
    monkeypatch.setattr(products_router, "get_connector", lambda config, token=None: fake)
    return fake


COM_PRATELEIRA = {**BODY, "loja": str(LOJA), "prateleira": {"capacidade": 50, "nivel_ideal": 10, "nivel_alerta": 2}}


async def test_cadastro_unitario_ja_entra_na_prateleira(conector):
    use_role("admin")
    sessao = use_session([*rotas_de_sucesso(), ("join core.location_link", [ALVO])])
    resp = await call("POST", "/orgs/mercadinho/products", json=COM_PRATELEIRA)
    assert resp.status_code == 201, resp.text
    assert resp.json()["prateleira"] == "incluido"
    item = next(c for c in conector.calls if c[0] == "prateleira")
    assert item[1:3] == (49, 857) and item[3][0]["good_id"] == 555 and item[3][0]["preco"] == 4.5
    assert "insert into core.stock_balance" in " ".join(sql for sql, _ in sessao.executed)


async def test_prateleira_recusada_mantem_o_cadastro(monkeypatch):
    fake = Conector(recusar_prateleira=True)
    monkeypatch.setattr(products_router, "get_connector", lambda config, token=None: fake)
    use_role("admin")
    use_session([*rotas_de_sucesso(), ("join core.location_link", [ALVO])])
    resp = await call("POST", "/orgs/mercadinho/products", json=COM_PRATELEIRA)
    assert resp.status_code == 201
    assert resp.json()["prateleira"] == "erro" and "pick list" in resp.json()["erro_prateleira"]


async def test_prateleira_exige_loja_e_preco(conector):
    use_role("admin")
    use_session(rotas_de_sucesso())
    sem_preco = {**COM_PRATELEIRA, "preco": None}
    assert (await call("POST", "/orgs/mercadinho/products", json=sem_preco)).status_code == 422
    assert conector.calls == []


def rotas_exclusao(uso=None, nome="TESTE CLAUDE - PODE APAGAR"):
    base = {"prateleiras": 0, "fotos": 0, "movimentos": 0, "cargas": 0, "vendas": 0}
    return [
        ("select name from core.product", [(nome,)]),
        ("as prateleiras", [{**base, **(uso or {})}]),
        ("from core.product_link pl", [{"external_id": "46509326", "integration_id": INTEG_ID, "config": {}}]),
        ("insert into core.action_log", [(99,)]),
    ]


async def excluir(confirmar):
    return await call("DELETE", f"/orgs/mercadinho/products/{PROD_ID}?confirmar={confirmar}")


async def test_exclui_na_vmpay_e_limpa_o_espelho(conector):
    use_role("admin")
    sessao = use_session(rotas_exclusao())
    resp = await excluir("teste claude - pode apagar")  # sem diferenciar maiúscula
    assert resp.status_code == 200, resp.text
    assert ("delete", 46509326) in conector.calls
    sqls = " ".join(sql for sql, _ in sessao.executed)
    assert "delete from core.product_link" in sqls and "delete from core.product where" in sqls


async def test_confirmacao_errada_nao_exclui(conector):
    use_role("admin")
    use_session(rotas_exclusao())
    resp = await excluir("outro nome")
    assert resp.status_code == 422 and conector.calls == []


@pytest.mark.parametrize("uso", [{"prateleiras": 1}, {"vendas": 3}, {"cargas": 1}])
async def test_produto_com_loja_ou_historico_nao_se_exclui(conector, uso):
    use_role("admin")
    use_session(rotas_exclusao(uso))
    resp = await excluir("TESTE CLAUDE - PODE APAGAR")
    assert resp.status_code == 409 and "tire de linha" in resp.json()["detail"]
    assert conector.calls == []


async def test_viewer_nao_exclui(conector):
    use_role("viewer")
    use_session(rotas_exclusao())
    assert (await excluir("TESTE CLAUDE - PODE APAGAR")).status_code == 403
