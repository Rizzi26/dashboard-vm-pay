"""Servidor MCP da API VMpay.

São ~160 operações na API. Expor uma tool por operação afogaria o modelo, então
a superfície aqui é pequena e genérica — list/get/create/update/delete/action —
e o que ele não sabe (quais recursos existem, quais filtros cada um aceita, se o
corpo vai dentro de um envelope) vem do catálogo, consultável por tool.

Rodar:
    VMPAY_TOKEN=... uv run vmpay-mcp
"""

from __future__ import annotations

import logging
import os
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations
from vmpay import VMpayClient, VMpayError
from vmpay.redact import redact

from . import catalog
from .config import Settings

log = logging.getLogger("vmpay_mcp")

settings = Settings.from_env()
mcp = MCPServer("vmpay", version="0.1.0")

SOMENTE_LEITURA = ToolAnnotations(read_only_hint=True, open_world_hint=True)
ESCRITA = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=True)
DESTRUTIVO = ToolAnnotations(read_only_hint=False, destructive_hint=True, open_world_hint=True)

_client: VMpayClient | None = None

PAGING = {"page", "per_page"}
MAX_LIMIT = 5000


def client() -> VMpayClient:
    global _client
    if _client is None:
        _client = VMpayClient.from_env(base_url=settings.base_url)
    return _client


def build_path(resource: catalog.Resource, template: str, path_params: dict, id_: Any = None) -> str:
    """Preenche {machine_id}, {installation_id}, {id} no caminho da operação."""
    values = {k: v for k, v in (path_params or {}).items() if v is not None}
    if id_ is not None:
        values["id"] = id_
    faltando = [
        name
        for name in _placeholders(template)
        if name not in values or values[name] in ("", None)
    ]
    if faltando:
        raise ValueError(
            f"faltam parâmetros de caminho para '{resource.name}': {', '.join(faltando)}. "
            f"Este recurso vive sob {', '.join(resource.path_params) or 'a raiz'}."
        )
    out = template
    for name, value in values.items():
        out = out.replace(f"{{{name}}}", str(value))
    return out


def _placeholders(template: str) -> list[str]:
    import re

    return re.findall(r"\{(\w+)\}", template)


def unknown_filters(op: catalog.Operation, filtros: dict) -> list[str]:
    """Filtros que a doc não menciona.

    Devolvidos como aviso, não como erro: a extração do catálogo é boa mas não é
    perfeita, e bloquear um filtro legítimo é pior que informar um suspeito.
    """
    if not op.filters:
        return []
    return sorted(set(filtros) - set(op.filters) - PAGING)


def wrap_body(op: catalog.Operation, dados: dict) -> dict:
    """A API espera o corpo dentro de um envelope: {"product": {...}}."""
    if op.envelope and set(dados) != {op.envelope}:
        return {op.envelope: dados}
    return dados


def check_required(op: catalog.Operation, dados: dict) -> None:
    faltando = [f for f in op.required if f not in dados]
    if faltando:
        raise ValueError(
            f"campos obrigatórios faltando: {', '.join(faltando)}. "
            f"Obrigatórios: {', '.join(op.required)}."
        )


def guard_confirmation(alvo: Any, confirmar: str, acao: str) -> None:
    """Exige que o chamador repita o identificador do alvo.

    Vale para o que a API não desfaz. Não é burocracia: força o modelo a
    reafirmar em qual registro vai mexer, o que transforma um id errado numa
    recusa em vez de num estrago.
    """
    if str(confirmar).strip() != str(alvo):
        raise ValueError(
            f"confirmação não confere: para {acao} é preciso passar confirmar='{alvo}'. "
            f"Recebi '{confirmar}'."
        )


def erro(exc: Exception) -> dict:
    """Mensagem de erro limpa — e sem token dentro."""
    if isinstance(exc, VMpayError):
        return {
            "erro": redact(str(exc)),
            "status_http": exc.status,
            "corpo": redact(exc.body or ""),
        }
    return {"erro": redact(str(exc))}


# --------------------------------------------------------------------- leitura


