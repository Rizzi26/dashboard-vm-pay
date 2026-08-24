"""Catálogo de recursos da VMpay, gerado a partir da doc oficial.

Regenerar com `python3 apps/mcp/tools/build_catalog.py` sempre que a Nayax
publicar documentação nova.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

CATALOG_PATH = Path(__file__).with_name("catalog.json")

GROUP_LABELS = {
    "cadastro": "Cadastros",
    "relatorio": "Relatórios",
    "dominio": "Tabelas de domínio",
    "inventario": "Inventário",
}

#: Recursos que mexem em estoque ou na máquina física. Ficam atrás de um
#: segundo interruptor, separado do de escrita.
MACHINE_OPS = frozenset(
    {"remote_commands", "inventory_adjustments", "restock", "external_efts"}
)

#: A ingestão incremental recomendada pela doc, por recurso.
CURSORS = {
    "cashless_facts": "transaction_id_greater_than",
    "vends": "vend_id_greater_than",
}


@dataclass(frozen=True)
class Operation:
    verb: str
    method: str
    path: str
    filters: tuple[str, ...]
    required: tuple[str, ...]
    optional: tuple[str, ...]
    envelope: str | None

    @property
    def writes(self) -> bool:
        return self.method != "GET"


@dataclass(frozen=True)
class Resource:
    name: str
    label: str
    group: str
    doc: str
    path_params: tuple[str, ...]
    operations: dict[str, Operation]
    deprecated: bool

    @property
    def machine_op(self) -> bool:
        return self.name in MACHINE_OPS

    @property
    def cursor(self) -> str | None:
        return CURSORS.get(self.name)

    def summary(self) -> str:
        verbs = "/".join(sorted(self.operations))
        flags = []
        if self.deprecated:
            flags.append("OBSOLETO")
        if self.machine_op:
            flags.append("operação em máquina")
        if self.cursor:
            flags.append(f"cursor: {self.cursor}")
        tail = f" [{'; '.join(flags)}]" if flags else ""
        return f"{self.name} — {self.label} ({verbs}){tail}"


@cache
def load() -> dict[str, Resource]:
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    out: dict[str, Resource] = {}
    for name, entry in raw["resources"].items():
        out[name] = Resource(
            name=name,
            label=entry["label"],
            group=entry["group"],
            doc=entry["doc"],
            path_params=tuple(entry["path_params"]),
            deprecated=entry.get("deprecated", False),
            operations={
                verb: Operation(
                    verb=verb,
                    method=op["method"],
                    path=op["path"],
                    filters=tuple(op["filters"]),
                    required=tuple(op["required"]),
                    optional=tuple(op["optional"]),
                    envelope=op["envelope"],
                )
                for verb, op in entry["operations"].items()
            },
        )
    return out


def get(name: str) -> Resource:
    resources = load()
    if name in resources:
        return resources[name]
    proximos = [n for n in resources if name in n or n in name]
    hint = f" Você quis dizer: {', '.join(sorted(proximos)[:5])}?" if proximos else ""
    raise KeyError(f"recurso '{name}' não existe no catálogo.{hint}")


def operation(name: str, verb: str) -> tuple[Resource, Operation]:
    resource = get(name)
    if verb not in resource.operations:
        disponiveis = ", ".join(sorted(resource.operations))
        raise KeyError(
            f"'{name}' não suporta '{verb}'. Operações disponíveis: {disponiveis}"
        )
    return resource, resource.operations[verb]


def describe(name: str) -> dict:
    """Ficha completa de um recurso, para o modelo consultar antes de chamar."""
    resource = get(name)
    out: dict = {
        "recurso": resource.name,
        "descricao": resource.label,
        "grupo": GROUP_LABELS.get(resource.group, resource.group),
        "doc": resource.doc,
        "operacoes": {},
    }
    if resource.path_params:
        out["parametros_de_caminho"] = list(resource.path_params)
    if resource.deprecated:
        out["aviso"] = "Marcado como API obsoleta na documentação oficial."
    if resource.machine_op:
        out["aviso_operacao"] = (
            "Afeta estoque ou a máquina física; exige VMPAY_ALLOW_MACHINE_OPS=1."
        )
    if resource.cursor:
        out["ingestao_incremental"] = (
            f"Use o filtro {resource.cursor} para buscar só o que é novo. "
            "Quando ele é passado, start_date e end_date são ignorados pela API."
        )
    for verb, op in sorted(resource.operations.items()):
        detail: dict = {"http": f"{op.method} /api/v1/{op.path}"}
        if op.filters:
            detail["filtros"] = list(op.filters)
        if op.required:
            detail["campos_obrigatorios"] = list(op.required)
        if op.optional:
            detail["campos_opcionais"] = list(op.optional)
        if op.envelope:
            detail["envelope"] = (
                f"O corpo é enviado dentro da chave {op.envelope!r}: "
                f'{{"{op.envelope}": {{...}}}}. O cliente monta isso sozinho — '
                "passe apenas os campos."
            )
        out["operacoes"][verb] = detail
    return out
