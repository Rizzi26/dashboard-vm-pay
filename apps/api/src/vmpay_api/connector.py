"""Conector VMpay: as operações de escrita que a plataforma executa.

A interface é o contrato para conectores futuros (outro ERP, operação manual):
`restock` e `set_price` recebem ids canônicos externos e devolvem o que o
sistema externo respondeu. Tudo aqui é VMpay-específico; nada acima desta
camada sabe o que é planograma.

Como a VMpay endereça estoque por *item de planograma* (não por produto), toda
escrita começa lendo o planograma atual da instalação para traduzir good_id ->
planogram_item_id. Isso também traz o planogram_id e o saldo corrente, que o
ajuste de inventário exige.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from vmpay import VMpayClient, VMpayError


class ConnectorError(VMpayError):
    """Erro de tradução nossa (produto fora do planograma etc.) — não da API."""


@dataclass
class PlanogramView:
    planogram_id: int
    items_by_good: dict[int, dict[str, Any]]


class VMpayConnector:
    def __init__(self, client: VMpayClient):
        self.client = client

    async def _current_planogram(
        self, machine_id: int, installation_id: int
    ) -> PlanogramView:
        data = await self.client.get(
            f"machines/{machine_id}/installations/{installation_id}/current_planogram"
        )
        items = {
            item["good_id"]: item
            for item in data.get("items", [])
            if item.get("good_id") is not None
        }
        return PlanogramView(planogram_id=data["id"], items_by_good=items)

    def _resolve(self, view: PlanogramView, good_id: int) -> dict[str, Any]:
        item = view.items_by_good.get(good_id)
        if item is None:
            raise ConnectorError(
                f"produto (good_id={good_id}) não está no planograma atual desta "
                "instalação — inclua-o no planograma pela VMpay antes de operar"
            )
        return item

    async def restock(
        self, machine_id: int, installation_id: int, items: list[tuple[int, float]]
    ) -> Any:
        """Entrada de estoque: ajuste de inventário imediato (kind=now).

        `items` é [(good_id, quantidade_adicionada)]. O balance_before vai com o
        saldo corrente do planograma — é o que a API espera para calcular o novo
        saldo do item.
        """
        view = await self._current_planogram(machine_id, installation_id)
        attrs = []
        for good_id, quantity in items:
            item = self._resolve(view, good_id)
            attrs.append(
                {
                    "planogram_item_id": item["id"],
                    "balance_before": item.get("current_balance") or 0,
                    "added": str(quantity),
                    "removed": "",
                    "observed": "",
                }
            )
        body = {
            "inventory_adjustment": {
                "planogram_id": view.planogram_id,
                "kind": "now",
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                "items_attributes": attrs,
            }
        }
        return await self.client.post(
            f"machines/{machine_id}/installations/{installation_id}/inventory_adjustments",
            json=body,
        )

    async def product_refs(self) -> dict[str, list[dict[str, Any]]]:
        """Registries que o cadastro de produto exige: id + nome de cada um.

        A VMpay não cria produto sem fabricante, categoria e categoria de
        abastecimento — o formulário precisa oferecer os existentes da conta.
        """
        out: dict[str, list[dict[str, Any]]] = {}
        for key, path in (
            ("fabricantes", "manufacturers"),
            ("categorias", "categories"),
            ("categorias_abastecimento", "supply_categories"),
        ):
            out[key] = [
                {"id": item["id"], "nome": item.get("name") or ""}
                async for item in self.client.paginate(path)
            ]
        return out

    async def create_product(self, fields: dict[str, Any]) -> Any:
        """Cria o produto no cadastro da VMpay (envelope `product`).

        Cadastro ≠ prateleira: para vender, o produto ainda precisa entrar no
        planograma da instalação — isso continua sendo feito na VMpay.
        """
        return await self.client.post("products", json={"product": fields})

    async def set_price(
        self, machine_id: int, installation_id: int, changes: list[tuple[int, float]]
    ) -> Any:
        """Alteração de preço no planograma atual, agrupada numa requisição.

        A doc pede explicitamente para agrupar alterações de planograma em vez
        de mandar item a item — e avisa que só micromarket aceita PATCH e que
        pick list pendente bloqueia (422 da API nos dois casos).
        """
        view = await self._current_planogram(machine_id, installation_id)
        attrs = [
            {"id": self._resolve(view, good_id)["id"], "desired_price": price}
            for good_id, price in changes
        ]
        body = {"planogram": {"items_attributes": attrs}}
        return await self.client.patch(
            f"machines/{machine_id}/installations/{installation_id}/current_planogram",
            json=body,
        )
