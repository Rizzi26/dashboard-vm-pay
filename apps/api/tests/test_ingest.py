"""Ingestão: lote, cursor e idempotência — sem banco de verdade.

A sessão é falsa e só registra o que foi executado. O que importa aqui não é o
SQL rodar (isso é o Postgres que garante), e sim *quando* o cursor avança.
"""

import httpx
import pytest
import respx
from sqlalchemy.dialects import postgresql
from vmpay import VMpayClient

from vmpay_api import ingest

BASE = "https://homolog.test/api/v1"


class FakeSession:
    """Registra execuções e commits, na ordem."""

    def __init__(self, cursor_inicial: int = 0):
        self.cursor_inicial = cursor_inicial
        self.eventos: list[str] = []
        self.statements: list = []

    async def scalar(self, _stmt):
        return self.cursor_inicial

    async def execute(self, stmt):
        self.statements.append(stmt)
        self.eventos.append(type(stmt).__name__)
        return None

    async def commit(self):
        self.eventos.append("COMMIT")

    async def rollback(self):
        self.eventos.append("ROLLBACK")

    def sql(self) -> list[str]:
        out = []
        for s in self.statements:
            try:
                out.append(str(s.compile(dialect=postgresql.dialect())))
            except Exception:
                out.append("")
        return out


def fatos(ids):
    return [
        {
            "id": i,
            "occurred_at": "2024-01-01T10:00:00Z",
            "value": 1.5,
            "status": "OK",
            "machine": {"id": 10, "asset_number": "A10"},
            "client": {"id": 20, "name": "Cliente"},
        }
        for i in ids
    ]


@pytest.fixture
def cliente():
    return VMpayClient("segredo", base_url=BASE, max_retries=0)


@respx.mock
async def test_grava_e_avanca_o_cursor_para_o_maior_id(cliente):
    respx.get(f"{BASE}/cashless_facts").mock(
        side_effect=[
            httpx.Response(200, json=fatos([7, 3, 9])),
            httpx.Response(200, json=[]),
        ]
    )
    sessao = FakeSession()
    rel = await ingest.sync_resource("cashless_facts", cliente, sessao, batch_size=100)

    assert rel.rows == 3
    assert rel.cursor_after == 9  # o maior, não o último
    assert rel.error is None


@respx.mock
async def test_cursor_so_avanca_depois_do_commit(cliente):
    """Se o commit não aconteceu, o cursor não pode ter andado.

    É isto que garante que uma queda no meio reprocessa em vez de pular.
    """
    respx.get(f"{BASE}/cashless_facts").mock(
        side_effect=[httpx.Response(200, json=fatos([1, 2])), httpx.Response(200, json=[])]
    )
    sessao = FakeSession()
    await ingest.sync_resource("cashless_facts", cliente, sessao, batch_size=100)

    eventos = sessao.eventos
    assert "COMMIT" in eventos
    # o update do cursor é o último statement antes do commit
    assert eventos.index("Update") < eventos.index("COMMIT")


@respx.mock
async def test_quebra_em_lotes_do_tamanho_pedido(cliente):
    respx.get(f"{BASE}/cashless_facts").mock(
        side_effect=[
            httpx.Response(200, json=fatos(range(1, 6))),
            httpx.Response(200, json=[]),
        ]
    )
    sessao = FakeSession()
    rel = await ingest.sync_resource("cashless_facts", cliente, sessao, batch_size=2)
    assert rel.rows == 5
    assert rel.batches == 3  # 2 + 2 + 1
    assert sessao.eventos.count("COMMIT") == 3


@respx.mock
async def test_dimensoes_sao_gravadas_antes_dos_fatos(cliente):
    """Os fatos têm FK para as dimensões; ordem trocada quebraria a carga."""
    respx.get(f"{BASE}/cashless_facts").mock(
        side_effect=[httpx.Response(200, json=fatos([1])), httpx.Response(200, json=[])]
    )
    sessao = FakeSession()
    await ingest.sync_resource("cashless_facts", cliente, sessao, batch_size=10)

    sqls = sessao.sql()
    pos_maquina = next(i for i, s in enumerate(sqls) if "vmpay.machine" in s)
    pos_fato = next(i for i, s in enumerate(sqls) if "vmpay.cashless_fact" in s)
    assert pos_maquina < pos_fato


