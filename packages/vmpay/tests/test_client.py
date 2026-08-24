import httpx
import pytest
import respx

from vmpay import MAX_PER_PAGE, VMpayAuthError, VMpayClient, VMpayError, redact
from vmpay.ratelimit import TokenBucket

BASE = "https://vmpay.test/api/v1"


def make_client(**kwargs) -> VMpayClient:
    return VMpayClient("segredo", base_url=BASE, max_retries=2, **kwargs)


# ------------------------------------------------------------------ redaction


def test_redact_esconde_o_token():
    url = f"{BASE}/vends?access_token=abc123&per_page=10"
    assert "abc123" not in redact(url)
    assert "per_page=10" in redact(url)


def test_redact_preserva_o_id_do_operador_filho():
    out = redact(f"{BASE}/vends?access_token=abc123@77")
    assert "abc123" not in out
    assert out.endswith("[REDACTED]@77")


def test_repr_nao_vaza_token():
    assert "segredo" not in repr(make_client())


# ----------------------------------------------------------------------- auth


@respx.mock
async def test_token_vai_na_query_string():
    route = respx.get(f"{BASE}/categories").mock(return_value=httpx.Response(200, json=[]))
    async with make_client() as vm:
        await vm.get("categories")
    assert route.calls.last.request.url.params["access_token"] == "segredo"


@respx.mock
async def test_operador_filho_anexa_id_ao_token():
    route = respx.get(f"{BASE}/vends").mock(return_value=httpx.Response(200, json=[]))
    async with make_client(child_operator_id=77) as vm:
        await vm.get("vends")
    assert route.calls.last.request.url.params["access_token"] == "segredo@77"


@respx.mock
async def test_401_vira_erro_de_auth():
    respx.get(f"{BASE}/vends").mock(return_value=httpx.Response(401, text="unauthorized"))
    async with make_client() as vm:
        with pytest.raises(VMpayAuthError):
            await vm.get("vends")


# ------------------------------------------------------------------ paginação


@respx.mock
async def test_paginate_para_quando_a_pagina_vem_incompleta():
    cheia = [{"id": i} for i in range(3)]
    respx.get(f"{BASE}/vends").mock(
        side_effect=[
            httpx.Response(200, json=cheia),
            httpx.Response(200, json=[{"id": 99}]),
        ]
    )
    async with make_client() as vm:
        got = [r async for r in vm.paginate("vends", per_page=3)]
    assert [r["id"] for r in got] == [0, 1, 2, 99]


@respx.mock
async def test_paginate_incrementa_a_pagina():
    respx.get(f"{BASE}/vends").mock(
        side_effect=[
            httpx.Response(200, json=[{"id": 1}]),
            httpx.Response(200, json=[]),
        ]
    )
    async with make_client() as vm:
        [r async for r in vm.paginate("vends", per_page=1)]
    paginas = [int(c.request.url.params["page"]) for c in respx.calls]
    assert paginas == [1, 2]


async def test_paginate_recusa_per_page_acima_do_limite():
    async with make_client() as vm:
        with pytest.raises(ValueError, match="1000"):
            [r async for r in vm.paginate("vends", per_page=MAX_PER_PAGE + 1)]


# --------------------------------------------------------------------- cursor


@respx.mock
async def test_iter_since_avanca_pelo_maior_id():
    respx.get(f"{BASE}/cashless_facts").mock(
        side_effect=[
            httpx.Response(200, json=[{"id": 7}, {"id": 5}]),  # fora de ordem
            httpx.Response(200, json=[]),
        ]
    )
    async with make_client() as vm:
        got = [
            r
            async for r in vm.iter_since(
                "cashless_facts", cursor_param="transaction_id_greater_than", per_page=2
            )
        ]
    assert [r["id"] for r in got] == [7, 5]
    cursores = [
        int(c.request.url.params["transaction_id_greater_than"]) for c in respx.calls
    ]
    assert cursores == [0, 7]  # avançou pelo maior, não pelo último


@respx.mock
async def test_iter_since_nao_gira_para_sempre():
    respx.get(f"{BASE}/cashless_facts").mock(
        return_value=httpx.Response(200, json=[{"id": 5}, {"id": 5}])
    )
    async with make_client() as vm:
        with pytest.raises(VMpayError, match="cursor travado"):
            [
                r
                async for r in vm.iter_since(
                    "cashless_facts",
                    cursor_param="transaction_id_greater_than",
                    since_id=5,
                    per_page=2,
                )
            ]


# --------------------------------------------------------------- retry / 429


@respx.mock
async def test_429_e_retentado(monkeypatch):
    monkeypatch.setattr("vmpay.client.asyncio.sleep", _no_sleep)
    respx.get(f"{BASE}/vends").mock(
        side_effect=[
            httpx.Response(429, json={"error": "Too many requests"}),
            httpx.Response(200, json=[{"id": 1}]),
        ]
    )
    async with make_client() as vm:
        assert await vm.get("vends") == [{"id": 1}]


@respx.mock
async def test_422_nao_e_retentado(monkeypatch):
    monkeypatch.setattr("vmpay.client.asyncio.sleep", _no_sleep)
    route = respx.post(f"{BASE}/products").mock(
        return_value=httpx.Response(422, text="invalid")
    )
    async with make_client() as vm:
        with pytest.raises(VMpayError):
            await vm.post("products", json={})
    assert route.call_count == 1


@respx.mock
async def test_204_devolve_none():
    respx.delete(f"{BASE}/products/1").mock(return_value=httpx.Response(204))
    async with make_client() as vm:
        assert await vm.delete("products/1") is None


async def _no_sleep(_seconds):
    return None


# ----------------------------------------------------------------- ratelimit


async def test_balde_repoe_continuamente():
    bucket = TokenBucket(rate=60, per_seconds=60)
    for _ in range(60):
        await bucket.acquire()
    assert bucket.available == 0
