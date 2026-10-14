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
from decimal import Decimal
from typing import Any

from vmpay import VMpayClient, VMpayError


def _quantidade(valor: float | int | Decimal) -> str:
    """Quantidade no formato que o ajuste de inventário aceita.

    A VMpay recusa "6.0" com 422 ("não é um número inteiro") — e a rota entrega
    float, então str() direto quebrava toda carga. Inteiro vai sem casa
    decimal; fracionado (granel) segue como veio, e a API decide.
    """
    d = Decimal(str(valor))
    if d == d.to_integral_value():
        return str(int(d))
    return format(d.normalize(), "f")


#: Teto de itens por PATCH de planograma, segundo a doc da VMpay.
LIMITE_ITENS_PLANOGRAMA = 2000


class ConnectorError(VMpayError):
    """Erro de tradução nossa (produto fora do planograma etc.) — não da API."""


@dataclass
class PlanogramView:
    planogram_id: int
    items_by_good: dict[int, dict[str, Any]]
    #: Todos os itens: o mesmo produto pode ocupar mais de uma posição, e
    #: preço mudado numa só deixaria a outra cobrando o antigo.
    items: list[dict[str, Any]]


class VMpayConnector:
    def __init__(self, client: VMpayClient):
        self.client = client

    async def current_planogram(
        self, machine_id: int, installation_id: int
    ) -> PlanogramView:
        data = await self.client.get(
            f"machines/{machine_id}/installations/{installation_id}/current_planogram"
        )
        todos = [i for i in data.get("items", []) if i.get("good_id") is not None]
        return PlanogramView(
            planogram_id=data["id"],
            items_by_good={item["good_id"]: item for item in todos},
            items=todos,
        )

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
        view = await self.current_planogram(machine_id, installation_id)
        attrs = []
        for good_id, quantity in items:
            item = self._resolve(view, good_id)
            attrs.append(
                {
                    "planogram_item_id": item["id"],
                    "balance_before": item.get("current_balance") or 0,
                    "added": _quantidade(quantity),
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

    async def carregar(
        self,
        machine_id: int,
        installation_id: int,
        items: list[tuple[int, float]],
        notas: str,
        marcador: str,
    ) -> dict[str, Any]:
        """Carga como CARREGAMENTO na VMpay: pick list + reabastecimento.

        É o que aparece como carregamento para o operador (o ajuste de
        inventário de restock() aparece como "ajuste"). `marcador` é um texto
        único desta carga que vai dentro de `notas` — é por ele que se acha a
        NOSSA pick list quando a resposta da VMpay se perde.

        Devolve {pick_list_id, carregados: {good_id: qtd}, ignorados: [...]}
        — o que a VMpay de fato carregou, que é o que se reflete no painel.
        """
        base = f"machines/{machine_id}/installations/{installation_id}"

        # Só "somente por pick list": nas outras estratégias o /restock sem a
        # nossa pick list pendente pode virar reabastecimento COMPLETO.
        instalacao = await self.client.get(base)
        estrategia = (instalacao or {}).get("restock_strategy")
        if estrategia != "require_pending_pick_list":
            raise ConnectorError(
                f"a instalação está em '{estrategia}': carga como carregamento só em "
                "'somente por pick list' — desligue o modo carregamento desta loja"
            )

        # O /restock executa A pick list pendente da loja — se houver uma criada
        # na VMpay, seria a dela, não a nossa.
        pendente = await self._pick_list_pendente(base)
        if pendente is not None:
            raise ConnectorError(
                f"já há pick list pendente na VMpay para esta loja (nº {pendente.get('id')}) — "
                "conclua ou apague-a na VMpay antes de lançar pelo painel"
            )

        somados: dict[int, Decimal] = {}
        for good_id, quantidade in items:
            somados[good_id] = somados.get(good_id, Decimal(0)) + Decimal(str(quantidade))
        fracionados = [g for g, q in somados.items() if q != q.to_integral_value()]
        if fracionados:
            raise ConnectorError(
                "quantidade fracionada não vai como carregamento (pick list é em unidades) — "
                "confira o fator de conversão ou desligue o modo carregamento"
            )
        view = await self.current_planogram(machine_id, installation_id)
        itens = [
            {
                "planogram_item_id": self._resolve(view, good_id)["id"],
                "quantity": int(q),
                # Sem as regras da instalação: a quantidade é a que chegou,
                # não a que a regra de abastecimento acharia certa.
                "skip_rules": True,
            }
            for good_id, q in somados.items()
        ]

        # Sem retry: um timeout pode ter criado a pick list do lado de lá.
        try:
            pick_list = await self.client.post(
                f"{base}/pick_lists",
                json={"pick_list": {"planogram_id": view.planogram_id, "notes": notas, "items_attributes": itens}},
                retry=False,
            )
        except VMpayError:
            await self._apagar_nossa_pendente(base, marcador)
            raise
        if not isinstance(pick_list, dict) or "id" not in pick_list:
            await self._apagar_nossa_pendente(base, marcador)
            raise ConnectorError("a VMpay não devolveu o número da pick list — nada foi carregado")
        pick_id = pick_list["id"]

        try:
            await self.client.post(f"{base}/restock", json={"restock_mode": "restock_only"}, retry=False)
        except VMpayError:
            # Erro na resposta não quer dizer que não aplicou (timeout, 5xx, ou
            # o abastecedor reabasteceu pela máquina no meio). Aplicada = sucesso;
            # ainda pendente = apaga (pendente trava preço/cadastro e seria
            # executada no próximo reabastecimento físico).
            estado = await self._ler_pick_list(base, pick_id)
            if estado is None or estado.get("pending"):
                try:
                    await self.client.delete(f"{base}/pick_lists/{pick_id}")
                except VMpayError:
                    pass  # o erro que importa é o do reabastecimento
                raise

        # O que entrou de fato: item pode voltar "ignored" (estoque de CD).
        final = await self._ler_pick_list(base, pick_id) or {}
        carregados: dict[int, float] = {}
        ignorados: list[dict[str, Any]] = []
        for item in final.get("items", []):
            if item.get("ignored"):
                ignorados.append({"good_id": item.get("good_id"), "motivo": item.get("ignore_reason")})
            elif item.get("good_id") is not None:
                carregados[int(item["good_id"])] = float(item.get("quantity") or 0)
        if not final.get("items"):
            # Sem o detalhe, o pedido é a melhor informação que há.
            carregados = {g: float(q) for g, q in somados.items()}
        return {"pick_list_id": pick_id, "carregados": carregados, "ignorados": ignorados}

    async def _pick_list_pendente(self, base: str) -> dict[str, Any] | None:
        async for p in self.client.paginate(f"{base}/pick_lists"):
            if p.get("pending"):
                return p
        return None

    async def _ler_pick_list(self, base: str, pick_id: Any) -> dict[str, Any] | None:
        try:
            return await self.client.get(f"{base}/pick_lists/{pick_id}", show_all_items="true")
        except VMpayError:
            return None

    async def _apagar_nossa_pendente(self, base: str, marcador: str) -> None:
        """Pick list criada apesar do erro na resposta: acha pela marca e apaga."""
        try:
            async for p in self.client.paginate(f"{base}/pick_lists"):
                if p.get("pending") and marcador in (p.get("notes") or ""):
                    await self.client.delete(f"{base}/pick_lists/{p['id']}")
        except VMpayError:
            pass

    async def contar(
        self,
        machine_id: int,
        installation_id: int,
        contagens: list[tuple[int, float]],
        view: PlanogramView | None = None,
    ) -> Any:
        """Contagem de inventário: o saldo do item passa a ser o que foi contado.

        `contagens` é [(good_id, quantidade_observada)]. Vai como `observed`
        num ajuste imediato — a VMpay calcula a diferença (balance_after =
        observed), para cima ou para baixo, sem a gente mandar added/removed.
        """
        view = view or await self.current_planogram(machine_id, installation_id)
        attrs = []
        for good_id, observado in contagens:
            item = self._resolve(view, good_id)
            attrs.append(
                {
                    "planogram_item_id": item["id"],
                    "balance_before": item.get("current_balance") or 0,
                    "added": "",
                    "removed": "",
                    "observed": _quantidade(observado),
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

    async def set_status(
        self,
        machine_id: int,
        installation_id: int,
        changes: list[tuple[int, str]],
        view: PlanogramView | None = None,
    ) -> Any:
        """Situação dos itens no planograma: active, suspended ou inactive.

        É como se tira produto de linha — a VMpay não apaga item de planograma
        (`_destroy` é ignorado). Vale para todas as posições do mesmo produto.
        """
        view = view or await self.current_planogram(machine_id, installation_id)
        attrs = []
        for good_id, status in changes:
            if status not in ("active", "suspended", "inactive"):
                raise ConnectorError(f"situação '{status}' não existe no planograma")
            self._resolve(view, good_id)
            attrs.extend({"id": i["id"], "status": status} for i in view.items if i["good_id"] == good_id)
        if len(attrs) > LIMITE_ITENS_PLANOGRAMA:
            raise ConnectorError(
                f"{len(attrs)} itens numa alteração só; a VMpay aceita até {LIMITE_ITENS_PLANOGRAMA} por requisição"
            )
        return await self.client.patch(
            f"machines/{machine_id}/installations/{installation_id}/current_planogram",
            json={"planogram": {"items_attributes": attrs}},
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
            try:
                out[key] = [
                    {"id": item["id"], "nome": item.get("name") or ""}
                    async for item in self.client.paginate(path)
                ]
            except VMpayError as exc:
                # Categoria de abastecimento só é obrigatória para quem usa mais
                # de uma (doc da VMpay), e há conta cujo token nem enxerga a lista
                # (401 na demo). Sem ela o cadastro segue sem o campo.
                if path != "supply_categories" or exc.status not in (401, 403):
                    raise
                out[key] = []
        return out

    async def create_product(self, fields: dict[str, Any]) -> Any:
        """Cria o produto no cadastro da VMpay (envelope `product`).

        Cadastro ≠ prateleira: para vender, o produto ainda precisa entrar no
        planograma da instalação (ver incluir_no_planograma).
        """
        return await self.client.post("products", json={"product": fields})

    async def delete_product(self, good_id: int) -> Any:
        """Exclui o produto do cadastro da VMpay (204). Só para produto que
        nunca foi para loja — quem chama confere isso antes."""
        return await self.client.delete(f"products/{good_id}")

    async def incluir_no_planograma(
        self,
        machine_id: int,
        installation_id: int,
        itens: list[dict[str, Any]],
        view: PlanogramView | None = None,
    ) -> Any:
        """Põe produtos na prateleira da loja: itens novos no planograma atual.

        `itens`: [{good_id, preco, capacidade, nivel_ideal, nivel_alerta}].
        Cada item novo precisa de um logical_locator inteiro único no
        planograma — o próximo depois do maior que existe. A VMpay só aceita
        isso em micromarket, sem pick list pendente (422), e não deixa apagar
        item depois: tirar de linha é inativar/suspender.
        """
        view = view or await self.current_planogram(machine_id, installation_id)
        ja = {i["good_id"] for i in view.items}
        repetidos = [i["good_id"] for i in itens if i["good_id"] in ja]
        if repetidos:
            raise ConnectorError(f"produtos já estão no planograma: {repetidos}")
        numeros = [int(i["logical_locator"]) for i in view.items if str(i.get("logical_locator", "")).isdigit()]
        proximo = max(numeros, default=0) + 1
        attrs = []
        for n, item in enumerate(itens):
            posicao = proximo + n
            attrs.append(
                {
                    "type": "Coil",
                    "good_id": item["good_id"],
                    "name": str(posicao),
                    "logical_locator": posicao,
                    "capacity": item["capacidade"],
                    "par_level": item["nivel_ideal"],
                    "alert_level": item["nivel_alerta"],
                    "desired_price": item["preco"],
                    "use_default_price_product": False,
                    "status": "active",
                }
            )
        if len(attrs) > LIMITE_ITENS_PLANOGRAMA:
            raise ConnectorError(
                f"{len(attrs)} itens numa alteração só; a VMpay aceita até "
                f"{LIMITE_ITENS_PLANOGRAMA} por requisição"
            )
        return await self.client.patch(
            f"machines/{machine_id}/installations/{installation_id}/current_planogram",
            json={"planogram": {"items_attributes": attrs}},
        )

    async def set_price(
        self,
        machine_id: int,
        installation_id: int,
        changes: list[tuple[int, float]],
        view: PlanogramView | None = None,
    ) -> Any:
        """Alteração de preço no planograma atual, agrupada numa requisição.

        A doc pede explicitamente para agrupar alterações de planograma em vez
        de mandar item a item — e avisa que só micromarket aceita PATCH e que
        pick list pendente bloqueia (422 da API nos dois casos). `view` evita
        reler o planograma quando quem chama acabou de lê-lo.

        `use_default_price_product` vai sempre false: com ele ligado a VMpay
        aceita o desired_price e continua cobrando o preço padrão do produto —
        a alteração "funcionava" e nada mudava no caixa.
        """
        view = view or await self.current_planogram(machine_id, installation_id)
        attrs = []
        for good_id, price in changes:
            self._resolve(view, good_id)
            attrs.extend(
                {"id": item["id"], "desired_price": price, "use_default_price_product": False}
                for item in view.items
                if item["good_id"] == good_id
            )
        if len(attrs) > LIMITE_ITENS_PLANOGRAMA:
            raise ConnectorError(
                f"{len(attrs)} itens numa alteração só; a VMpay aceita até "
                f"{LIMITE_ITENS_PLANOGRAMA} por requisição"
            )
        body = {"planogram": {"items_attributes": attrs}}
        return await self.client.patch(
            f"machines/{machine_id}/installations/{installation_id}/current_planogram",
            json=body,
        )
