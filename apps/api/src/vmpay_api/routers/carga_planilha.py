"""Carga do pick list por planilha: quando o QR do cupom não serve.

A planilha não lança nada sozinha — ela só enche o carrinho da carga manual,
onde o operador revisa e clica "Lançar carga" (o mesmo /picklist/manual, com
recibo e action_log). Aqui é só leitura: casar cada linha com um produto da
prateleira da loja e dizer o que não casou.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
import uuid
from collections import defaultdict
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import registrar
from ..auth import OrgContext, require_role
from ..db import get_session
from ..planilha import PlanilhaInvalida, linhas_do_csv, ler_numero
from . import stock as estoque

router = APIRouter(prefix="/orgs/{org}/picklist/planilha", tags=["pick list"])

Session = Annotated[AsyncSession, Depends(get_session)]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]

COLUNAS_MODELO = ["id", "produto", "codigo_barras", "saldo", "quantidade"]

#: Mais que isso numa linha é dedo na tecla (ou código de barras colado na
#: coluna errada).
QUANTIDADE_MAXIMA = Decimal("10000")

#: O carrinho da carga manual aceita até 500 produtos (ManualBody).
MAX_PRODUTOS = 500

#: Janela em que uma carga idêntica já lançada vira aviso de duplicidade.
DIAS_DUPLICIDADE = 7

PRODUTOS_DA_LOJA = """
select p.id, p.name, p.barcode, b.quantity
  from core.stock_balance b
  join core.product p on p.id = b.product_id
 where b.location_id = :location_id
 order by p.name