@respx.mock
async def test_upsert_e_nao_insert_simples(cliente):
    """Reprocessar a mesma janela não pode duplicar linha."""
    respx.get(f"{BASE}/cashless_facts").mock(
        side_effect=[httpx.Response(200, json=fatos([1])), httpx.Response(200, json=[])]
    )
    sessao = FakeSession()
    await ingest.sync_resource("cashless_facts", cliente, sessao, batch_size=10)

    fato_sql = next(s for s in sessao.sql() if "vmpay.cashless_fact" in s)
    assert "ON CONFLICT" in fato_sql.upper()
    assert "DO UPDATE" in fato_sql.upper()


@respx.mock
async def test_teto_de_linhas_interrompe_e_sinaliza(cliente):
    respx.get(f"{BASE}/cashless_facts").mock(
        return_value=httpx.Response(200, json=fatos(range(1, 11)))
    )
    sessao = FakeSession()
    rel = await ingest.sync_resource(
        "cashless_facts", cliente, sessao, batch_size=5, max_rows=5
    )
    assert rel.truncated
    assert rel.rows <= 10


@respx.mock
async def test_falha_da_api_registra_erro_sem_vazar_token(cliente):
    respx.get(f"{BASE}/cashless_facts").mock(
        return_value=httpx.Response(500, text="boom access_token=segredo")
    )
    sessao = FakeSession()
    rel = await ingest.sync_resource("cashless_facts", cliente, sessao)

    assert rel.error is not None
    assert "segredo" not in rel.error
    assert "ROLLBACK" in sessao.eventos


async def test_recurso_desconhecido_e_recusado(cliente):
    sessao = FakeSession()
    with pytest.raises(ValueError, match="não é ingerível"):
        await ingest.sync_resource("products", cliente, sessao)


@respx.mock
async def test_retoma_do_cursor_salvo(cliente):
    rota = respx.get(f"{BASE}/cashless_facts").mock(
        return_value=httpx.Response(200, json=[])
    )
    sessao = FakeSession(cursor_inicial=5000)
    await ingest.sync_resource("cashless_facts", cliente, sessao)
    assert rota.calls.last.request.url.params["transaction_id_greater_than"] == "5000"


@respx.mock
async def test_vends_tambem_extrai_dimensoes(cliente):
    """Venda de produto que nunca apareceu no cashless não pode quebrar a FK.

    A primeira ingestão real quebrou aqui: vmpay.vend tem FK para vmpay.good e
    só o cashless extraía dimensões. O payload de /vends traz os aninhados —
    têm que virar dimensão antes do fato, no mesmo lote.
    """
    respx.get(f"{BASE}/vends").mock(
        side_effect=[
            httpx.Response(
                200,
                json=[
                    {
                        "id": 50,
                        "occurred_at": "2024-01-01T10:00:00Z",
                        "good_id": 999,
                        "machine_id": 10,
                        "value": 2.5,
                        "good": {"id": 999, "name": "Produto só de dinheiro"},
                        "machine": {"id": 10, "asset_number": "A10"},
                        "client": {"id": 20, "name": "Cliente"},
                        "location": {"id": 30, "name": "Local"},
                    }
                ],
            ),
            httpx.Response(200, json=[]),
        ]
    )
    sessao = FakeSession()
    rel = await ingest.sync_resource("vends", cliente, sessao, batch_size=10)
    assert rel.error is None

    sqls = sessao.sql()
    pos_good = next(i for i, s in enumerate(sqls) if "vmpay.good" in s)
    pos_vend = next(i for i, s in enumerate(sqls) if "vmpay.vend" in s)
    assert pos_good < pos_vend  # dimensão antes do fato, senão a FK quebra


@respx.mock
async def test_fato_com_dimensao_ausente_ganha_stub(cliente):
    """good_id sem objeto aninhado (produto deletado do catálogo) não quebra FK.

    O stub é DO NOTHING: garante a FK sem jamais sobrescrever uma dimensão que
    já tem nome.
    """
    respx.get(f"{BASE}/vends").mock(
        side_effect=[
            httpx.Response(
                200,
                json=[{"id": 60, "occurred_at": "2024-01-01T10:00:00Z",
                       "good_id": 28496003, "value": 2.5}],  # sem aninhados
            ),
            httpx.Response(200, json=[]),
        ]
    )
    sessao = FakeSession()
    rel = await ingest.sync_resource("vends", cliente, sessao, batch_size=10)
    assert rel.error is None

    sqls = sessao.sql()
    stub = next((s for s in sqls if "vmpay.good" in s), None)
    assert stub is not None, "faltou o stub da dimensão referenciada"
    assert "ON CONFLICT" in stub.upper() and "DO NOTHING" in stub.upper()
    assert sqls.index(stub) < next(i for i, s in enumerate(sqls) if "vmpay.vend" in s)
