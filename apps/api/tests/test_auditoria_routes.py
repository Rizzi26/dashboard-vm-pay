"""Auditoria: só master lê; a linha do tempo junta eventos e escrita na VMpay."""

import uuid
from datetime import datetime, timezone

from test_stock_routes import ORG_ID, _clean, call, use_role, use_session  # noqa: F401
from conftest import USER_ID

SID = uuid.UUID("00000000-0000-0000-0000-0000000005e5")


def evento(**extra):
    base = {
        "fonte": "evento", "id": 1, "em": datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc),
        "user_id": USER_ID, "session_id": SID, "action": "login", "alvo": {},
        "status": None, "erro": None, "ip": "200.1.2.3", "user_agent": "Mozilla", "email": "op@teste.dev",
        "total_filtro": 2,
    }
    return {**base, **extra}


async def test_admin_nao_ve_auditoria():
    use_role("admin")
    use_session([])
    resp = await call("GET", "/orgs/mercadinho/auditoria")
    assert resp.status_code == 403


async def test_master_ve_linha_do_tempo_com_as_duas_fontes():
    use_role("master")
    sessao = use_session(
        [
            ("with eventos as", [
                evento(fonte="vmpay", id=7, action="picklist.approve", status="success",
                       em=datetime(2026, 10, 6, 12, 5, tzinfo=timezone.utc), ip=None),
                evento(),
            ]),
            ("from core.membership m", [{"user_id": USER_ID, "email": "op@teste.dev", "role": "master"}]),
        ]
    )
    resp = await call("GET", f"/orgs/mercadinho/auditoria?sessao={SID}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [e["acao"] for e in body["eventos"]] == ["picklist.approve", "login"]
    assert body["eventos"][0]["fonte"] == "vmpay"
    assert body["membros"][0]["email"] == "op@teste.dev"
    _, params = next((q, p) for q, p in sessao.executed if "with eventos as" in q)
    assert params["org_id"] == str(ORG_ID)  # nunca lê outra organização
    assert params["sessao"] == str(SID)
    assert body["total"] == 2 and body["pagina"] == 1


async def test_pagina_vira_offset():
    use_role("master")
    sessao = use_session([("with eventos as", [evento()])])
    await call("GET", "/orgs/mercadinho/auditoria?pagina=3&limite=50")
    _, params = next((q, p) for q, p in sessao.executed if "with eventos as" in q)
    assert params["offset"] == 100


async def test_logout_vira_evento():
    use_role("viewer")
    sessao = use_session([])
    resp = await call("POST", "/orgs/mercadinho/sessao/sair")
    assert resp.status_code == 204
    assert any(p.get("action") == "logout" for q, p in sessao.executed if "core.audit_event" in q)
