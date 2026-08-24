"""Conector VMpay: tradução good_id -> planograma e envelopes de escrita."""

import json

import httpx
import pytest
import respx
from vmpay import VMpayClient

from vmpay_api.connector import ConnectorError, VMpayConnector

BASE = "https://homolog.test/api/v1"
PLANOGRAM_URL = f"{BASE}/machines/49/installations/857/current_planogram"

PLANOGRAMA = {
    "id": 189976,
    "items": [
        {"id": 86717, "good_id": 10, "current_balance": 11.0, "desired_price": 2.5},
        {"id": 86718, "good_id": 12, "current_balance": 3.0, "desired_price": 2.3},
    ],
}


def connector() -> VMpayConnector:
    return VMpayConnector(VMpayClient("tok", base_url=BASE, max_retries=0))


@respx.mock
async def test_restock_monta_o_ajuste_com_planograma_e_saldo():
    respx.get(PLANOGRAM_URL).mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    rota = respx.post(
        f"{BASE}/machines/49/installations/857/inventory_adjustments"
    ).mock(return_value=httpx.Response(201, json={"id": 1}))

    async with connector().client as _:
        await connector().restock(49, 857, [(10, 6), (12, 2)])

    corpo = json.loads(rota.calls.last.request.content)
    adj = corpo["inventory_adjustment"]
    assert adj["planogram_id"] == 189976
    assert adj["kind"] == "now"
    assert adj["items_attributes"][0] == {
        "planogram_item_id": 86717,
        "balance_before": 11.0,
        "added": "6",
        "removed": "",
        "observed": "",
    }


@respx.mock
async def test_produto_fora_do_planograma_e_erro_nosso_antes_da_escrita():
    respx.get(PLANOGRAM_URL).mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    escrita = respx.post(
        f"{BASE}/machines/49/installations/857/inventory_adjustments"
    ).mock(return_value=httpx.Response(201, json={}))

    with pytest.raises(ConnectorError, match="good_id=99"):
        await connector().restock(49, 857, [(99, 1)])
    assert not escrita.called  # nada foi escrito na VMpay


@respx.mock
async def test_precos_sao_agrupados_num_patch_so():
    respx.get(PLANOGRAM_URL).mock(return_value=httpx.Response(200, json=PLANOGRAMA))
    rota = respx.patch(PLANOGRAM_URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    await connector().set_price(49, 857, [(10, 3.0), (12, 2.8)])

    assert rota.call_count == 1  # um PATCH para as duas mudanças
    corpo = json.loads(rota.calls.last.request.content)
    assert corpo["planogram"]["items_attributes"] == [
        {"id": 86717, "desired_price": 3.0},
        {"id": 86718, "desired_price": 2.8},
    ]
