"""Snapshot de estoque: além do saldo presente, cada rodada grava a foto.

Sem banco de verdade, como em test_ingest: a sessão registra os statements e o
que importa é O QUE foi mandado gravar e em que ordem.
"""

import uuid
from types import SimpleNamespace

import httpx
import respx
from sqlalchemy.dialects import postgresql
from vmpay import VMpayClient

from vmpay_api import sync_core

BASE = "https://homolog.test/api/v1"


class FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []
        self.rowcount = len(self._rows)

    def scalars(self):
        return iter(self._rows)


class FakeSession:
    def __init__(self):
        self.statements = []

    async def execute(self, stmt):
        self.statements.append(stmt)
        return FakeResult()

    async def commit(self):
        pass

    async def rollback(self):
        pass

    def sql(self) -> list[str]:
        out = []
        for s in self.statements:
            try:
                out.append(str(s.compile(dialect=postgresql.dialect())))
            except Exception:
                out.append("")
        return out


INTEGRATION = SimpleNamespace(
    id=uuid.UUID("00000000-0000-0000-0000-00000000dddd"),
    org_id=uuid.UUID("00000000-0000-0000-0000-00000000bbbb"),
)


def saldo(good_id: int, qtd: float, valor: float) -> dict:
    return {
        "machine": {"id": 10, "asset_number": "0010"},
        "good": {"id": good_id, "name": f"Produto {good_id}"},
        "location": {"id": 1, "name": "Condomínio"},
        "inventory_balance": qtd,
        "desired_price": valor,
    }


@respx.mock
async def test_cada_rodada_grava_a_foto_historica_com_saldo_zero_incluido():
    """A foto é append-only e leva TODAS as linhas do relatório.

    O zero entra de propósito: é a chegada ao zero que data uma ruptura — sem
    ela a detecção de quebra não sabe quando o produto acabou.
    """
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=[{"id": 857, "machine_id": 10}])
    )
    respx.get(f"{BASE}/installation_stock_balances").mock(
        return_value=httpx.Response(200, json=[saldo(163, 3, 20.97), saldo(164, 0, 0.0)])
    )
    sessao = FakeSession()
    client = VMpayClient("segredo", base_url=BASE, max_retries=0)
    _, saldos, _ = await sync_core.sync_stock(
        client,
        sessao,
        INTEGRATION,
        {"163": uuid.uuid4(), "164": uuid.uuid4()},
    )
    assert saldos == 2

    sqls = sessao.sql()
    fotos = [s for s in sqls if "core.stock_snapshot" in s]
    assert fotos, "faltou a foto histórica da rodada"
    assert "ON CONFLICT" not in fotos[0].upper()  # append-only, nunca upsert

    stmt = next(s for s in sessao.statements if "stock_snapshot" in str(s))
    params = stmt.compile(dialect=postgresql.dialect()).params
    qtds = sorted(v for k, v in params.items() if k.startswith("quantity"))
    assert qtds == [0, 3]  # o saldo zero está na foto


@respx.mock
async def test_foto_vai_depois_do_saldo_e_antes_da_limpeza_de_stale():
    """Ordem: saldo presente -> foto -> remoção do que sumiu do relatório.

    A foto antes da limpeza garante que a série registre a última aparição de
    um produto removido da máquina, em vez de perdê-la na mesma transação.
    """
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=[{"id": 857, "machine_id": 10}])
    )
    respx.get(f"{BASE}/installation_stock_balances").mock(
        return_value=httpx.Response(200, json=[saldo(163, 5, 34.95)])
    )
    sessao = FakeSession()
    client = VMpayClient("segredo", base_url=BASE, max_retries=0)
    await sync_core.sync_stock(client, sessao, INTEGRATION, {"163": uuid.uuid4()})

    sqls = sessao.sql()
    pos_saldo = next(
        i for i, s in enumerate(sqls) if "core.stock_balance" in s and "INSERT" in s.upper()
    )
    pos_foto = next(i for i, s in enumerate(sqls) if "core.stock_snapshot" in s)
    pos_limpeza = next(
        i for i, s in enumerate(sqls) if "core.stock_balance" in s and "DELETE" in s.upper()
    )
    assert pos_saldo < pos_foto < pos_limpeza
