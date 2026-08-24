"""O payload real da doc oficial, mapeado para as nossas colunas."""

from datetime import timezone

from vmpay_api.mapping import (
    dimensions_from,
    map_cashless_fact,
    map_vend,
    parse_datetime,
)

# Extraído do exemplo de retorno em reports/cashless_facts da doc oficial.
CANCELADA = {
    "id": 16732372,
    "occurred_at": "2018-02-28T21:34:21.000Z",
    "point_of_sale": "AA000009",
    "kind": "eft_pinpad",
    "status": "CANCEL",
    "installation_id": 9509,
    "planogram_item_id": None,
    "equipment_id": 1061,
    "equipment_label_number": "1064",
    "equipment_serial_number": "70B3D5CB818C",
    "masked_card_number": None,
    "number_of_payments": 0,
    "quantity": 1,
    "value": 0.1,
    "discount_value": None,
    "request_number": "",
    "uuid": "2d9b0c2b-a67e-4dd0-a99a-7cfda2536731",
    "cost_price": 0.1,
    "physical_locator": "3",
    "place": "Mesa do Fernandes",
    "client": {"id": 2854, "name": "Cliente virtual"},
    "location": {"id": 3515, "name": "Cliente virtual"},
    "machine": {"id": 3184, "asset_number": "1072"},
    "machine_model": {"id": 32, "name": "Totem"},
    "eft_provider": {"id": 2, "name": "SiTef"},
    "eft_authorizer": {"id": 5, "name": "Stone"},
    "eft_card_brand": {"id": 24, "name": "Indefinido"},
    "eft_card_type": {"id": 4, "name": "Indefinido"},
    "cashless_error_friendly": "Operação cancelada pelo operador.",
}


# ------------------------------------------------------------------- datas


def test_data_com_z_vira_utc():
    dt = parse_datetime("2018-02-28T21:34:21.000Z")
    assert dt.tzinfo is not None
    assert dt.utctimetuple().tm_hour == 21


def test_data_com_offset_e_preservada():
    dt = parse_datetime("2016-01-26T07:45:36.000-02:00")
    assert dt.astimezone(timezone.utc).hour == 9


def test_data_ingenua_e_tratada_como_utc():
    """É o que a API assume em toda a documentação de filtros."""
    assert parse_datetime("2024-01-01T10:00:00").tzinfo == timezone.utc


def test_data_ausente_ou_invalida_nao_explode():
    assert parse_datetime(None) is None
    assert parse_datetime("") is None
    assert parse_datetime("ontem") is None


# --------------------------------------------------------------- cashless


def test_ids_aninhados_sao_achatados():
    row = map_cashless_fact(CANCELADA)
    assert row["client_id"] == 2854
    assert row["location_id"] == 3515
    assert row["machine_id"] == 3184


def test_nomes_de_tef_sao_desnormalizados():
    row = map_cashless_fact(CANCELADA)
    assert row["eft_provider_name"] == "SiTef"
    assert row["eft_authorizer_name"] == "Stone"


def test_status_e_preservado_como_veio():
    """Filtrar cancelada é papel da view vmpay.sale, não do mapper."""
    assert map_cashless_fact(CANCELADA)["status"] == "CANCEL"


def test_payload_inteiro_e_guardado():
    row = map_cashless_fact(CANCELADA)
    assert row["payload"] == CANCELADA
    # inclusive o que não virou coluna
    assert row["payload"]["masked_card_number"] is None


def test_campo_ausente_vira_none_em_vez_de_estourar():
    row = map_cashless_fact({"id": 1, "occurred_at": "2024-01-01T00:00:00Z"})
    assert row["machine_id"] is None
    assert row["value"] is None


def test_objeto_aninhado_nulo_nao_quebra():
    row = map_cashless_fact({"id": 1, "occurred_at": "2024-01-01T00:00:00Z", "machine": None})
    assert row["machine_id"] is None


# -------------------------------------------------------------- dimensões


def test_dimensoes_saem_do_payload_da_venda():
    dims = dimensions_from(CANCELADA)
    assert dims["client"][0] == {"id": 2854, "name": "Cliente virtual", "raw": CANCELADA["client"]}
    assert dims["machine"][0]["asset_number"] == "1072"


def test_modelo_da_maquina_e_juntado_na_dimensao():
    """machine_model vem solto no payload, mas pertence à máquina."""
    maquina = dimensions_from(CANCELADA)["machine"][0]
    assert maquina["model_id"] == 32
    assert maquina["model_name"] == "Totem"


def test_dimensao_sem_id_e_ignorada():
    assert dimensions_from({"client": {"name": "sem id"}})["client"] == []


# ------------------------------------------------------------------ vends


def test_vend_usa_ids_soltos_nao_aninhados():
    """/vends tem formato diferente de /cashless_facts — ids no nível de cima."""
    row = map_vend(
        {
            "id": 123489,
            "occurred_at": "2016-01-26T07:45:36.000-02:00",
            "client_id": 1,
            "machine_id": 3,
            "good_id": 7,
            "coil": "1",
            "quantity": 1,
            "value": 2.5,
        }
    )
    assert row["client_id"] == 1
    assert row["machine_id"] == 3
    assert row["coil"] == "1"
