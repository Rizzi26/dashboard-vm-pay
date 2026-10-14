"""Carga do pick list por planilha: casar linhas com a prateleira, sem lançar."""

import uuid
from datetime import datetime, timezone

from test_stock_routes import (
    LOC_ID,
    TARGET_ROW,
    _clean,  # noqa: F401 — fixture autouse que limpa os overrides
    call,
    use_role,
    use_session,
)

AGUA = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
SUCO = uuid.UUID("00000000-0000-0000-0000-0000000000a2")
COCO = uuid.UUID("00000000-0000-0000-0000-0000000000a3")

PRODUTOS = [
    {"id": AGUA, "name": "Água Mineral 500ml", "barcode": "07896002110983", "quantity": 4},
    {"id": SUCO, "name": "Suco de Uva 1L", "barcode": "7891000000001", "quantity": 0},
    {"id": COCO, "name": "Água de Coco 1L", "barcode": None, "quantity": 2},
]


def rotas(recibos=None):
    return [
        ("from core.purchase_receipt r", recibos or []),
        ("join core.location_link", [TARGET_ROW]),
        ("from core.stock_balance b", PRODUTOS),
    ]


async def ler(conteudo, recibos=None):
    use_role("admin")
    use_session(rotas(recibos))
    resp = await call(
        "POST", "/orgs/mercadinho/picklist/planilha/ler", json={"location_id": str(LOC_ID), "conteudo": conteudo}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_casa_por_id_codigo_e_nome_e_soma_repetidos():
    corpo = await ler(
        "id;codigo_barras;produto;quantidade\n"
        f"{AGUA};;;12\n"
        ";7896002110983;;6\n"  # mesmo produto pelo código, sem o zero que o Excel come
        ";7891000000001;;2,5\n"
        ";;agua de coco 1l;3\n"  # nome sem acento e minúsculo
        ";;Produto X;\n"  # em branco
    )
    qtd = {i["product_id"]: i["quantidade"] for i in corpo["itens"]}
    assert qtd == {str(AGUA): 18.0, str(SUCO): 2.5, str(COCO): 3.0}
    assert next(i for i in corpo["itens"] if i["product_id"] == str(AGUA))["linhas"] == [2, 3]
    assert corpo["resumo"] == {"produtos": 3, "em_branco": 1, "erros": 0}


async def test_planilha_do_fornecedor_so_com_codigo_e_quantidade():
    corpo = await ler("codigo_barras,quantidade\n7891000000001,24\n")
    assert corpo["itens"][0]["product_id"] == str(SUCO)


async def test_linhas_ruins_viram_erro_com_motivo():
    corpo = await ler(
        "codigo_barras;produto;quantidade\n"
        "7,89600E+12;;5\n"  # Excel estragou
        "999;;5\n"  # não está na loja
        ";Inexistente;5\n"
        "7891000000001;;0\n"
        "7891000000001;;1.000\n"  # ambíguo
    )
    motivos = [e["motivo"] for e in corpo["erros"]]
    assert "notação científica" in motivos[0]
    assert "não está na prateleira" in motivos[1]
    assert "nenhum produto" in motivos[2]
    assert "maior que zero" in motivos[3]
    assert "ambíguo" in motivos[4]
    assert corpo["itens"] == []


async def test_avisa_carga_identica_lancada_ha_pouco():
    recibo = uuid.uuid4()
    lancada = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)
    corpo = await ler(
        "codigo_barras;quantidade\n7891000000001;2\n",
        recibos=[{"id": recibo, "created_at": lancada, "product_id": SUCO, "quantity": 2}],
    )
    assert corpo["carga_igual"]["receipt_id"] == str(recibo)


async def test_carga_diferente_nao_avisa():
    corpo = await ler(
        "codigo_barras;quantidade\n7891000000001;3\n",
        recibos=[{"id": uuid.uuid4(), "created_at": datetime.now(timezone.utc), "product_id": SUCO, "quantity": 2}],
    )
    assert corpo["carga_igual"] is None


async def test_sem_coluna_quantidade_recusa_o_arquivo():
    use_role("admin")
    use_session(rotas())
    resp = await call(
        "POST", "/orgs/mercadinho/picklist/planilha/ler", json={"location_id": str(LOC_ID), "conteudo": "produto\nx\n"}
    )
    assert resp.status_code == 422
    assert "quantidade" in resp.json()["detail"]


async def test_viewer_nao_le_planilha_de_carga():
    use_role("viewer")
    use_session(rotas())
    resp = await call(
        "POST", "/orgs/mercadinho/picklist/planilha/ler", json={"location_id": str(LOC_ID), "conteudo": "a;quantidade\n"}
    )
    assert resp.status_code == 403


async def test_modelo_sai_com_quantidade_em_branco():
    use_role("admin")
    use_session(rotas())
    resp = await call("GET", f"/orgs/mercadinho/picklist/planilha/modelo.csv?location_id={LOC_ID}")
    assert resp.status_code == 200
    texto = resp.content.decode("utf-8")
    assert texto.startswith("﻿id;produto;codigo_barras;saldo;quantidade")
    assert f"{AGUA};Água Mineral 500ml;07896002110983;4;\r\n" in texto
