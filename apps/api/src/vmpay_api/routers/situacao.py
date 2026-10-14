"""Tirar produto de linha (ou reativar) em lote, pela planilha da loja.

A VMpay não apaga item de planograma. Tirar de linha é mudar a situação:
- suspenso: as unidades que estão na loja ainda vendem, mas não se repõe;
- inativo: para de vender na hora.
O painel tira os dois da Reposição e da contagem de zerados.
"""

from __future__ import annotations

import csv
import io
import unicodedata
import uuid
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayError
from vmpay.redact import redact

from ..auth import OrgContext, require_role
from ..config import settings
from ..connector import LIMITE_ITENS_PLANOGRAMA, PlanogramView
from ..db import get_session
from ..planilha import PlanilhaInvalida, linhas_do_csv
from . import stock as estoque

router = APIRouter(prefix="/orgs/{org}/stock/situacao", tags=["situação"])

Session = Annotated[AsyncSession, Depends(get_session)]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]

Situacao = Literal["active", "suspended", "inactive"]

COLUNAS = ["id", "produto", "codigo_barras", "saldo", "situacao_atual", "nova_situacao"]

NOMES: dict[str, str] = {"active": "ativo", "suspended": "suspenso", "inactive": "inativo"}

#: O que o operador escreve na planilha -> situação da VMpay.
SINONIMOS: dict[str, str] = {
    "ATIVO": "active", "ATIVAR": "active", "REATIVAR": "active",
    "SUSPENSO": "suspended", "SUSPENDER": "suspended",
    "INATIVO": "inactive", "INATIVAR": "inactive",
}

PRODUTOS_DA_LOJA = """
select p.id as product_id, p.name, p.barcode, b.quantity, pl.external_id
  from core.stock_balance b
  join core.product p on p.id = b.product_id
  left join core.product_link pl
         on pl.product_id = p.id and pl.integration_id = :integration_id
 where b.location_id = :location_id
 order by p.name
"""


def _situacao(bruto: str) -> str:
    chave = unicodedata.normalize("NFKD", bruto).encode("ascii", "ignore").decode().strip().upper()
    if chave not in SINONIMOS:
        raise ValueError(f"situação '{bruto}' não existe — use ativo, suspenso ou inativo")
    return SINONIMOS[chave]


def _status_do(view: PlanogramView, good_id: int) -> str:
    """Ativo em qualquer posição = ativo (mesma regra do snapshot)."""
    status = {i.get("status") for i in view.items if i["good_id"] == good_id}
    return "active" if "active" in status else (status.pop() if status else "active")


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


@router.get("/modelo.csv")
async def modelo(ctx: AdminCtx, session: Session, location_id: Annotated[uuid.UUID, Query()]) -> Response:
    """A loja com a situação de cada produto (do último snapshot) e `nova_situacao` em branco."""
    target = await estoque._load_target(session, ctx.org_id, location_id)
    situacoes = {
        str(r["product_id"]): r["planogram_status"]
        for r in (
            await session.execute(
                text("select product_id, planogram_status from core.stock_balance where location_id = :l"),
                {"l": str(location_id)},
            )
        ).mappings().all()
    }
    buffer = io.StringIO()
    buffer.write("﻿")
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(COLUNAS)
    for p in await _produtos(session, target):
        saldo = f"{Decimal(str(p['quantity'])):f}"
        writer.writerow(
            [
                p["product_id"],
                p["name"],
                p["barcode"] or "",
                saldo.rstrip("0").rstrip(".") if "." in saldo else saldo,
                NOMES.get(situacoes.get(str(p["product_id"])) or "active", "ativo"),
                "",
            ]
        )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="situacao.csv"'},
    )


class PreviaBody(BaseModel):
    location_id: uuid.UUID
    conteudo: str = Field(max_length=2_000_000)


