"""Exercita as tools de ponta a ponta contra uma API simulada."""

import httpx
import pytest
import respx
from vmpay import VMpayClient

from vmpay_mcp import server
from vmpay_mcp.config import Settings

BASE = "https://homolog.test/api/v1"


@pytest.fixture(autouse=True)
def ambiente(monkeypatch):
    """Servidor liberado no máximo, apontando para uma base falsa."""
    monkeypatch.setattr(
        server,
        "settings",
        Settings(
            base_url=BASE, base_explicit=True, allow_writes=True, allow_machine_ops=True
        ),
    )
    cliente = VMpayClient("segredo", base_url=BASE, max_retries=0)
    monkeypatch.setattr(server, "client", lambda: cliente)
    yield


# ---------------------------------------------------------------------- leitura


def test_catalogo_agrupa_e_declara_o_modo():
    out = server.vmpay_catalog()
    assert "Relatórios" in out["recursos"]
    assert out["ambiente"] == BASE
    assert "operação" in out["modo"]


def test_catalogo_filtra_por_busca():
    out = server.vmpay_catalog(busca="cashless")
    nomes = [linha for grupo in out["recursos"].values() for linha in grupo]
    assert any("cashless_facts" in n for n in nomes)
    assert not any("products" in n for n in nomes)


def test_describe_explica_o_envelope():
    ficha = server.vmpay_describe("products")
    assert "product" in ficha["operacoes"]["create"]["envelope"]


@respx.mock
async def test_list_pagina_ate_o_limite():
    respx.get(f"{BASE}/vends").mock(
        side_effect=[
            httpx.Response(200, json=[{"id": 1}, {"id": 2}]),
            httpx.Response(200, json=[{"id": 3}]),
        ]
    )
    out = await server.vmpay_list("vends", limite=2)
    assert out["total"] == 2
    assert any("cortado" in a for a in out["avisos"])


@respx.mock
async def test_list_devolve_o_proximo_cursor():
    respx.get(f"{BASE}/cashless_facts").mock(
        return_value=httpx.Response(200, json=[{"id": 10}, {"id": 42}, {"id": 7}])
    )
    out = await server.vmpay_list("cashless_facts", limite=500)
    assert out["proximo_cursor"] == {"transaction_id_greater_than": 42}


@respx.mock
async def test_list_avisa_sobre_filtro_nao_documentado():
    respx.get(f"{BASE}/vends").mock(return_value=httpx.Response(200, json=[]))
    out = await server.vmpay_list("vends", filtros={"inventado": 1})
    assert any("inventado" in a for a in out["avisos"])


@respx.mock
async def test_list_aninhado_monta_o_caminho():
    rota = respx.get(
        f"{BASE}/machines/49/installations/857/planograms"
    ).mock(return_value=httpx.Response(200, json=[]))
    await server.vmpay_list(
        "planograms", caminho={"machine_id": 49, "installation_id": 857}
    )
    assert rota.called


async def test_list_sem_o_caminho_completo_explica_o_que_falta():
    out = await server.vmpay_list("planograms", caminho={"machine_id": 49})
    assert "installation_id" in out["erro"]


# ---------------------------------------------------------------------- escrita


@respx.mock
async def test_create_embrulha_o_corpo_no_envelope():
    rota = respx.post(f"{BASE}/products").mock(
        return_value=httpx.Response(201, json={"id": 9})
    )
    await server.vmpay_create(
        "products",
        {"name": "Coca", "manufacturer_id": 1, "category_id": 2, "supply_category_id": 3},
    )
    import json

    enviado = json.loads(rota.calls.last.request.content)
    assert set(enviado) == {"product"}
    assert enviado["product"]["name"] == "Coca"


async def test_create_recusa_antes_de_chamar_a_api_se_faltar_obrigatorio():
    out = await server.vmpay_create("products", {"name": "Coca"})
    assert "manufacturer_id" in out["erro"]


@respx.mock
async def test_delete_exige_confirmacao_correta():
    rota = respx.delete(f"{BASE}/products/9").mock(return_value=httpx.Response(204))
    negado = await server.vmpay_delete("products", 9, confirmar="8")
    assert "confirmação não confere" in negado["erro"]
    assert not rota.called

    ok = await server.vmpay_delete("products", 9, confirmar="9")
    assert ok["excluido"] == 9
    assert rota.called


# -------------------------------------------------------- operação em máquina


@respx.mock
async def test_comando_remoto_exige_eco_do_installation_id():
    rota = respx.post(
        f"{BASE}/machines/49/installations/857/remote_commands"
    ).mock(return_value=httpx.Response(201, json={"id": 1}))
    negado = await server.vmpay_remote_command(49, 857, "reboot", confirmar="49")
    assert "confirmação não confere" in negado["erro"]
    assert not rota.called

    ok = await server.vmpay_remote_command(49, 857, "reboot", confirmar="857")
    assert rota.called
    assert "máquina física" in ok["aviso"]


async def test_comando_remoto_bloqueado_quando_o_interruptor_esta_desligado(monkeypatch):
    monkeypatch.setattr(
        server,
        "settings",
        Settings(base_url=BASE, base_explicit=True, allow_writes=True, allow_machine_ops=False),
    )
    out = await server.vmpay_remote_command(49, 857, "reboot", confirmar="857")
    assert "VMPAY_ALLOW_MACHINE_OPS" in out["erro"]


async def test_ajuste_de_inventario_tambem_esta_atras_do_interruptor(monkeypatch):
    monkeypatch.setattr(
        server,
        "settings",
        Settings(base_url=BASE, base_explicit=True, allow_writes=True, allow_machine_ops=False),
    )
    out = await server.vmpay_create(
        "inventory_adjustments", {}, caminho={"machine_id": 49, "installation_id": 857}
    )
    assert "VMPAY_ALLOW_MACHINE_OPS" in out["erro"]


# ------------------------------------------------------------------ vazamento


@respx.mock
async def test_o_token_nunca_aparece_num_erro():
    respx.get(f"{BASE}/vends").mock(
        return_value=httpx.Response(401, text="unauthorized: access_token=segredo")
    )
    out = await server.vmpay_list("vends")
    assert "segredo" not in repr(out)
    assert "[REDACTED]" in out["corpo"]
