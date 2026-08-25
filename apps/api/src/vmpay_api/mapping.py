"""Payload da VMpay -> linhas do nosso schema.

Funções puras, sem banco: é aqui que mora a interpretação do formato do
fornecedor, e é o que mais vale testar. O payload inteiro vai junto na coluna
`payload`, então um campo novo que a API passe a mandar não se perde — dá para
criar a coluna e preencher a partir do jsonb, sem reprocessar a API.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def parse_datetime(value: Any) -> datetime | None:
    """A API devolve ISO 8601, ora com Z, ora com offset (-02:00).

    Data ingênua é tratada como UTC — é o que a API assume em toda a
    documentação de filtros.
    """
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _nested_id(payload: dict, key: str) -> int | None:
    obj = payload.get(key)
    return obj.get("id") if isinstance(obj, dict) else None


def _nested_name(payload: dict, key: str) -> str | None:
    obj = payload.get(key)
    return obj.get("name") if isinstance(obj, dict) else None


def dimensions_from(payload: dict) -> dict[str, list[dict]]:
    """Extrai client/location/machine/good embutidos na venda.

    Vêm de graça no payload, o que poupa varrer os cadastros só para ter o nome
    da máquina no dashboard. Se os cadastros forem sincronizados depois, eles
    sobrescrevem estas linhas com dado mais completo.
    """
    out: dict[str, list[dict]] = {"client": [], "location": [], "machine": [], "good": []}

    for key in ("client", "location", "good"):
        obj = payload.get(key)
        if isinstance(obj, dict) and obj.get("id") is not None:
            out[key].append({"id": obj["id"], "name": obj.get("name"), "raw": obj})

    machine = payload.get("machine")
    if isinstance(machine, dict) and machine.get("id") is not None:
        model = payload.get("machine_model") or {}
        out["machine"].append(
            {
                "id": machine["id"],
                "asset_number": machine.get("asset_number"),
                "model_id": model.get("id") if isinstance(model, dict) else None,
                "model_name": model.get("name") if isinstance(model, dict) else None,
                "raw": machine,
            }
        )
    return out


def map_cashless_fact(payload: dict) -> dict[str, Any]:
    return {
        "id": payload["id"],
        "occurred_at": parse_datetime(payload.get("occurred_at")),
        "status": payload.get("status"),
        "kind": payload.get("kind"),
        "point_of_sale": payload.get("point_of_sale"),
        "place": payload.get("place"),
        "installation_id": payload.get("installation_id"),
        "planogram_item_id": payload.get("planogram_item_id"),
        "equipment_id": payload.get("equipment_id"),
        "equipment_label_number": payload.get("equipment_label_number"),
        "equipment_serial_number": payload.get("equipment_serial_number"),
        "client_id": _nested_id(payload, "client"),
        "location_id": _nested_id(payload, "location"),
        "machine_id": _nested_id(payload, "machine"),
        "good_id": _nested_id(payload, "good"),
        "quantity": payload.get("quantity"),
        "value": payload.get("value"),
        "discount_value": payload.get("discount_value"),
        "cost_price": payload.get("cost_price"),
        "number_of_payments": payload.get("number_of_payments"),
        "eft_provider_name": _nested_name(payload, "eft_provider"),
        "eft_authorizer_name": _nested_name(payload, "eft_authorizer"),
        "eft_card_brand_name": _nested_name(payload, "eft_card_brand"),
        "eft_card_type_name": _nested_name(payload, "eft_card_type"),
        "uuid": payload.get("uuid"),
        "request_number": payload.get("request_number"),
        "order_id": payload.get("order_id"),
        "physical_locator": payload.get("physical_locator"),
        "cashless_error_friendly": payload.get("cashless_error_friendly"),
        "payload": payload,
    }


def map_vend(payload: dict) -> dict[str, Any]:
    """/vends traz os ids soltos, não aninhados como em /cashless_facts."""
    return {
        "id": payload["id"],
        "occurred_at": parse_datetime(payload.get("occurred_at")),
        "client_id": payload.get("client_id"),
        "location_id": payload.get("location_id"),
        "machine_id": payload.get("machine_id"),
        "installation_id": payload.get("installation_id"),
        "planogram_item_id": payload.get("planogram_item_id"),
        "good_id": payload.get("good_id"),
        "audit_id": payload.get("audit_id"),
        "coil": payload.get("coil"),
        "quantity": payload.get("quantity"),
        "value": payload.get("value"),
        "payload": payload,
    }


#: resource -> (mapper, tabela, filtro de cursor). O filtro é o que a doc manda
#: usar para ingestão incremental; ver docs/api-reference.md.
RESOURCES = {
    "cashless_facts": {
        "mapper": map_cashless_fact,
        "cursor_param": "transaction_id_greater_than",
        "extract_dimensions": True,
    },
    "vends": {
        "mapper": map_vend,
        "cursor_param": "vend_id_greater_than",
        "extract_dimensions": True,
    },
}