@mcp.tool(annotations=SOMENTE_LEITURA)
def vmpay_catalog(grupo: str | None = None, busca: str | None = None) -> dict:
    """Lista os recursos disponíveis na API VMpay.

    Comece por aqui quando não souber o nome do recurso. `grupo` filtra por
    cadastro, relatorio, dominio ou inventario. `busca` casa por nome ou rótulo.
    """
    recursos = catalog.load().values()
    if grupo:
        recursos = [r for r in recursos if r.group == grupo]
    if busca:
        termo = busca.lower()
        recursos = [r for r in recursos if termo in r.name.lower() or termo in r.label.lower()]
    por_grupo: dict[str, list[str]] = {}
    for r in sorted(recursos, key=lambda r: (r.group, r.name)):
        por_grupo.setdefault(catalog.GROUP_LABELS.get(r.group, r.group), []).append(r.summary())
    return {
        "modo": settings.status(),
        "ambiente": settings.base_url,
        "recursos": por_grupo,
        "dica": "vmpay_describe(recurso) mostra filtros, campos e envelope de cada operação.",
    }


@mcp.tool(annotations=SOMENTE_LEITURA)
def vmpay_describe(recurso: str) -> dict:
    """Detalha um recurso: operações, filtros, campos obrigatórios e envelope do corpo.

    Consulte antes de criar ou atualizar — evita um 422 por campo faltando.
    """
    try:
        return catalog.describe(recurso)
    except KeyError as exc:
        return erro(exc)


@mcp.tool(annotations=SOMENTE_LEITURA)
async def vmpay_list(
    recurso: str,
    filtros: dict[str, Any] | None = None,
    caminho: dict[str, Any] | None = None,
    limite: int = 100,
) -> dict:
    """Lista registros de um recurso, já paginando por baixo.

    `filtros` é a query string (veja vmpay_describe). `caminho` preenche recursos
    aninhados, ex.: {"machine_id": 49, "installation_id": 857}. `limite` corta o
    resultado — a API não agrega nada, então pedir tudo de um relatório grande é
    caro e provavelmente não é o que você quer.

    Para ingestão incremental de vendas, prefira o filtro de cursor
    (transaction_id_greater_than em cashless_facts, vend_id_greater_than em vends)
    em vez de janela de data.
    """
    try:
        resource, op = catalog.operation(recurso, "list")
        filtros = dict(filtros or {})
        avisos = []
        desconhecidos = unknown_filters(op, filtros)
        if desconhecidos:
            avisos.append(
                f"a doc não menciona estes filtros para {recurso}: {', '.join(desconhecidos)} — "
                "foram enviados mesmo assim"
            )
        limite = max(1, min(limite, MAX_LIMIT))
        path = build_path(resource, op.path, caminho or {})

        registros: list[dict] = []
        per_page = min(limite, 1000)
        async for registro in client().paginate(path, per_page=per_page, **filtros):
            registros.append(registro)
            if len(registros) >= limite:
                avisos.append(f"resultado cortado em {limite}; aumente `limite` para ver mais")
                break
        saida: dict[str, Any] = {"recurso": recurso, "total": len(registros), "registros": registros}
        if resource.cursor and registros:
            maior = max(int(r["id"]) for r in registros if "id" in r)
            saida["proximo_cursor"] = {resource.cursor: maior}
        if avisos:
            saida["avisos"] = avisos
        return saida
    except (KeyError, ValueError, VMpayError) as exc:
        return erro(exc)


@mcp.tool(annotations=SOMENTE_LEITURA)
async def vmpay_get(recurso: str, id: Any, caminho: dict[str, Any] | None = None) -> dict:
    """Busca um registro pelo id."""
    try:
        resource, op = catalog.operation(recurso, "get")
        path = build_path(resource, op.path, caminho or {}, id)
        return {"recurso": recurso, "registro": await client().get(path)}
    except (KeyError, ValueError, VMpayError) as exc:
        return erro(exc)


# ---------------------------------------------------------------------- escrita
#
# Definidas no nível do módulo para serem testáveis; o registro é que é
# condicional. Uma tool não registrada não aparece na lista para o modelo, o que
# é mais eficaz que registrar e recusar depois.


async def vmpay_create(
    recurso: str, dados: dict[str, Any], caminho: dict[str, Any] | None = None
) -> dict:
    """Cria um registro. Passe só os campos — o envelope do corpo é montado aqui."""
    try:
        resource, op = catalog.operation(recurso, "create")
        require_machine_ops(resource)
        check_required(op, dados)
        path = build_path(resource, op.path, caminho or {})
        return {"recurso": recurso, "criado": await client().post(path, json=wrap_body(op, dados))}
    except (KeyError, ValueError, PermissionError, VMpayError) as exc:
        return erro(exc)


