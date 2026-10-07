"""Cargas recentes de um produto (pick list), na ficha do produto."""

import uuid
from datetime import datetime, timezone

from test_stock_routes import (
    ORG_ID,
    PROD_ID,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    use_role,
    use_session,
)

RECEIPT_ID = uuid.UUID("00000000-0000-0000-0000-0000000c0de0")
EM = datetime(2026, 9, 28, 14, 30, tzinfo=timezone.utc)

CARGA_ROW = {
    "id": RECEIPT_ID,
    "number": "14192",
    "access_key": "3" * 44,
    "created_at": EM,
    "status": "approved",
    "location_name": "Condomínio — 0010",
    "aprovado_por": "dev@mercado.master.com",
    "vmpay_status": "success",
    "vmpay_erro": None,
    "unidades": 15,
}


async def test_admin_le_as_cargas_do_produto():
    use_role("admin")
    sessao = use_session([("from core.purchase_receipt_item", [CARGA_ROW])])
    resp = await call("GET", f"/orgs/mercadinho/stock/cargas/{PROD_ID}")
    assert resp.status_code == 200
    assert resp.json() == [
        {
            "receipt_id": str(RECEIPT_ID),
            "numero": "14192",
            "chave": "3" * 44,
            "carregado_em": EM.isoformat(),
            "loja": "Condomínio — 0010",
            "unidades": 15.0,
            "aprovado_por": "dev@mercado.master.com",
            "status": "approved",
            "vmpay": {"status": "success", "erro": None},
        }
    ]
    sql, params = sessao.executed[-1]
    # Isolamento: a organização vem do contexto, nunca da URL do produto.
    assert params["org_id"] == str(ORG_ID)
    assert params["product_id"] == str(PROD_ID)
    assert "r.org_id = :org_id" in sql
    # Item ignorado (consumo, embalagem) não é carga do produto; a quantidade
    # é a de venda (quantidade × fator), não a da nota.
    assert "not i.ignored" in sql
    assert "i.quantity * i.factor" in sql


async def test_limite_tem_teto():
    use_role("master")
    sessao = use_session([])
    resp = await call("GET", f"/orgs/mercadinho/stock/cargas/{PROD_ID}?limit=10000")
    assert resp.status_code == 200
    assert resp.json() == []
    assert sessao.executed[-1][1]["limit"] == 50


async def test_conta_removida_nao_quebra():
    use_role("admin")
    use_session([("from core.purchase_receipt_item", [{**CARGA_ROW, "aprovado_por": None}])])
    body = (await call("GET", f"/orgs/mercadinho/stock/cargas/{PROD_ID}")).json()
    assert body[0]["aprovado_por"] == "(conta removida)"


async def test_viewer_nao_ve_as_cargas():
    use_role("viewer")
    use_session([])
    resp = await call("GET", f"/orgs/mercadinho/stock/cargas/{PROD_ID}")
    assert resp.status_code == 403
