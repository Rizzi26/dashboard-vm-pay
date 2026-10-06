"""pg_cron → /interno/ingestao: só com o token interno do Vault."""

from test_stock_routes import _clean, call, use_session  # noqa: F401

from vmpay_api import rotinas
from vmpay_api.routers import sync as sync_router


def _sem_rodada_real(monkeypatch):
    chamadas = []

    async def falso(**kwargs):
        chamadas.append(kwargs)
        return []

    monkeypatch.setattr(sync_router, "sync_all", falso)
    return chamadas


async def test_sem_token_ou_token_errado_e_401(monkeypatch):
    chamadas = _sem_rodada_real(monkeypatch)
    use_session([("from vault.decrypted_secrets", ["token-interno-certo"])])
    assert (await call("POST", "/interno/ingestao")).status_code == 401
    resp = await call("POST", "/interno/ingestao")  # o call() de teste manda só Authorization
    assert resp.status_code == 401
    assert chamadas == []


async def test_token_certo_agenda_a_rodada_rapida(monkeypatch):
    import httpx
    from vmpay_api.main import app

    chamadas = _sem_rodada_real(monkeypatch)
    use_session([("from vault.decrypted_secrets", ["token-interno-certo"])])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.post("/interno/ingestao", headers={"x-cron-token": "token-interno-certo"})
    assert resp.status_code == 202
    assert chamadas == [{"catalogo_completo": False}]


async def test_sem_vault_configurado_nada_passa():
    class S:
        async def scalar(self, *a, **k):
            return None

    assert not await rotinas.conferir_token(S(), "qualquer")
    assert not await rotinas.conferir_token(S(), None)


async def test_fora_do_render_nao_agenda(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    await rotinas.agendar()  # sem URL: retorna sem tocar no banco (não levanta)
