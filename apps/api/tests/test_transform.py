"""Transform VMpay -> core: funções puras, payloads da doc oficial."""

import uuid

import httpx
import pytest
import respx
from vmpay import VMpayClient

from vmpay_api import sync_core
from vmpay_api.transform import (
    installations_map,
    location_external_id,
    map_balance,
    map_product,
)

BASE = "https://homolog.test/api/v1"


def fast_client(token, **kwargs):
    """Cliente sem retry: um 500 no teste falha na hora, não após 30s de backoff."""
    return VMpayClient(token, max_retries=0, **kwargs)

# Payload do exemplo oficial de GET /products
PRODUTO = {
    "id": 163,
    "type": "Product",
    "manufacturer_id": 56,
    "category_id": 23,
    "name": "Ruffles 50 g",
    "upc_code": "91",
    "barcode": "1234567890",
    "cost_price": 1.85,
    "default_price": 2.5,
}

# Payload do exemplo oficial de GET /installation_stock_balances
SALDO = {
    "client": {"id": 2703, "name": "Cliente 1"},
    "location": {"id": 4590, "name": "Local 1"},
    "machine": {"id": 1809, "asset_number": "0010"},
    "good": {"id": 163, "upc_code": "91", "barcode": 1234567890, "name": "Ruffles 50 g"},
    "inventory_balance": 18,
    "desired_price": 36.0,
}

INSTALACOES = [
    {"id": 77, "machine_id": 1809, "location_id": 4590, "removed_at": None},
    {"id": 60, "machine_id": 1809, "location_id": 4590, "removed_at": "2020-01-01"},
    {"id": 91, "machine_id": 1810, "location_id": 4591, "removed_at": None},
]


# ------------------------------------------------------------------- produtos


def test_produto_canonico_pega_nome_e_precos():
    row = map_product(PRODUTO)
    assert row["name"] == "Ruffles 50 g"
    assert row["unit_price"] == 2.5
    assert row["cost_price"] == 1.85
    assert row["barcode"] == "1234567890"
    assert row["active"]


def test_produto_sem_barcode_cai_no_upc():
    row = map_product({**PRODUTO, "barcode": None})
    assert row["barcode"] == "91"


# ---------------------------------------------------------------- instalações


def test_mapa_de_instalacoes_ignora_removidas():
    m = installations_map(INSTALACOES)
    assert m[1809]["id"] == 77  # a removida (60) não venceu
    assert m[1810]["id"] == 91


def test_duas_ativas_para_a_mesma_maquina_vence_a_mais_recente():
    m = installations_map(
        [
            {"id": 10, "machine_id": 1, "removed_at": None},
            {"id": 22, "machine_id": 1, "removed_at": None},
        ]
    )
    assert m[1]["id"] == 22


def test_external_id_do_local_e_maquina_mais_instalacao():
    assert location_external_id(1809, 77) == "1809:77"


# --------------------------------------------------------------------- saldos


def test_saldo_junta_nome_do_local_e_patrimonio():
    row = map_balance(SALDO)
    assert row["location_name"] == "Local 1 — 0010"
    assert row["quantity"] == 18
    assert row["good_id"] == 163


def test_preco_unitario_e_o_total_dividido_pelo_saldo():
    """O desired_price do relatório é o VALOR do estoque: 36.00 para saldo 18 =
    2.00 a unidade — o exemplo da própria doc. Dados reais confirmam (qtd 0
    sempre vem 0.00, o que seria absurdo como preço unitário)."""
    assert map_balance(SALDO)["unit_price"] == 2.0


def test_saldo_zero_nao_inventa_preco():
    row = map_balance({**SALDO, "inventory_balance": 0, "desired_price": 0.0})
    assert row["unit_price"] is None


def test_saldo_sem_maquina_ou_produto_e_descartado():
    assert map_balance({**SALDO, "machine": None}) is None
    assert map_balance({**SALDO, "good": {}}) is None


# ------------------------------------------------------------- token/config


def test_token_vem_da_env_apontada_pelo_config(monkeypatch):
    monkeypatch.setenv("TOKEN_DO_MERCADINHO", "abc")
    assert sync_core.resolve_token({"token_env": "TOKEN_DO_MERCADINHO"}) == "abc"


def test_config_sem_token_env_usa_o_default(monkeypatch):
    monkeypatch.setenv(sync_core.DEFAULT_TOKEN_ENV, "xyz")
    assert sync_core.resolve_token({}) == "xyz"


