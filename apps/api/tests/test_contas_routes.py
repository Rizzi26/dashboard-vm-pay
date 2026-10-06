"""Contas VMpay: token testado antes de aceitar, cofre, conta repetida, principal."""

import uuid

import httpx
import respx
from test_stock_routes import ORG_ID, _clean, call, use_role, use_session  # noqa: F401

from vmpay_api.routers import contas as contas_router

BASE = "https://vmpay.teste/api/v1"
TOKEN = "token-da-loja-tres-super-secreto"
SECRET_ID = uuid.UUID("00000000-0000-0000-0000-00000000cafe")


def _ambiente(monkeypatch):
    monkeypatch.setenv("VMPAY_BASE", BASE)
    agendadas = []
    monkeypatch.setattr(contas_router, "sincronizar_conta", lambda conta_id: agendadas.append(conta_id))
    return agendadas


async def test_so_master_gerencia_contas():
    use_role("admin")
    use_session([])
    assert (await call("GET", "/orgs/mercadinho/contas")).status_code == 403


@respx.mock
async def test_adicionar_testa_o_token_guarda_no_cofre_e_importa(monkeypatch):
    agendadas = _ambiente(monkeypatch)
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=[{"id": 900, "machine_id": 77}])
    )
    use_role("master")
    sessao = use_session([("vault.create_secret", [SECRET_ID])])
    resp = await call("POST", "/orgs/mercadinho/contas", json={"nome": "Jardins III", "token": f"  {TOKEN}\n"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["maquinas"] == 1 and body["importando"] is True
    assert TOKEN not in resp.text  # o token nunca volta

    cofre = next(p for q, p in sessao.executed if "vault.create_secret" in q)
    assert cofre["token"] == TOKEN  # já limpo de espaço/quebra
    integ = next(p for q, p in sessao.executed if "insert into core.integration" in q)
    assert integ["config"] == f'{{"secret_id": "{SECRET_ID}"}}'  # só o id, nunca o token
    assert integ["org_id"] == str(ORG_ID)
    auditoria = next(p for q, p in sessao.executed if "core.audit_event" in q)
    assert TOKEN not in str(auditoria)
    assert agendadas == [uuid.UUID(body["id"])]


@respx.mock
async def test_token_recusado_pela_vmpay_vira_422_sem_gravar_nada(monkeypatch):
    _ambiente(monkeypatch)
    respx.get(f"{BASE}/installations").mock(return_value=httpx.Response(401, text="unauthorized"))
    use_role("master")
    sessao = use_session([])
    resp = await call("POST", "/orgs/mercadinho/contas", json={"nome": "X", "token": TOKEN})
    assert resp.status_code == 422
    assert "recusou" in resp.json()["detail"]
    assert not any("vault" in q or "insert" in q for q, _ in sessao.executed)


@respx.mock
async def test_conta_ja_conectada_e_recusada(monkeypatch):
    _ambiente(monkeypatch)
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=[{"id": 857, "machine_id": 49}])
    )
    use_role("master")
    use_session([("from core.location_link ll", [{"machine_id": 49, "name": "CONDOMINIO JARDINS II — 002"}])])
    resp = await call("POST", "/orgs/mercadinho/contas", json={"nome": "De novo", "token": TOKEN})
    assert resp.status_code == 409
    assert "JARDINS II" in resp.json()["detail"]


async def test_conta_principal_nao_e_desativada_pelo_painel():
    use_role("master")
    use_session([("from core.integration", [{"id": uuid.uuid4(), "nome": "Conta principal", "active": True,
                                              "config": {"token_env": "VMPAY_INGEST_TOKEN"}}])])
    resp = await call("PATCH", f"/orgs/mercadinho/contas/{uuid.uuid4()}", json={"ativo": False})
    assert resp.status_code == 409


async def test_lista_mostra_leitura_pelo_estoque_e_erro_pelo_cursor_da_conta():
    from datetime import datetime, timezone

    conta = uuid.UUID("00000000-0000-0000-0000-0000000000c2")
    use_role("master")
    use_session([
        ("from core.integration i", [
            {"id": conta, "nome": "Jardins III", "active": True, "created_at": datetime(2026, 10, 6, tzinfo=timezone.utc),
             "no_cofre": True, "legado": False, "lojas": ["JARDINS III — 003"], "lida": datetime(2026, 10, 6, 15, tzinfo=timezone.utc)},
        ]),
        ("from vmpay.sync_cursor", [
            {"resource": f"vends@{conta}", "last_error": "401 da VMpay"},
            {"resource": "vends", "last_error": "erro de OUTRA conta"},
        ]),
    ])
    body = (await call("GET", "/orgs/mercadinho/contas")).json()
    assert body[0]["ultima_leitura"].startswith("2026-10-06T15")
    assert body[0]["erro"] == "401 da VMpay"  # só o erro da própria conta


PRINCIPAL = uuid.UUID("00000000-0000-0000-0000-0000000000a1")


def _principal_em_env():
    return ("from core.integration", [{"id": PRINCIPAL, "nome": "Conta principal", "active": True,
                                       "config": {"token_env": "VMPAY_INGEST_TOKEN"}}])


@respx.mock
async def test_trocar_token_da_principal_move_para_o_cofre_sem_perder_o_cursor(monkeypatch):
    _ambiente(monkeypatch)
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=[{"id": 857, "machine_id": 49}])
    )
    use_role("master")
    sessao = use_session([
        _principal_em_env(),
        ("select distinct machine_id from core.location_link", [{"machine_id": 49}]),
        ("vault.create_secret", [SECRET_ID]),
    ])
    resp = await call("PATCH", f"/orgs/mercadinho/contas/{PRINCIPAL}", json={"token": TOKEN})
    assert resp.status_code == 200, resp.text
    assert "cofre" in resp.json()
    novo = next(p for q, p in sessao.executed if "set config" in q)
    # cursor "legado": a principal continua no cursor de sempre (nada reprocessado)
    assert novo["config"] == f'{{"secret_id": "{SECRET_ID}", "cursor": "legado"}}'
    assert TOKEN not in resp.text


@respx.mock
async def test_token_de_outra_conta_nao_substitui_o_desta(monkeypatch):
    _ambiente(monkeypatch)
    respx.get(f"{BASE}/installations").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "machine_id": 3049}])  # outra loja
    )
    use_role("master")
    sessao = use_session([
        _principal_em_env(),
        ("select distinct machine_id from core.location_link", [{"machine_id": 49}]),
    ])
    resp = await call("PATCH", f"/orgs/mercadinho/contas/{PRINCIPAL}", json={"token": TOKEN})
    assert resp.status_code == 409
    assert "outra conta" in resp.json()["detail"]
    assert not any("vault" in q for q, _ in sessao.executed)


def test_principal_migrada_continua_principal():
    from vmpay_api.sync_core import eh_conta_original

    assert eh_conta_original({"token_env": "VMPAY_INGEST_TOKEN"})
    assert eh_conta_original({"secret_id": "x", "cursor": "legado"})
    assert not eh_conta_original({"secret_id": "x"})
