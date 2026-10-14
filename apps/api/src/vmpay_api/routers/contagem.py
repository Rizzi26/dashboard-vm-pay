"""Contagem de inventário: o operador conta a loja e o saldo vira o contado.

A diferença entre o sistema e a contagem é perda (furto, vencido, quebra) ou
sobra (carga não lançada) — fica registrada como movimento `adjustment`,
com sinal. Linha em branco é produto NÃO contado: não vira zero.

Contar leva tempo e a loja vende enquanto isso. O saldo do sistema na hora
da contagem é o saldo de agora MAIS o que vendeu desde então; e o que vai
para a VMpay é o contado MENOS essas vendas — senão toda venda feita
durante a contagem apareceria como perda. As vendas vêm da ingestão (de
hora em hora), então contagem antiga demais é recusada.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Any

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
from ..ingest import vendas_em_dia
from ..planilha import PlanilhaInvalida, linhas_do_csv, ler_numero
from . import stock as estoque

router = APIRouter(prefix="/orgs/{org}/stock/contagem", tags=["contagem"])

Session = Annotated[AsyncSession, Depends(get_session)]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]

COLUNAS = ["id", "produto", "codigo_barras", "saldo_sistema", "contado"]

#: Contagem mais antiga que isso não se compensa com segurança: entre ela e
#: agora pode ter havido carga, e carga não se desconta como venda.
MAX_IDADE_CONTAGEM = timedelta(hours=24)

#: Diferença que vira aviso para conferir a linha antes de aplicar.
DIFERENCA_AVISO = Decimal("10")

PRODUTOS_DA_LOJA = """
select p.id as product_id, p.name, p.barcode, b.quantity, pl.external_id
  from core.stock_balance b
  join core.product p on p.id = b.product_id
  left join core.product_link pl
         on pl.product_id = p.id and pl.integration_id = :integration_id
 where b.location_id = :location_id
 order by p.name
"""

VENDAS_DESDE = """
select v.good_id, sum(coalesce(v.quantity, 1)) as unidades
  from vmpay.vend v
 where v.machine_id = :machine_id and v.occurred_at > :desde
 group by v.good_id
