"""Preço em lote: baixa a planilha da loja, sobe de volta, confere, aplica.

Três passos de propósito. A prévia não escreve nada — lê o planograma ao vivo
e diz linha a linha o que vai mudar; só a confirmação fala com a VMpay, numa
requisição só por loja (tudo ou nada: nunca meia prateleira com preço novo).
A confirmação reconfere contra o planograma do momento, porque entre a prévia
e o clique alguém pode ter mexido.
"""

from __future__ import annotations

import csv
import io
import uuid
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayError
from vmpay.redact import redact

from ..audit import registrar
from ..auth import OrgContext, require_role
from ..config import settings
from ..connector import LIMITE_ITENS_PLANOGRAMA, PlanogramView
from ..db import get_session
from ..planilha_precos import COLUNAS, PlanilhaInvalida, formatar_preco, ler_planilha
from . import stock as estoque

router = APIRouter(prefix="/orgs/{org}/stock/precos", tags=["preço em lote"])

Session = Annotated[AsyncSession, Depends(get_session)]
ViewerCtx = Annotated[OrgContext, Depends(require_role("viewer"))]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]

#: Variação que vira aviso na prévia: 699 no lugar de 6,99 passa no formato
#: e só a comparação com o preço de hoje pega.
VARIACAO_AVISO = Decimal("0.5")

#: O texto da planilha viaja como JSON; 2 MB é folga para milhares de linhas.
MAX_BYTES = 2_000_000

PRODUTOS_DA_LOJA = """
select p.id as product_id, p.name, p.barcode, b.quantity, b.canaleta,
       coalesce(b.price, p.unit_price) as preco, pl.external_id
  from core.stock_balance b
  join core.product p on p.id = b.product_id
  left join core.product_link pl
         on pl.product_id = p.id and pl.integration_id = :integration_id
 where b.location_id = :location_id
 order by p.name
"""


