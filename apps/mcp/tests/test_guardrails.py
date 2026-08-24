import pytest

from vmpay_mcp import catalog
from vmpay_mcp.config import Settings
from vmpay_mcp.server import (
    build_path,
    check_required,
    guard_confirmation,
    require_machine_ops,
    unknown_filters,
    wrap_body,
)


def settings(**kwargs):
    base = dict(
        base_url="https://homolog.test/api/v1",
        base_explicit=True,
        allow_writes=False,
        allow_machine_ops=False,
    )
    base.update(kwargs)
    return Settings(**base)


# ------------------------------------------------------------------ ambiente


def test_escrita_exige_base_declarada():
    """Sem VMPAY_BASE não se sabe se é homologação ou produção — não escreve."""
    s = settings(base_explicit=False, allow_writes=True)
    assert not s.writes_enabled
    assert "somente leitura" in s.status()


def test_escrita_liberada_com_base_declarada():
    assert settings(allow_writes=True).writes_enabled


def test_operacao_em_maquina_exige_os_dois_interruptores(monkeypatch):
    monkeypatch.setenv("VMPAY_ALLOW_MACHINE_OPS", "1")
    monkeypatch.delenv("VMPAY_ALLOW_WRITES", raising=False)
    monkeypatch.setenv("VMPAY_BASE", "https://homolog.test/api/v1")
    assert not Settings.from_env().machine_ops_enabled


def test_operacao_em_maquina_com_ambos(monkeypatch):
    monkeypatch.setenv("VMPAY_ALLOW_MACHINE_OPS", "1")
    monkeypatch.setenv("VMPAY_ALLOW_WRITES", "1")
    monkeypatch.setenv("VMPAY_BASE", "https://homolog.test/api/v1")
    assert Settings.from_env().machine_ops_enabled


# ----------------------------------------------------------------- permissão


def test_comando_remoto_bloqueado_sem_o_interruptor(monkeypatch):
    monkeypatch.setattr("vmpay_mcp.server.settings", settings(allow_writes=True))
    with pytest.raises(PermissionError, match="VMPAY_ALLOW_MACHINE_OPS"):
        require_machine_ops(catalog.get("remote_commands"))


def test_cadastro_comum_nao_exige_interruptor_de_maquina(monkeypatch):
    monkeypatch.setattr("vmpay_mcp.server.settings", settings(allow_writes=True))
    require_machine_ops(catalog.get("products"))  # não levanta


# --------------------------------------------------------------- confirmação


def test_confirmacao_precisa_bater_com_o_alvo():
    guard_confirmation(857, "857", "excluir")
    with pytest.raises(ValueError, match="confirmação não confere"):
        guard_confirmation(857, "858", "excluir")


def test_confirmacao_vazia_e_recusada():
    with pytest.raises(ValueError):
        guard_confirmation(857, "", "excluir")


# -------------------------------------------------------------------- caminho


def test_caminho_aninhado_e_preenchido():
    resource, op = catalog.operation("planograms", "get")
    path = build_path(resource, op.path, {"machine_id": 49, "installation_id": 857}, 4164)
    assert path == "machines/49/installations/857/planograms/4164"


def test_caminho_incompleto_diz_o_que_falta():
    resource, op = catalog.operation("planograms", "list")
    with pytest.raises(ValueError, match="installation_id"):
        build_path(resource, op.path, {"machine_id": 49})


# -------------------------------------------------------------------- corpo


def test_corpo_e_embrulhado_no_envelope():
    _, op = catalog.operation("products", "create")
    assert wrap_body(op, {"name": "Coca"}) == {"product": {"name": "Coca"}}


def test_corpo_ja_embrulhado_nao_duplica():
    _, op = catalog.operation("products", "create")
    corpo = {"product": {"name": "Coca"}}
    assert wrap_body(op, corpo) == corpo


def test_campos_obrigatorios_sao_checados_antes_de_chamar():
    _, op = catalog.operation("products", "create")
    with pytest.raises(ValueError, match="manufacturer_id"):
        check_required(op, {"name": "Coca"})


# ------------------------------------------------------------------- filtros


def test_filtro_desconhecido_vira_aviso_nao_erro():
    _, op = catalog.operation("vends", "list")
    assert unknown_filters(op, {"machine_id": 1, "inventado": 2}) == ["inventado"]


def test_paginacao_nao_conta_como_filtro_desconhecido():
    _, op = catalog.operation("vends", "list")
    assert unknown_filters(op, {"page": 1, "per_page": 500}) == []


def test_recurso_sem_filtros_documentados_aceita_tudo():
    _, op = catalog.operation("units", "list")
    assert unknown_filters(op, {"qualquer_coisa": 1}) == []