async def vmpay_update(
    recurso: str, id: Any, dados: dict[str, Any], caminho: dict[str, Any] | None = None
) -> dict:
    """Atualiza um registro existente (PATCH — envie só o que muda)."""
    try:
        resource, op = catalog.operation(recurso, "update")
        require_machine_ops(resource)
        path = build_path(resource, op.path, caminho or {}, id)
        return {
            "recurso": recurso,
            "atualizado": await client().patch(path, json=wrap_body(op, dados)),
        }
    except (KeyError, ValueError, PermissionError, VMpayError) as exc:
        return erro(exc)


async def vmpay_delete(
    recurso: str, id: Any, confirmar: str, caminho: dict[str, Any] | None = None
) -> dict:
    """Exclui um registro. Irreversível pela API.

    `confirmar` tem que repetir exatamente o id que será excluído.
    """
    try:
        resource, op = catalog.operation(recurso, "delete")
        require_machine_ops(resource)
        guard_confirmation(id, confirmar, f"excluir {recurso} {id}")
        path = build_path(resource, op.path, caminho or {}, id)
        await client().delete(path)
        return {"recurso": recurso, "excluido": id}
    except (KeyError, ValueError, PermissionError, VMpayError) as exc:
        return erro(exc)


async def vmpay_action(
    recurso: str,
    acao: str,
    id: Any = None,
    dados: dict[str, Any] | None = None,
    caminho: dict[str, Any] | None = None,
) -> dict:
    """Executa uma ação nomeada — reactivate, complete, undo_complete, restock…

    Os nomes aparecem em vmpay_describe como "action:<nome>".
    """
    try:
        resource, op = catalog.operation(recurso, f"action:{acao}")
        require_machine_ops(resource)
        path = build_path(resource, op.path, caminho or {}, id)
        body = wrap_body(op, dados) if dados else None
        metodo = client().post if op.method == "POST" else client().patch
        return {"recurso": recurso, "acao": acao, "resultado": await metodo(path, json=body)}
    except (KeyError, ValueError, PermissionError, VMpayError) as exc:
        return erro(exc)


async def vmpay_remote_command(
    machine_id: Any,
    installation_id: Any,
    kind: str,
    confirmar: str,
    user_input: Any = None,
) -> dict:
    """Envia um comando remoto para uma máquina física.

    Isto atinge equipamento em campo. `confirmar` tem que repetir o
    installation_id. Consulte vmpay_describe('remote_commands') para os valores
    válidos de `kind`.
    """
    try:
        resource, op = catalog.operation("remote_commands", "create")
        require_machine_ops(resource)
        guard_confirmation(
            installation_id, confirmar, f"enviar '{kind}' à instalação {installation_id}"
        )
        path = build_path(
            resource, op.path, {"machine_id": machine_id, "installation_id": installation_id}
        )
        corpo: dict[str, Any] = {"kind": kind}
        if user_input is not None:
            corpo["user_input"] = user_input
        return {
            "enviado": await client().post(path, json=wrap_body(op, corpo)),
            "aviso": "comando despachado para a máquina física",
        }
    except (KeyError, ValueError, PermissionError, VMpayError) as exc:
        return erro(exc)


def register_write_tools() -> None:
    """Cadastros e planogramas — só com VMPAY_ALLOW_WRITES=1."""
    mcp.tool(annotations=ESCRITA)(vmpay_create)
    mcp.tool(annotations=ESCRITA)(vmpay_update)
    mcp.tool(annotations=DESTRUTIVO)(vmpay_delete)
    mcp.tool(annotations=ESCRITA)(vmpay_action)


def register_machine_tools() -> None:
    """Operação em máquina física — só com VMPAY_ALLOW_MACHINE_OPS=1."""
    mcp.tool(annotations=DESTRUTIVO)(vmpay_remote_command)


def require_machine_ops(resource: catalog.Resource) -> None:
    if resource.machine_op and not settings.machine_ops_enabled:
        raise PermissionError(
            f"'{resource.name}' afeta estoque ou a máquina física e exige "
            "VMPAY_ALLOW_MACHINE_OPS=1 além de VMPAY_ALLOW_WRITES=1. "
            "Peça ao operador humano para ligar."
        )


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("VMPAY_LOG_LEVEL", "INFO"),
        format="%(levelname)s %(name)s %(message)s",
    )
    if settings.allow_writes and not settings.base_explicit:
        log.warning(
            "VMPAY_ALLOW_WRITES está ligado mas VMPAY_BASE não foi declarado; "
            "subindo somente-leitura. Declare a URL do ambiente (homologação ou "
            "produção) para liberar escrita."
        )
    if settings.writes_enabled:
        register_write_tools()
    if settings.machine_ops_enabled:
        register_machine_tools()
    log.info("vmpay-mcp em %s — modo: %s", settings.base_url, settings.status())
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