async def _produtos(session: AsyncSession, target: dict) -> list[dict]:
    rows = (
        await session.execute(
            text(PRODUTOS_DA_LOJA),
            {"location_id": str(target["location_id"]), "integration_id": str(target["integration_id"])},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def _planograma(target: dict, token: str) -> PlanogramView:
    try:
        connector = estoque.get_connector(target["config"], token)
        async with connector.client:
            return await connector.current_planogram(target["machine_id"], target["installation_id"])
    except VMpayError as exc:
        raise HTTPException(502, f"não deu para ler a prateleira na VMpay: {redact(str(exc))}") from None


def _preco_vmpay(item: dict) -> Decimal | None:
    valor = item.get("desired_price")
    return None if valor is None else Decimal(str(valor)).quantize(Decimal("0.01"))


# ------------------------------------------------------------------ planilha


@router.get("/planilha.csv")
async def planilha(
    ctx: ViewerCtx, session: Session, location_id: Annotated[uuid.UUID, Query()]
) -> Response:
    """A planilha de uma loja, com `preco_novo` em branco para preencher."""
    target = await estoque._load_target(session, ctx.org_id, location_id)
    produtos = await _produtos(session, target)
    buffer = io.StringIO()
    # BOM: sem ele o Excel abre o UTF-8 como Latin-1 e o acento vira "Ã§".
    buffer.write("﻿")
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(COLUNAS)
    for p in produtos:
        writer.writerow(
            [
                p["product_id"],
                target["name"],
                p.get("canaleta") or "",
                p["name"],
                p["barcode"] or "",
                f"{Decimal(str(p['quantity'])):f}".rstrip("0").rstrip("."),
                formatar_preco(p["preco"]),
                "",
            ]
        )
    await registrar(session, ctx, "precos.planilha", {"location_id": str(location_id), "linhas": len(produtos)})
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="precos.csv"'},
    )


# -------------------------------------------------------------------- prévia


class PreviaBody(BaseModel):
    location_id: uuid.UUID
    conteudo: str = Field(max_length=MAX_BYTES)


@router.post("/previa")
async def previa(body: PreviaBody, ctx: AdminCtx, session: Session) -> dict:
    """O que a planilha faria, sem fazer. Lê o planograma ao vivo."""
    try:
        linhas = ler_planilha(body.conteudo)
    except PlanilhaInvalida as exc:
        raise HTTPException(422, str(exc)) from None

    target = await estoque._load_target(session, ctx.org_id, body.location_id)
    produtos = {p["product_id"]: p for p in await _produtos(session, target)}

    contagem: dict[uuid.UUID, int] = {}
    for linha in linhas:
        if linha.product_id is not None and linha.preco_novo is not None:
            contagem[linha.product_id] = contagem.get(linha.product_id, 0) + 1

    preenchidas = [ln for ln in linhas if ln.erro is None and ln.preco_novo is not None]
    view: PlanogramView | None = None
    if preenchidas:
        token = await estoque._token_ou_502(session, target["config"])
        view = await _planograma(target, token)

    alterar: list[dict[str, Any]] = []
    erros: list[dict[str, Any]] = []
    iguais = em_branco = 0
    for linha in linhas:
        nome = linha.produto
        if linha.erro is None and linha.preco_novo is None:
            em_branco += 1
            continue
        produto = produtos.get(linha.product_id) if linha.product_id else None
        motivo = linha.erro
        if motivo is None and linha.loja and linha.loja != target["name"]:
            motivo = f"a linha é da loja {linha.loja}, não desta — baixe a planilha desta loja"
        if motivo is None and produto is None:
            motivo = "produto não está nesta loja"
        if motivo is None and contagem.get(linha.product_id, 0) > 1:
            motivo = "o mesmo produto aparece em mais de uma linha com preço novo"
        item = None
        if motivo is None:
            nome = produto["name"]
            good_id = int(produto["external_id"]) if produto["external_id"] is not None else None
            item = view.items_by_good.get(good_id) if (view and good_id is not None) else None
            if item is None:
                motivo = "não está na prateleira desta loja na VMpay"
        if motivo is not None:
            erros.append({"linha": linha.linha, "produto": nome, "motivo": motivo})
            continue

        atual = _preco_vmpay(item)
        if atual == linha.preco_novo and not item.get("use_default_price_product"):
            iguais += 1
            continue
        avisos = []
        if atual and abs(linha.preco_novo - atual) / atual > VARIACAO_AVISO:
            avisos.append(f"variação de {int((linha.preco_novo / atual - 1) * 100):+d}% — confira")
        if item.get("use_default_price_product"):
            avisos.append("usava o preço padrão do produto; passa a usar este")
        if item.get("status") and item["status"] != "active":
            avisos.append("item inativo ou suspenso na VMpay")
        if item.get("promotional_price"):
            avisos.append(
                f"tem preço promocional de R$ {formatar_preco(item['promotional_price'])} — "
                "o cliente continua pagando o promocional"
            )
        alterar.append(
            {
                "linha": linha.linha,
                "product_id": str(linha.product_id),
                "produto": nome,
                "preco_atual": float(atual) if atual is not None else None,
                "preco_novo": float(linha.preco_novo),
                "avisos": avisos,
            }
        )

    return {
        "location_id": str(body.location_id),
        "loja": target["name"],
        "alterar": alterar,
        "erros": erros,
        "resumo": {
            "alterar": len(alterar),
            "iguais": iguais,
            "em_branco": em_branco,
            "erros": len(erros),
        },
        # A prévia funciona com a escrita travada; a tela avisa antes do clique.
        "escrita_liberada": settings().vmpay_allow_writes,
    }


# ------------------------------------------------------------------- aplicar


class ItemPreco(BaseModel):
    product_id: uuid.UUID
    preco: Decimal = Field(gt=0)

    @field_validator("preco")
    @classmethod
    def _2_casas(cls, v: Decimal) -> Decimal:
        return v.quantize(Decimal("0.01"))


class AplicarBody(BaseModel):
    location_id: uuid.UUID
    itens: list[ItemPreco] = Field(min_length=1, max_length=LIMITE_ITENS_PLANOGRAMA)


@router.post("/aplicar")
async def aplicar(body: AplicarBody, ctx: AdminCtx, session: Session) -> dict:
    """Aplica os preços da prévia numa requisição só à VMpay."""
    estoque.require_writes_enabled()
    ids = [i.product_id for i in body.itens]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "o mesmo produto veio mais de uma vez")
    target = await estoque._load_target(session, ctx.org_id, body.location_id)
    externals = await estoque._external_ids(session, target["integration_id"], ids)
    faltando = [str(p) for p in ids if p not in externals]
    if faltando:
        raise HTTPException(422, f"produtos sem vínculo com a conta VMpay da loja: {', '.join(faltando)}")
    token = await estoque._token_ou_502(session, target["config"])

    view = await _planograma(target, token)
    fora = [str(p) for p in ids if externals[p] not in view.items_by_good]
    if fora:
        raise HTTPException(
            409,
            f"{len(fora)} produto(s) saíram da prateleira desde a prévia — confira a planilha de novo",
        )
    # Reaplicar a mesma planilha não pode virar escrita: o que já está com o
    # preço pedido sai da lista (clique duplo, reenvio, prévia velha).
    mudancas = [
        i
        for i in body.itens
        if _preco_vmpay(view.items_by_good[externals[i.product_id]]) != i.preco
        or view.items_by_good[externals[i.product_id]].get("use_default_price_product")
    ]
    if not mudancas:
        return {"action_id": None, "status": "sem_mudancas", "aplicados": 0}

    de = {i.product_id: _preco_vmpay(view.items_by_good[externals[i.product_id]]) for i in mudancas}
    action_id = await estoque._open_action(
        session,
        ctx,
        "stock.price_batch",
        {"location_id": str(body.location_id), "machine_id": target["machine_id"]},
        {
            "itens": [
                {
                    "product_id": str(i.product_id),
                    "de": float(de[i.product_id]) if de[i.product_id] is not None else None,
                    "para": float(i.preco),
                }
                for i in mudancas
            ]
        },
    )
    try:
        connector = estoque.get_connector(target["config"], token)
        async with connector.client:
            await connector.set_price(
                target["machine_id"],
                target["installation_id"],
                [(externals[i.product_id], float(i.preco)) for i in mudancas],
                view=view,
            )
    except VMpayError as exc:
        detail = redact(str(exc))
        await estoque._close_action(session, action_id, error=detail)
        raise HTTPException(502, f"a VMpay recusou os preços (nenhum foi alterado): {detail}") from None

    # Só o preço DESTA loja: o mesmo produto pode custar outro valor em outra.
    for i in mudancas:
        await session.execute(
            text(
                """
                update core.stock_balance set price = :price, updated_at = now()
                 where location_id = :location_id and product_id = :product_id
                """
            ),
            {"price": i.preco, "location_id": str(body.location_id), "product_id": str(i.product_id)},
        )
    await estoque._close_action(session, action_id)
    return {"action_id": action_id, "status": "success", "aplicados": len(mudancas)}
