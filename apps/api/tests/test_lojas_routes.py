"""Central das lojas: um cartão por loja, só da organização de quem pede."""

import uuid
from datetime import datetime, timezone

from test_stock_routes import ORG_ID, _clean, call, use_role, use_session  # noqa: F401

LOJA_A = uuid.UUID("00000000-0000-0000-0000-00000000000a")
LOJA_B = uuid.UUID("00000000-0000-0000-0000-00000000000b")
AGORA = datetime(2026, 10, 6, 15, 0, tzinfo=timezone.utc)


def loja(id_, nome, d30, transacoes, zerados):
    return {"id": id_, "name": nome, "hoje": 120.0, "d7": 800.0, "d30": d30,
            "transacoes_30d": transacoes, "ultima_venda": AGORA, "itens": 300,
            "zerados": zerados, "unidades": 900, "atualizado_em": AGORA}


def acabando(location_id):
    return {"location_id": location_id, "location_name": "x", "product_id": uuid.uuid4(),
            "product_name": "p", "barcode": None, "quantity": 2, "preco": 5.0,
            "vendidas": 30, "ultima_venda": AGORA, "por_dia": 1.0}


async def test_central_monta_um_cartao_por_loja_com_totais():
    use_role("viewer")
    sessao = use_session(
        [
            ("with lojas as", [loja(LOJA_A, "Jardins II", 11774.51, 1425, 12), loja(LOJA_B, "Vila Ema", 0, 0, 0)]),
            ("vendas as", [acabando(LOJA_A), acabando(LOJA_A)]),
        ]
    )
    resp = await call("GET", "/orgs/mercadinho/lojas")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    a, b = body["lojas"]
    assert a["nome"] == "Jardins II"
    assert round(a["vendas"]["ticket_30d"], 2) == 8.26
    assert a["estoque"]["acabando"] == 2
    assert b["vendas"]["ticket_30d"] == 0.0  # loja sem venda não divide por zero
    assert body["totais"]["zerados"] == 12
    _, params = next((q, p) for q, p in sessao.executed if "with lojas as" in q)
    assert params["org_id"] == str(ORG_ID)
