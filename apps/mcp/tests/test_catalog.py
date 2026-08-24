import pytest

from vmpay_mcp import catalog


def test_catalogo_carrega():
    recursos = catalog.load()
    assert len(recursos) > 60
    assert "vends" in recursos and "cashless_facts" in recursos


def test_recursos_de_relatorio_sao_somente_leitura():
    for nome in ("vends", "cashless_facts", "invoices", "ruptures"):
        metodos = {op.method for op in catalog.get(nome).operations.values()}
        assert metodos == {"GET"}, f"{nome} deveria ser só leitura"


def test_cadastro_tem_crud_completo():
    ops = catalog.get("products").operations
    assert {"list", "get", "create", "update", "delete"} <= set(ops)


def test_envelope_do_corpo_veio_da_doc():
    assert catalog.get("products").operations["create"].envelope == "product"
    assert catalog.get("planograms").operations["create"].envelope == "planogram"


def test_campos_obrigatorios_de_produto():
    required = catalog.get("products").operations["create"].required
    assert "name" in required and "manufacturer_id" in required


def test_filtro_de_cursor_esta_documentado():
    assert catalog.get("cashless_facts").cursor == "transaction_id_greater_than"
    assert catalog.get("vends").cursor == "vend_id_greater_than"
    assert "transaction_id_greater_than" in catalog.get("cashless_facts").operations["list"].filters


def test_recursos_de_maquina_sao_marcados():
    assert catalog.get("remote_commands").machine_op
    assert catalog.get("inventory_adjustments").machine_op
    assert not catalog.get("products").machine_op


def test_api_obsoleta_e_sinalizada():
    assert catalog.get("vendibles").deprecated
    assert not catalog.get("products").deprecated


def test_recurso_aninhado_declara_o_caminho():
    assert catalog.get("planograms").path_params == ("machine_id", "installation_id")


def test_recurso_inexistente_sugere_parecido():
    with pytest.raises(KeyError, match="vend"):
        catalog.get("vend")


def test_verbo_invalido_lista_os_validos():
    with pytest.raises(KeyError, match="Operações disponíveis"):
        catalog.operation("vends", "delete")


def test_describe_avisa_sobre_operacao_em_maquina():
    ficha = catalog.describe("remote_commands")
    assert "VMPAY_ALLOW_MACHINE_OPS" in ficha["aviso_operacao"]