"""

# O Excel transforma 7896002110983 em "7,89600E+12" ao abrir o CSV: o código
# perdeu dígitos e não há como recuperar.
_NOTACAO_CIENTIFICA = re.compile(r"^\d+([.,]\d+)?[eE][+-]?\d+$")


def _nome_normalizado(nome: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return " ".join(sem_acento.upper().split())


def _codigo_normalizado(codigo: str) -> str:
    # EAN com zero à esquerda: o Excel come o zero; compara sem eles dos dois lados.
    return re.sub(r"\D", "", codigo).lstrip("0")


async def _produtos(session: AsyncSession, location_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = (await session.execute(text(PRODUTOS_DA_LOJA), {"location_id": str(location_id)})).mappings().all()
    return [dict(r) for r in rows]


@router.get("/modelo.csv")
async def modelo(ctx: AdminCtx, session: Session, location_id: Annotated[uuid.UUID, Query()]) -> Response:
    """Os produtos da prateleira da loja, com `quantidade` em branco."""
    await estoque._load_target(session, ctx.org_id, location_id)
    buffer = io.StringIO()
    buffer.write("﻿")  # sem BOM o Excel abre o UTF-8 como Latin-1
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(COLUNAS_MODELO)
    for p in await _produtos(session, location_id):
        saldo = f"{Decimal(str(p['quantity'])):f}"
        writer.writerow(
            [p["id"], p["name"], p["barcode"] or "", saldo.rstrip("0").rstrip(".") if "." in saldo else saldo, ""]
        )
    await registrar(session, ctx, "picklist.modelo_planilha", {"location_id": str(location_id)})
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="carga.csv"'},
    )


class LerBody(BaseModel):
    location_id: uuid.UUID
    conteudo: str = Field(max_length=2_000_000)


def _quantidade(bruto: str) -> Decimal:
    valor = ler_numero(bruto, casas=3, nome="quantidade")
    if valor <= 0:
        raise ValueError("quantidade tem de ser maior que zero")
    if valor > QUANTIDADE_MAXIMA:
        raise ValueError(f"quantidade {bruto.strip()} parece engano (código de barras na coluna errada?)")
    return valor


@router.post("/ler")
async def ler(body: LerBody, ctx: AdminCtx, session: Session) -> dict:
    """Casa as linhas com a prateleira da loja. Não lança nada."""
    await estoque._load_target(session, ctx.org_id, body.location_id)
    produtos = await _produtos(session, body.location_id)
    por_id = {str(p["id"]): p for p in produtos}
    por_codigo: dict[str, list[dict]] = defaultdict(list)
    por_nome: dict[str, list[dict]] = defaultdict(list)
    for p in produtos:
        if p["barcode"] and _codigo_normalizado(p["barcode"]):
            por_codigo[_codigo_normalizado(p["barcode"])].append(p)
        por_nome[_nome_normalizado(p["name"])].append(p)

    try:
        linhas = list(
            linhas_do_csv(body.conteudo, exige=("quantidade",), uma_de=("id", "codigo_barras", "produto"))
        )
    except PlanilhaInvalida as exc:
        raise HTTPException(422, str(exc)) from None

    somados: dict[str, Decimal] = defaultdict(Decimal)
    origem: dict[str, list[int]] = defaultdict(list)
    erros: list[dict[str, Any]] = []
    em_branco = 0
    for numero, campos in linhas:
        rotulo = campos.get("produto") or campos.get("codigo_barras") or None
        if not campos.get("quantidade"):
            em_branco += 1
            continue
        try:
            quantidade = _quantidade(campos["quantidade"])
        except ValueError as exc:
            erros.append({"linha": numero, "produto": rotulo, "motivo": str(exc)})
            continue

        produto, motivo = _casar(campos, por_id, por_codigo, por_nome)
        if produto is None:
            erros.append({"linha": numero, "produto": rotulo, "motivo": motivo})
            continue
        chave = str(produto["id"])
        somados[chave] += quantidade
        origem[chave].append(numero)

    if len(somados) > MAX_PRODUTOS:
        raise HTTPException(422, f"{len(somados)} produtos numa carga só; o limite é {MAX_PRODUTOS}")

    itens = [
        {
            "product_id": pid,
            "produto": por_id[pid]["name"],
            "quantidade": float(qtd),
            "linhas": origem[pid],
        }
        for pid, qtd in somados.items()
    ]
    return {
        "itens": itens,
        "erros": erros,
        "resumo": {"produtos": len(itens), "em_branco": em_branco, "erros": len(erros)},
        "carga_igual": await _carga_igual(session, ctx, body.location_id, somados),
    }


def _casar(
    campos: dict[str, str],
    por_id: dict[str, dict],
    por_codigo: dict[str, list[dict]],
    por_nome: dict[str, list[dict]],
) -> tuple[dict | None, str | None]:
    """id > código de barras > nome exato. Nunca adivinha entre dois."""
    bruto_id = campos.get("id", "")
    if bruto_id:
        try:
            uuid.UUID(bruto_id)
        except ValueError:
            return None, "coluna id alterada — o produto não pode ser identificado"
        produto = por_id.get(bruto_id.lower())
        return (produto, None) if produto else (None, "produto não está na prateleira desta loja")

    codigo = campos.get("codigo_barras", "")
    if codigo:
        if _NOTACAO_CIENTIFICA.match(codigo.replace(" ", "")):
            return None, (
                f"código '{codigo}' foi estragado pelo Excel (virou notação científica) — "
                "use a coluna id do modelo ou formate a coluna como texto"
            )
        achados = por_codigo.get(_codigo_normalizado(codigo), [])
        if len(achados) == 1:
            return achados[0], None
        if len(achados) > 1:
            return None, f"código {codigo} é de {len(achados)} produtos desta loja — use a coluna id"
        if not campos.get("produto"):
            return None, f"código {codigo} não está na prateleira desta loja"

    nome = campos.get("produto", "")
    if nome:
        achados = por_nome.get(_nome_normalizado(nome), [])
        if len(achados) == 1:
            return achados[0], None
        if len(achados) > 1:
            return None, "mais de um produto com esse nome nesta loja — use o código de barras ou a coluna id"
        return None, "nenhum produto da prateleira desta loja com esse nome (o nome tem de ser o do sistema)"
    return None, "linha sem id, código de barras nem produto"


async def _carga_igual(
    session: AsyncSession, ctx: OrgContext, location_id: uuid.UUID, somados: dict[str, Decimal]
) -> dict | None:
    """Carga manual idêntica (mesmos produtos, mesmas quantidades) lançada há pouco.

    Preço reaplicado não faz mal; carga reaplicada dobra o estoque. Subir a
    mesma planilha duas vezes é o erro mais provável deste fluxo.
    """
    if not somados:
        return None
    rows = (
        await session.execute(
            text(
                """
                select r.id, r.created_at, i.product_id, i.quantity
                  from core.purchase_receipt r
                  join core.purchase_receipt_item i on i.receipt_id = r.id
                 where r.org_id = :org_id and r.location_id = :location_id
                   and r.source = 'avulsa' and r.status <> 'error'
                   and r.created_at > now() - make_interval(days => :dias)
                """
            ),
            {"org_id": str(ctx.org_id), "location_id": str(location_id), "dias": DIAS_DUPLICIDADE},
        )
    ).mappings().all()
    por_recibo: dict[Any, dict[str, Decimal]] = defaultdict(dict)
    quando: dict[Any, Any] = {}
    for r in rows:
        por_recibo[r["id"]][str(r["product_id"])] = Decimal(str(r["quantity"]))
        quando[r["id"]] = r["created_at"]
    alvo = {pid: qtd.normalize() for pid, qtd in somados.items()}
    for recibo, itens in por_recibo.items():
        if {pid: q.normalize() for pid, q in itens.items()} == alvo:
            return {"receipt_id": str(recibo), "lancada_em": quando[recibo].isoformat()}
    return None