"""


def _num(valor: Any) -> Decimal:
    return Decimal(str(valor or 0))


def _texto(valor: Decimal) -> str:
    texto = f"{valor:f}"
    return texto.rstrip("0").rstrip(".") if "." in texto else texto


async def _produtos(session: AsyncSession, target: dict) -> list[dict]:
    rows = (
        await session.execute(
            text(PRODUTOS_DA_LOJA),
            {"location_id": str(target["location_id"]), "integration_id": str(target["integration_id"])},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def _atualizar_vendas(target: dict, token: str) -> bool:
    """Vendas até agora antes de descontar — a ingestão de hora em hora pode
    não ter trazido a venda de 10 minutos atrás, e ela viraria sobra falsa."""
    try:
        return await vendas_em_dia(target["integration_id"], token)
    except Exception:  # noqa: BLE001 — sem vendas frescas, segue com a última rodada e avisa
        return False


async def _vendas_desde(session: AsyncSession, target: dict, desde: datetime) -> dict[int, Decimal]:
    rows = (
        await session.execute(text(VENDAS_DESDE), {"machine_id": target["machine_id"], "desde": desde})
    ).mappings().all()
    return {int(r["good_id"]): _num(r["unidades"]) for r in rows}


def _quando(contado_em: datetime | None) -> datetime:
    agora = datetime.now(timezone.utc)
    if contado_em is None:
        return agora
    if contado_em.tzinfo is None:
        raise HTTPException(422, "contado_em precisa de fuso horário")
    if contado_em > agora + timedelta(minutes=5):
        raise HTTPException(422, "a contagem não pode ser no futuro")
    if agora - contado_em > MAX_IDADE_CONTAGEM:
        raise HTTPException(
            422, "contagem com mais de 24 h: entre ela e agora pode ter entrado carga — conte de novo"
        )
    return contado_em


async def _planograma(target: dict, token: str) -> PlanogramView:
    try:
        connector = estoque.get_connector(target["config"], token)
        async with connector.client:
            return await connector.current_planogram(target["machine_id"], target["installation_id"])
    except VMpayError as exc:
        raise HTTPException(502, f"não deu para ler a prateleira na VMpay: {redact(str(exc))}") from None


@router.get("/modelo.csv")
async def modelo(ctx: AdminCtx, session: Session, location_id: Annotated[uuid.UUID, Query()]) -> Response:
    """Os produtos da loja com o saldo do sistema e `contado` em branco."""
    target = await estoque._load_target(session, ctx.org_id, location_id)
    buffer = io.StringIO()
    buffer.write("﻿")
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(COLUNAS)
    for p in await _produtos(session, target):
        writer.writerow([p["product_id"], p["name"], p["barcode"] or "", _texto(_num(p["quantity"])), ""])
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="contagem.csv"'},
    )


class PreviaBody(BaseModel):
    location_id: uuid.UUID
    conteudo: str = Field(max_length=2_000_000)
    contado_em: datetime | None = None


@router.post("/previa")
async def previa(body: PreviaBody, ctx: AdminCtx, session: Session) -> dict:
    """Sistema × contado, produto a produto. Não escreve nada."""
    quando = _quando(body.contado_em)
    try:
        linhas = list(linhas_do_csv(body.conteudo, exige=("id", "contado")))
    except PlanilhaInvalida as exc:
        raise HTTPException(422, str(exc)) from None

    target = await estoque._load_target(session, ctx.org_id, body.location_id)
    produtos = {str(p["product_id"]): p for p in await _produtos(session, target)}
    token = await estoque._token_ou_502(session, target["config"])
    await session.commit()
    vendas_frescas = await _atualizar_vendas(target, token)
    vendas = await _vendas_desde(session, target, quando)
    view = await _planograma(target, token)

    vistos: dict[str, int] = {}
    for numero, campos in linhas:
        if campos["contado"]:
            vistos[campos["id"].lower()] = vistos.get(campos["id"].lower(), 0) + 1

    diferencas: list[dict[str, Any]] = []
    erros: list[dict[str, Any]] = []
    conferem = nao_contados = 0
    for numero, campos in linhas:
        nome = campos.get("produto") or None
        if not campos["contado"]:
            nao_contados += 1
            continue
        produto = produtos.get(campos["id"].lower())
        if produto is None:
            erros.append({"linha": numero, "produto": nome, "motivo": "produto não está nesta loja (coluna id alterada?)"})
            continue
        if vistos[campos["id"].lower()] > 1:
            erros.append({"linha": numero, "produto": produto["name"], "motivo": "o mesmo produto contado em mais de uma linha"})
            continue
        try:
            contado = ler_numero(campos["contado"], casas=3, nome="contado")
        except ValueError as exc:
            erros.append({"linha": numero, "produto": produto["name"], "motivo": str(exc)})
            continue
        if contado < 0:
            erros.append({"linha": numero, "produto": produto["name"], "motivo": "contado não pode ser negativo"})
            continue
        good_id = int(produto["external_id"]) if produto["external_id"] is not None else None
        item = view.items_by_good.get(good_id) if good_id is not None else None
        if item is None:
            erros.append({"linha": numero, "produto": produto["name"], "motivo": "não está na prateleira desta loja na VMpay"})
            continue

        vendidas = vendas.get(good_id, Decimal(0))
        agora = _num(item.get("current_balance"))
        # Saldo negativo é oversell de planograma: o sistema "vendeu" o que não
        # tinha. Na hora da contagem, o mínimo plausível era zero.
        sistema = max(agora, Decimal(0)) + vendidas
        diferenca = contado - sistema
        if diferenca == 0:
            conferem += 1
            continue
        avisos = []
        if abs(diferenca) >= DIFERENCA_AVISO:
            avisos.append(f"diferença de {_texto(abs(diferenca))} un. — confira a contagem")
        if vendidas and contado < vendidas:
            avisos.append(
                f"vendeu {_texto(vendidas)} un. desde a contagem, mais do que foi contado — confira a hora da contagem"
            )
        diferencas.append(
            {
                "linha": numero,
                "product_id": str(produto["product_id"]),
                "produto": produto["name"],
                "sistema": float(sistema),
                "contado": float(contado),
                "diferenca": float(diferenca),
                "vendidas_desde": float(vendidas),
                "avisos": avisos,
            }
        )

    return {
        "loja": target["name"],
        "contado_em": quando.isoformat(),
        "diferencas": diferencas,
        "erros": erros,
        "resumo": {
            "diferencas": len(diferencas),
            "conferem": conferem,
            "nao_contados": nao_contados,
            "erros": len(erros),
            "faltam": float(sum(-Decimal(str(d["diferenca"])) for d in diferencas if d["diferenca"] < 0)),
            "sobram": float(sum(Decimal(str(d["diferenca"])) for d in diferencas if d["diferenca"] > 0)),
        },
        # False: a VMpay não deu as vendas de agora — a prévia usa as da última
        # rodada, e venda dos últimos minutos pode aparecer como sobra.
        "vendas_atualizadas": vendas_frescas,
        "escrita_liberada": settings().vmpay_allow_writes,
    }


class ItemContagem(BaseModel):
    product_id: uuid.UUID
    contado: Decimal = Field(ge=0)


class AplicarBody(BaseModel):
    location_id: uuid.UUID
    contado_em: datetime | None = None
    itens: list[ItemContagem] = Field(min_length=1, max_length=LIMITE_ITENS_PLANOGRAMA)


@router.post("/aplicar")
async def aplicar(body: AplicarBody, ctx: AdminCtx, session: Session) -> dict:
    """Leva os saldos contados para a VMpay num ajuste só, e registra a diferença."""
    estoque.require_writes_enabled()
    quando = _quando(body.contado_em)
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
    if not await _atualizar_vendas(target, token):
        raise HTTPException(
            503, "a VMpay não deu as vendas de agora — sem elas a contagem erraria o saldo; tente em instantes"
        )
    vendas = await _vendas_desde(session, target, quando)
    view = await _planograma(target, token)
    fora = [str(p) for p in ids if externals[p] not in view.items_by_good]
    if fora:
        raise HTTPException(409, f"{len(fora)} produto(s) saíram da prateleira desde a prévia — confira de novo")

    # Recalculado agora, contra o planograma do momento: a prévia pode ter
    # minutos, e a loja vendeu nesse meio-tempo.
    ajustes = []
    for item in body.itens:
        good_id = externals[item.product_id]
        agora = _num(view.items_by_good[good_id].get("current_balance"))
        observado = max(item.contado - vendas.get(good_id, Decimal(0)), Decimal(0))
        if observado == agora:
            continue
        sistema = max(agora, Decimal(0)) + vendas.get(good_id, Decimal(0))
        ajustes.append((item, good_id, agora, observado, item.contado - sistema))
    if not ajustes:
        return {"action_id": None, "status": "sem_mudancas", "ajustados": 0}

    action_id = await estoque._open_action(
        session,
        ctx,
        "stock.count",
        {"location_id": str(body.location_id), "machine_id": target["machine_id"]},
        {
            "contado_em": quando.isoformat(),
            "itens": [
                {
                    "product_id": str(item.product_id),
                    "contado": float(item.contado),
                    "saldo_antes": float(agora),
                    "saldo_depois": float(observado),
                    "diferenca": float(diferenca),
                }
                for item, _, agora, observado, diferenca in ajustes
            ],
        },
    )
    try:
        connector = estoque.get_connector(target["config"], token)
        async with connector.client:
            await connector.contar(
                target["machine_id"],
                target["installation_id"],
                [(good_id, float(observado)) for _, good_id, _, observado, _ in ajustes],
                view=view,
            )
    except VMpayError as exc:
        detail = redact(str(exc))
        await estoque._close_action(session, action_id, error=detail)
        raise HTTPException(502, f"a VMpay recusou a contagem (nenhum saldo mudou): {detail}") from None

    for item, _, _, observado, diferenca in ajustes:
        await session.execute(
            text(
                """
                update core.stock_balance set quantity = :qtd, updated_at = now()
                 where location_id = :location_id and product_id = :product_id
                """
            ),
            {"qtd": observado, "location_id": str(body.location_id), "product_id": str(item.product_id)},
        )
        if diferenca:
            await session.execute(
                text(
                    """
                    insert into core.stock_movement
                        (org_id, location_id, product_id, kind, quantity, actor_user_id, source, occurred_at)
                    values (:org_id, :location_id, :product_id, 'adjustment', :qty, :actor, 'manual', :quando)
                    """
                ),
                {
                    "org_id": str(ctx.org_id),
                    "location_id": str(body.location_id),
                    "product_id": str(item.product_id),
                    "qty": diferenca,
                    "actor": str(ctx.principal.user_id),
                    "quando": quando,
                },
            )
    await estoque._close_action(session, action_id)
    faltam = sum(-d for *_, d in ajustes if d < 0)
    sobram = sum(d for *_, d in ajustes if d > 0)
    return {
        "action_id": action_id,
        "status": "success",
        "ajustados": len(ajustes),
        "faltam": float(faltam),
        "sobram": float(sobram),
    }