def test_env_ausente_e_erro_claro(monkeypatch):
    monkeypatch.delenv("TOKEN_SUMIDO", raising=False)
    from vmpay import VMpayError

    with pytest.raises(VMpayError, match="TOKEN_SUMIDO"):
        sync_core.resolve_token({"token_env": "TOKEN_SUMIDO"})


def test_token_colado_com_sujeira_e_saneado(monkeypatch):
    """Quebra de linha, espaço e aspas de colagem em dashboard não vão à VMpay."""
    monkeypatch.setenv("TOKEN_SUJO", '  "abc123"\n')
    assert sync_core.resolve_token({"token_env": "TOKEN_SUJO"}) == "abc123"


def test_env_so_com_espacos_conta_como_ausente(monkeypatch):
    from vmpay import VMpayError

    monkeypatch.setenv("TOKEN_VAZIO", "   \n")
    with pytest.raises(VMpayError, match="TOKEN_VAZIO"):
        sync_core.resolve_token({"token_env": "TOKEN_VAZIO"})


# ------------------------------------------------- orquestração (sessão falsa)


class FakeSession:
    """Grava os statements; scalars() devolve listas pré-armadas na ordem."""

    def __init__(self, scalar_lists):
        self._scalar_lists = list(scalar_lists)
        self.statements = []

    async def execute(self, stmt, params=None):
        self.statements.append(stmt)
        text = str(stmt).lower()
        if text.strip().startswith("select"):
            class R:
                def __init__(self, items):
                    self._items = items

                def scalars(self):
                    return iter(self._items)

            return R(self._scalar_lists.pop(0) if self._scalar_lists else [])

        class W:
            rowcount = 0

            def scalars(self):
                return iter([])

        return W()

    async def commit(self):
        self.statements.append("COMMIT")

    async def rollback(self):
        self.statements.append("ROLLBACK")


def integration():
    class I:
        id = uuid.UUID("00000000-0000-0000-0000-00000000dddd")
        org_id = uuid.UUID("00000000-0000-0000-0000-00000000bbbb")
        kind = "vmpay"
        config = {}
        active = True

    return I()


@respx.mock
async def test_snapshot_completo_produz_upserts_e_commit(monkeypatch):
    monkeypatch.setenv(sync_core.DEFAULT_TOKEN_ENV, "tok")
    monkeypatch.setenv("VMPAY_BASE", BASE)
    respx.get(f"{BASE}/products").mock(return_value=httpx.Response(200, json=[PRODUTO]))
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=INSTALACOES)
    )
    respx.get(f"{BASE}/installation_stock_balances").mock(
        return_value=httpx.Response(200, json=[SALDO])
    )

    sessao = FakeSession(scalar_lists=[[], []])  # sem links prévios
    report = await sync_core.sync_integration(sessao, integration(), client_factory=fast_client)

    assert report.error is None
    assert report.products == 1
    assert report.locations == 1
    assert report.balances == 1
    assert "COMMIT" in sessao.statements

    sql = " ".join(str(s) for s in sessao.statements if s != "COMMIT").lower()
    for tabela in ("core.product", "core.product_link", "core.location",
                   "core.location_link", "core.stock_balance"):
        assert tabela in sql, f"faltou upsert em {tabela}"


@respx.mock
async def test_saldo_de_produto_fora_do_catalogo_nao_quebra(monkeypatch):
    """Conta como pulado e loga — nunca derruba a rodada inteira."""
    monkeypatch.setenv(sync_core.DEFAULT_TOKEN_ENV, "tok")
    monkeypatch.setenv("VMPAY_BASE", BASE)
    respx.get(f"{BASE}/products").mock(return_value=httpx.Response(200, json=[]))
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=INSTALACOES)
    )
    respx.get(f"{BASE}/installation_stock_balances").mock(
        return_value=httpx.Response(200, json=[SALDO])
    )

    sessao = FakeSession(scalar_lists=[[], []])
    report = await sync_core.sync_integration(sessao, integration(), client_factory=fast_client)
    assert report.error is None
    assert report.balances == 0  # pulado, não gravado às cegas


@respx.mock
async def test_falha_da_api_faz_rollback_e_registra_sem_token(monkeypatch):
    monkeypatch.setenv(sync_core.DEFAULT_TOKEN_ENV, "tok-secreto")
    monkeypatch.setenv("VMPAY_BASE", BASE)
    respx.get(f"{BASE}/products").mock(return_value=httpx.Response(500, text="boom"))

    sessao = FakeSession(scalar_lists=[[]])
    report = await sync_core.sync_integration(sessao, integration(), client_factory=fast_client)
    assert report.error is not None
    assert "tok-secreto" not in report.error
    assert "ROLLBACK" in sessao.statements