@router.post("/previa")
async def previa(body: PreviaBody, ctx: AdminCtx, session: Session) -> dict:
    """O que muda de situação, contra o planograma ao vivo. Não escreve nada."""
    try:
        linhas = list(linhas_do_csv(body.conteudo, exige=("id", "nova_situacao")))
    except PlanilhaInvalida as exc:
        raise HTTPException(422, str(exc)) from None
    target = await estoque._load_target(session, ctx.org_id, body.location_id)
    produtos = {str(p["product_id"]): p for p in await _produtos(session, target)}
    token = await estoque._token_ou_502(session, target["config"])
    await session.commit()
    view = await _planograma(target, token)

    contagem: dict[str, int] = {}
    for _, campos in linhas:
        if campos["nova_situacao"]:
            contagem[campos["id"].lower()] = contagem.get(campos["id"].lower(), 0) + 1

    mudar: list[dict[str, Any]] = []
    erros: list[dict[str, Any]] = []
    iguais = em_branco = 0
    for numero, campos in linhas:
        if not campos["nova_situacao"]:
            em_branco += 1
            continue
        produto = produtos.get(campos["id"].lower())
        nome = produto["name"] if produto else (campos.get("produto") or None)
        try:
            nova = _situacao(campos["nova_situacao"])
        except ValueError as exc:
            erros.append({"linha": numero, "produto": nome, "motivo": str(exc)})
            continue
        if produto is None:
            erros.append({"linha": numero, "produto": nome, "motivo": "produto não está nesta loja (coluna id alterada?)"})
            continue
        if contagem[campos["id"].lower()] > 1:
            erros.append({"linha": numero, "produto": nome, "motivo": "o mesmo produto em mais de uma linha"})
            continue
        good_id = int(produto["external_id"]) if produto["external_id"] is not None else None
        if good_id is None or good_id not in view.items_by_good:
            erros.append({"linha": numero, "produto": nome, "motivo": "não está na prateleira desta loja na VMpay"})
            continue
        atual = _status_do(view, good_id)
        if atual == nova:
            iguais += 1
            continue
        saldo = Decimal(str(view.items_by_good[good_id].get("current_balance") or 0))
        avisos = []
        if nova == "inactive" and saldo > 0:
            avisos.append(
                f"tem {saldo.normalize():f} un. na loja que param de vender na hora — "
                "suspenso deixa vender o que sobrou"
            )
        mudar.append(
            {
                "linha": numero,
                "product_id": str(produto["product_id"]),
                "produto": nome,
                "de": atual,
                "para": nova,
                "saldo": float(saldo),
                "avisos": avisos,
            }
        )
    return {
        "loja": target["name"],
        "mudar": mudar,
        "erros": erros,
        "resumo": {"mudar": len(mudar), "iguais": iguais, "em_branco": em_branco, "erros": len(erros)},
        "escrita_liberada": settings().vmpay_allow_writes,
    }


class ItemSituacao(BaseModel):
    product_id: uuid.UUID
    situacao: Situacao


class AplicarBody(BaseModel):
    location_id: uuid.UUID
    itens: list[ItemSituacao] = Field(min_length=1, max_length=LIMITE_ITENS_PLANOGRAMA)


@router.post("/aplicar")
async def aplicar(body: AplicarBody, ctx: AdminCtx, session: Session) -> dict:
    """Muda a situação no planograma da loja num PATCH só (tudo ou nada)."""
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
    await session.commit()
    view = await _planograma(target, token)
    fora = [str(p) for p in ids if externals[p] not in view.items_by_good]
    if fora:
        raise HTTPException(409, f"{len(fora)} produto(s) saíram da prateleira desde a prévia — confira de novo")
    mudancas = [i for i in body.itens if _status_do(view, externals[i.product_id]) != i.situacao]
    if not mudancas:
        return {"action_id": None, "status": "sem_mudancas", "alterados": 0}

    action_id = await estoque._open_action(
        session,
        ctx,
        "stock.status_batch",
        {"location_id": str(body.location_id), "machine_id": target["machine_id"]},
        {
            "itens": [
                {"product_id": str(i.product_id), "de": _status_do(view, externals[i.product_id]), "para": i.situacao}
                for i in mudancas
            ]
        },
    )
    try:
        connector = estoque.get_connector(target["config"], token)
        async with connector.client:
            await connector.set_status(
                target["machine_id"],
                target["installation_id"],
                [(externals[i.product_id], i.situacao) for i in mudancas],
                view=view,
            )
    except VMpayError as exc:
        detail = redact(str(exc))
        await estoque._close_action(session, action_id, error=detail)
        raise HTTPException(502, f"a VMpay recusou (nenhuma situação mudou): {detail}") from None

    for i in mudancas:
        await session.execute(
            text(
                """
                update core.stock_balance set planogram_status = :status, updated_at = now()
                 where location_id = :location_id and product_id = :product_id
                """
            ),
            {"status": i.situacao, "location_id": str(body.location_id), "product_id": str(i.product_id)},
        )
    await estoque._close_action(session, action_id)
    return {
        "action_id": action_id,
        "status": "success",
        "alterados": len(mudancas),
        "por_situacao": {s: sum(1 for i in mudancas if i.situacao == s) for s in ("active", "suspended", "inactive")},
    }
