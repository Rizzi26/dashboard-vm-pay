"""Ficha de produto: métricas de venda + estoque de um item.

A venda por produto vem dos /vends (uma linha por item dispensado), ligados ao
produto canônico pela product_link: external_id é o good_id da VMpay.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayError
from vmpay.redact import redact

from ..auth import OrgContext, require_role
from ..db import get_session
from .stock import _close_action, _open_action, get_connector, require_writes_enabled

router = APIRouter(
    prefix="/orgs/{org}/products",
    tags=["produtos"],
    dependencies=[Depends(require_role("viewer"))],
)

Session = Annotated[AsyncSession, Depends(get_session)]
Ctx = Annotated[OrgContext, Depends(require_role("viewer"))]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]

DEFAULT_WINDOW_DAYS = 30


def _window(start: date | None, end: date | None) -> tuple[date, date]:
    end = end or date.today()
    start = start or end - timedelta(days=DEFAULT_WINDOW_DAYS)
    return start, end


# ------------------------------------------------------------------- cadastro
# Rotas literais ANTES de /{product_id}: a ordem de registro decide o match.


async def _load_integration(session: AsyncSession, org_id: uuid.UUID) -> dict:
    row = (
        await session.execute(
            text(
                """
                select id, config from core.integration
                 where org_id = :org_id and active
                 order by created_at
                 limit 1
                """
            ),
            {"org_id": str(org_id)},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(409, "organização sem integração ativa — configure antes")
    return dict(row)


@router.get("/refs")
async def product_refs(ctx: AdminCtx, session: Session) -> dict:
    """Fabricantes/categorias da conta VMpay — as opções do formulário.

    É leitura ao vivo (sem trava de escrita): os registries não têm cursor e o
    formulário precisa do estado atual, não do último snapshot.
    """
    integration = await _load_integration(session, ctx.org_id)
    # get_connector DENTRO do try: resolve_token levanta VMpayError se a env do
    # token não existe no ambiente — fora daqui viraria 500 sem headers de CORS.
    try:
        connector = get_connector(integration["config"])
        async with connector.client:
            return await connector.product_refs()
    except VMpayError as exc:
        raise HTTPException(502, f"a VMpay não respondeu os cadastros: {redact(str(exc))}") from None


class NewProductBody(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    fabricante_id: int
    categoria_id: int
    categoria_abastecimento_id: int
    barcode: str | None = Field(default=None, max_length=64)
    preco: Decimal | None = Field(default=None, gt=0)


@router.post("", status_code=201)
async def create_product(body: NewProductBody, ctx: AdminCtx, session: Session) -> dict:
    """Cria o produto na VMpay e espelha no core, com o action_log de sempre.

    O produto nasce no CADASTRO; entrar no planograma da máquina (e portanto na
    prateleira) continua sendo passo manual na VMpay — a resposta avisa.
    """
    require_writes_enabled()
    integration = await _load_integration(session, ctx.org_id)

    fields: dict = {
        "name": body.nome,
        "manufacturer_id": body.fabricante_id,
        "category_id": body.categoria_id,
        "supply_category_id": body.categoria_abastecimento_id,
    }
    if body.barcode:
        fields["barcode"] = body.barcode
    if body.preco is not None:
        fields["default_price"] = float(body.preco)

    action_id = await _open_action(
        session,
        ctx,
        "product.create",
        {"integration_id": str(integration["id"])},
        fields,
    )
    try:
        connector = get_connector(integration["config"])
        async with connector.client:
            created = await connector.create_product(fields)
    except VMpayError as exc:
        detail = redact(str(exc))
        await _close_action(session, action_id, error=detail)
        raise HTTPException(502, f"a VMpay recusou o produto: {detail}") from None

    external_id = created.get("id") if isinstance(created, dict) else None
    product_row = (
        await session.execute(
            text(
                """
                insert into core.product (org_id, name, barcode, unit_price)
                values (:org_id, :name, :barcode, :price)
                returning id
                """
            ),
            {
                "org_id": str(ctx.org_id),
                "name": body.nome,
                "barcode": body.barcode,
                "price": body.preco,
            },
        )
    ).first()
    if external_id is not None:
        await session.execute(
            text(
                """
                insert into core.product_link (product_id, integration_id, external_id, raw)
                values (:product_id, :integration_id, :external_id, cast(:raw as jsonb))
                on conflict (integration_id, external_id) do update
                    set product_id = excluded.product_id, synced_at = now()
                """
            ),
            {
                "product_id": str(product_row[0]),
                "integration_id": str(integration["id"]),
                "external_id": str(external_id),
                "raw": json.dumps(created),
            },
        )
    await _close_action(session, action_id)
    return {
        "action_id": action_id,
        "status": "success",
        "product_id": str(product_row[0]),
        "vmpay_id": external_id,
    }


# ---------------------------------------------------------------------- ficha


@router.get("/{product_id}")
async def product_detail(
    product_id: uuid.UUID,
    ctx: Ctx,
    session: Session,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    start, end = _window(start, end)

    produto = (
        await session.execute(
            text(
                """
                select p.name, p.barcode,
                       coalesce(max(b.price), max(p.unit_price)) as preco,
                       coalesce(sum(b.quantity), 0)              as estoque
                  from core.product p
                  left join core.stock_balance b on b.product_id = p.id
                 where p.id = :product_id and p.org_id = :org_id
                 group by p.id, p.name, p.barcode
                """
            ),
            {"product_id": str(product_id), "org_id": str(ctx.org_id)},
        )
    ).mappings().first()
    if produto is None:
        raise HTTPException(404, "produto não encontrado nesta organização")

    # good_id da VMpay via vínculo — sem vínculo não há histórico de venda.
    good = (
        await session.execute(
            text(
                """
                select pl.external_id
                  from core.product_link pl
                  join core.integration i on i.id = pl.integration_id
                 where pl.product_id = :product_id and i.org_id = :org_id
                 limit 1
                """
            ),
            {"product_id": str(product_id), "org_id": str(ctx.org_id)},
        )
    ).first()

    params = {
        "good_id": int(good[0]) if good else -1,
        "start": start,
        "end": end + timedelta(days=1),
    }
    resumo = (
        await session.execute(
            text(
                """
                select coalesce(sum(quantity), 0) as unidades,
                       coalesce(sum(value), 0)    as faturamento,
                       max(occurred_at)           as ultima_venda
                  from vmpay.vend
                 where good_id = :good_id
                   and occurred_at >= :start and occurred_at < :end
                """
            ),
            params,
        )
    ).mappings().one()
    diario = (
        await session.execute(
            text(
                """
                select date_trunc('day', occurred_at)::date as dia,
                       coalesce(sum(value), 0)              as faturamento,
                       coalesce(sum(quantity), 0)           as unidades
                  from vmpay.vend
                 where good_id = :good_id
                   and occurred_at >= :start and occurred_at < :end
                 group by 1
                 order by 1
                """
            ),
            params,
        )
    ).mappings().all()

    unidades = float(resumo["unidades"])
    faturamento = float(resumo["faturamento"])
    return {
        "produto": {
            "id": str(product_id),
            "nome": produto["name"],
            "barcode": produto["barcode"],
            "preco": float(produto["preco"]) if produto["preco"] is not None else None,
            "estoque": float(produto["estoque"]),
        },
        "periodo": {"inicio": start.isoformat(), "fim": end.isoformat()},
        "resumo": {
            "unidades": unidades,
            "faturamento": faturamento,
            "preco_medio": faturamento / unidades if unidades else None,
            "ultima_venda": resumo["ultima_venda"].isoformat()
            if resumo["ultima_venda"]
            else None,
        },
        "diario": [
            {
                "dia": d["dia"].isoformat(),
                "faturamento": float(d["faturamento"]),
                "unidades": float(d["unidades"]),
            }
            for d in diario
        ],
    }
