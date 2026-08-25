"""Payloads da VMpay -> linhas do domínio canônico (core).

Funções puras, sem banco — a interpretação do formato do fornecedor mora aqui e
é o que os testes cobrem. A orquestração (quem chama, em que ordem, como grava)
fica em sync_core.py.
"""

from __future__ import annotations

from typing import Any

from .mapping import parse_datetime  # reexport de conveniência  # noqa: F401


def map_product(payload: dict[str, Any]) -> dict[str, Any]:
    """GET /products -> core.product (campos canônicos)."""
    return {
        "name": payload.get("name") or f"Produto {payload['id']}",
        "barcode": payload.get("barcode") or payload.get("upc_code"),
        "category": None,  # a VMpay manda category_id; o nome viria do registry
        "unit_price": payload.get("default_price"),
        "cost_price": payload.get("cost_price"),
        "active": payload.get("deleted_at") is None,
    }


def location_external_id(machine_id: int, installation_id: int) -> str:
    """Id externo estável do ponto de venda VMpay: máquina + instalação."""
    return f"{machine_id}:{installation_id}"


def installations_map(payloads: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """GET /installations -> {machine_id: instalação ativa}.

    Uma máquina tem uma instalação ativa por vez; as removidas (removed_at) são
    história e não entram. Se o relatório trouxer mais de uma ativa para a mesma
    máquina, vence a de maior id (a mais recente).
    """
    out: dict[int, dict[str, Any]] = {}
    for p in payloads:
        if p.get("removed_at") is not None:
            continue
        machine_id = p.get("machine_id")
        if machine_id is None:
            continue
        current = out.get(machine_id)
        if current is None or int(p["id"]) > int(current["id"]):
            out[machine_id] = p
    return out


def map_balance(payload: dict[str, Any]) -> dict[str, Any] | None:
    """GET /installation_stock_balances -> par (local, produto) + saldo.

    O relatório vem chaveado por máquina + produto, com nomes aninhados — que
    aproveitamos para batizar o local canônico sem chamada extra.
    """
    machine = payload.get("machine") or {}
    good = payload.get("good") or {}
    if machine.get("id") is None or good.get("id") is None:
        return None
    location = payload.get("location") or {}
    name_parts = [location.get("name"), machine.get("asset_number")]
    quantity = payload.get("inventory_balance") or 0

    # O "desired_price" DESTE relatório é o VALOR TOTAL do saldo (qtd ×
    # unitário), não o preço unitário — a descrição na doc é texto copiado de
    # outro relatório, mas o exemplo oficial entrega (saldo 18, valor 36.00) e
    # os dados reais confirmam (qtd 0 vem sempre 0.00). O unitário sai da
    # divisão; com saldo zero não há como derivar e fica nulo (o planograma da
    # instalação seria a fonte exata — fica para quando houver necessidade).
    total_value = payload.get("desired_price")
    unit_price = None
    if total_value is not None and quantity:
        unit_price = round(float(total_value) / float(quantity), 2)

    return {
        "machine_id": machine["id"],
        "good_id": good["id"],
        "quantity": quantity,
        "unit_price": unit_price,
        "location_name": " — ".join(str(p) for p in name_parts if p)
        or f"Máquina {machine['id']}",
    }
