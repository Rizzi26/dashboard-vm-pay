"""Botão "Atualizar dados": rodada sob demanda, com intervalo mínimo."""

from datetime import datetime, timedelta, timezone

from test_stock_routes import _clean, call, use_role, use_session  # noqa: F401

from vmpay_api.routers import sync as sync_router


def _sem_rodada_real(monkeypatch):
    chamadas = []

    async def falso():
        chamadas.append(1)
        return []

    monkeypatch.setattr(sync_router, "sync_all", falso)
    monkeypatch.setenv("VMPAY_INGEST_TOKEN", "tok-falso")
    from vmpay_api.config import settings

    settings.cache_clear()
    return chamadas


async def test_leitura_tambem_pode_atualizar_e_a_rodada_e_agendada(monkeypatch):
    chamadas = _sem_rodada_real(monkeypatch)
    use_role("viewer")
    antiga = datetime.now(timezone.utc) - timedelta(hours=3)
    use_session([("from vmpay.sync_cursor", [antiga])])
    resp = await call("POST", "/orgs/mercadinho/sync")
    assert resp.status_code == 202, resp.text
    assert resp.json()["status"] == "agendado"
    assert chamadas == [1]  # BackgroundTasks roda ao fim da resposta


async def test_pedido_logo_apos_outra_rodada_recebe_429(monkeypatch):
    chamadas = _sem_rodada_real(monkeypatch)
    use_role("viewer")
    recente = datetime.now(timezone.utc) - timedelta(seconds=30)
    use_session([("from vmpay.sync_cursor", [recente])])
    resp = await call("POST", "/orgs/mercadinho/sync")
    assert resp.status_code == 429
    assert "aguarde" in resp.json()["detail"]
    assert chamadas == []


async def test_sem_token_na_api_explica_com_503(monkeypatch):
    monkeypatch.setenv("VMPAY_INGEST_TOKEN", "")
    from vmpay_api.config import settings

    settings.cache_clear()
    use_role("viewer")
    use_session([])
    resp = await call("POST", "/orgs/mercadinho/sync")
    assert resp.status_code == 503
    assert "VMPAY_INGEST_TOKEN" in resp.json()["detail"]


async def test_situacao_mostra_o_dado_mais_antigo(monkeypatch):
    use_role("viewer")
    vendas = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
    estoque = datetime(2026, 10, 5, 2, 0, tzinfo=timezone.utc)
    use_session([("from vmpay.sync_cursor", [vendas]), ("from core.stock_balance", [estoque])])
    body = (await call("GET", "/orgs/mercadinho/sync")).json()
    assert body["dados_de"] == estoque.isoformat()  # estoque parado aparece
    assert body["rodando"] is False
