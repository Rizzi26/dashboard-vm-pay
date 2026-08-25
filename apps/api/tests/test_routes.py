"""Rotas: forma da resposta e cálculos que não dependem do banco."""

from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
import uuid

from vmpay_api.auth import OrgContext, Principal, org_context
from vmpay_api.db import get_session
from vmpay_api.main import app

ORG = uuid.UUID("00000000-0000-0000-0000-00000000bbbb")
USER = uuid.UUID("00000000-0000-0000-0000-00000000aaaa")


def viewer_ctx():
    async def _override():
        return OrgContext(Principal(USER, None), ORG, "mercadinho", "viewer", False)

    app.dependency_overrides[org_context] = _override


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def one(self):
        return self._rows[0]

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class FakeSession:
    """Devolve linhas pré-cozidas e guarda os parâmetros recebidos."""

    def __init__(self, rows):
        self.rows = rows
        self.params: list[dict] = []

    async def execute(self, _stmt, params=None):
        self.params.append(params or {})
        return FakeResult(self.rows)


def com_sessao(rows):
    sessao = FakeSession(rows)

    async def _override():
        yield sessao

    app.dependency_overrides[get_session] = _override
    viewer_ctx()
    return sessao


@pytest.fixture(autouse=True)
def limpa():
    yield
    app.dependency_overrides.clear()


async def get(url: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        return await c.get(url)


async def test_health_nao_toca_no_banco():
    assert (await get("/health")).json() == {"status": "ok"}


async def test_summary_calcula_ticket_medio():
    com_sessao([{"revenue": 250, "transactions": 100, "items": 120, "discounts": 10, "machines": 4}])
    body = (await get("/orgs/mercadinho/sales/summary")).json()
    assert body["faturamento"] == 250
    assert body["ticket_medio"] == 2.5


async def test_summary_sem_transacao_nao_divide_por_zero():
    com_sessao([{"revenue": 0, "transactions": 0, "items": 0, "discounts": 0, "machines": 0}])
    assert (await get("/orgs/mercadinho/sales/summary")).json()["ticket_medio"] == 0.0


async def test_janela_padrao_e_de_30_dias():
    sessao = com_sessao([{"revenue": 0, "transactions": 0, "items": 0, "discounts": 0, "machines": 0}])
    await get("/orgs/mercadinho/sales/summary")
    p = sessao.params[0]
    assert (p["end"] - p["start"]).days == 31  # 30 dias + o fim exclusivo


async def test_fim_do_periodo_e_inclusivo():
    """Pedir end=2024-01-31 tem que incluir o dia 31 inteiro."""
    sessao = com_sessao([{"revenue": 0, "transactions": 0, "items": 0, "discounts": 0, "machines": 0}])
    await get("/orgs/mercadinho/sales/summary?start=2024-01-01&end=2024-01-31")
    assert sessao.params[0]["end"] == date(2024, 2, 1)


async def test_daily_devolve_serie_ordenada():
    com_sessao(
        [
            {"day": date(2024, 1, 1), "revenue": 10, "transactions": 2},
            {"day": date(2024, 1, 2), "revenue": 20, "transactions": 3},
        ]
    )
    body = (await get("/orgs/mercadinho/sales/daily")).json()
    assert [d["dia"] for d in body] == ["2024-01-01", "2024-01-02"]
    assert body[1]["faturamento"] == 20.0


async def test_by_machine_tolera_maquina_sem_cadastro():
    """A dimensão pode ainda não ter sido ingerida — LEFT JOIN devolve null."""
    com_sessao([{"machine_id": 3184, "asset_number": None, "model_name": None, "revenue": None, "transactions": 0}])
    body = (await get("/orgs/mercadinho/sales/by-machine")).json()
    assert body[0]["machine_id"] == 3184
    assert body[0]["faturamento"] == 0.0


async def test_by_machine_limita_o_ranking():
    com_sessao([])
    await get("/orgs/mercadinho/sales/by-machine?limit=500")
    # acima do teto declarado, o FastAPI recusa
    assert (await get("/orgs/mercadinho/sales/by-machine?limit=500")).status_code == 422


async def test_sync_status_expoe_o_atraso():
    agora = datetime.now(timezone.utc)
    com_sessao(
        [
            {
                "resource": "cashless_facts",
                "cursor_value": 900,
                "rows_ingested": 12,
                "last_run_at": agora,
                "last_success": agora,
                "last_error": None,
                "since_last_success": timedelta(minutes=5),
            }
        ]
    )
    body = (await get("/orgs/mercadinho/sales/sync-status")).json()
    assert body[0]["atraso_segundos"] == 300.0
    assert body[0]["cursor"] == 900


def com_sessao_sequencial(lotes):
    """Cada execute() consome o próximo lote de linhas — para rotas com mais de
    uma query, onde a sessão de lote único devolveria o lote errado."""

    class Sequencial:
        def __init__(self):
            self._lotes = list(lotes)

        async def execute(self, _stmt, params=None):
            return FakeResult(self._lotes.pop(0) if self._lotes else [])

    sessao = Sequencial()

    async def _override():
        yield sessao

    app.dependency_overrides[get_session] = _override
    viewer_ctx()
    return sessao


async def test_vendas_perdidas_calcula_a_taxa():
    com_sessao_sequencial([
        [{"tentativas": 100, "valor": 550.0, "interacoes": 1000}],
        [{"motivo": "Operação cancelada pelo operador.", "tentativas": 60, "valor": 300.0}],
    ])
    body = (await get("/orgs/mercadinho/sales/lost")).json()
    assert body["tentativas"] == 100
    assert body["taxa"] == 0.1
    assert body["valor_nao_capturado"] == 550.0
    assert body["motivos"][0]["motivo"] == "Operação cancelada pelo operador."


async def test_vendas_perdidas_sem_interacao_nao_divide_por_zero():
    com_sessao_sequencial([[{"tentativas": 0, "valor": 0, "interacoes": 0}], []])
    assert (await get("/orgs/mercadinho/sales/lost")).json()["taxa"] == 0.0


PROD_ID = "00000000-0000-0000-0000-00000000ffff"


async def test_ficha_de_produto_junta_estoque_e_vendas():
    from datetime import datetime, timezone as tz

    com_sessao_sequencial([
        [{"name": "Água Mineral", "barcode": "789", "preco": 3.5, "estoque": 18}],
        [("163",)],
        [{"unidades": 40, "faturamento": 140.0,
          "ultima_venda": datetime(2026, 8, 24, 12, 0, tzinfo=tz.utc)}],
        [{"dia": date(2026, 8, 24), "faturamento": 140.0, "unidades": 40}],
    ])
    body = (await get(f"/orgs/mercadinho/products/{PROD_ID}")).json()
    assert body["produto"]["nome"] == "Água Mineral"
    assert body["resumo"]["preco_medio"] == 3.5  # 140 / 40
    assert body["diario"][0]["unidades"] == 40


async def test_produto_sem_vinculo_devolve_zeros_e_nao_explode():
    com_sessao_sequencial([
        [{"name": "Órfão", "barcode": None, "preco": None, "estoque": 0}],
        [],  # sem product_link
        [{"unidades": 0, "faturamento": 0, "ultima_venda": None}],
        [],
    ])
    body = (await get(f"/orgs/mercadinho/products/{PROD_ID}")).json()
    assert body["resumo"]["unidades"] == 0
    assert body["resumo"]["preco_medio"] is None


async def test_produto_de_outra_org_da_404():
    com_sessao_sequencial([[]])
    assert (await get(f"/orgs/mercadinho/products/{PROD_ID}")).status_code == 404
