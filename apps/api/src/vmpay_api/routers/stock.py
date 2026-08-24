"""Estoque: leitura, exportação e ações com write-back.

Toda ação passa pelo action_log: pendente antes de chamar a VMpay, fechada com
sucesso ou erro depois. O log pendente é commitado ANTES do write-back — se o
processo morrer no meio, fica o registro de que a ação foi tentada, em vez de
uma escrita órfã no sistema externo sem rastro aqui.
"""

from __future__ import annotations

import csv
import io
import json
import os
import uuid
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayClient, VMpayError
from vmpay.client import PRODUCTION
from vmpay.redact import redact

from ..auth import OrgContext, require_role
from ..connector import VMpayConnector
from ..db import get_session
from ..sync_core import resolve_token

router = APIRouter(prefix="/orgs/{org}/stock", tags=["estoque"])

Session = Annotated[AsyncSession, Depends(get_session)]
ViewerCtx = Annotated[OrgContext, Depends(require_role("viewer"))]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]


def get_connector(config: dict[str, Any]) -> VMpayConnector:
    """Constrói o conector da integração. Separado para os testes trocarem."""
    token = resolve_token(config or {})
    base = os.environ.get("VMPAY_BASE") or PRODUCTION
    return VMpayConnector(VMpayClient(token, base_url=base))


# -------------------------------------------------------------------- leitura

STOCK_SQL = """
select l.id   as location_id,
       l.name as location_name,
       p.id   as product_id,
       p.name as product_name,
       p.barcode,
       p.unit_price,
       b.quantity,
       b.updated_at
  from core.stock_balance b
  join core.location l on l.id = b.location_id
  join core.product  p on p.id = b.product_id
 where l.org_id = :org_id
 order by l.name, p.name
"""


@router.get("")
async def list_stock(ctx: ViewerCtx, session: Session) -> list[dict]:
    rows = (
        await session.execute(text(STOCK_SQL), {"org_id": str(ctx.org_id)})
    ).mappings().all()
    return [
        {
            "location_id": str(r["location_id"]),
            "local": r["location_name"],
            "product_id": str(r["product_id"]),
            "produto": r["product_name"],
            "barcode": r["barcode"],
            "preco": float(r["unit_price"]) if r["unit_price"] is not None else None,
            "quantidade": float(r["quantity"]),
            "atualizado_em": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


@router.get("/export.csv")
async def export_csv(ctx: ViewerCtx, session: Session) -> Response:
    """Planilha do estoque atual. O papel é checado aqui, não no botão."""
    rows = (
        await session.execute(text(STOCK_SQL), {"org_id": str(ctx.org_id)})
    ).mappings().all()
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")  # Excel pt-BR abre ; direto
    writer.writerow(["local", "produto", "codigo_barras", "preco", "quantidade", "atualizado_em"])
    for r in rows:
        writer.writerow(
            [
                r["location_name"],
                r["product_name"],
                r["barcode"] or "",
                f"{r['unit_price']:.2f}".replace(".", ",") if r["unit_price"] is not None else "",
                r["quantity"],
                r["updated_at"].isoformat(),
            ]
        )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="estoque.csv"'},
    )


# --------------------------------------------------------------------- ações


class RestockItem(BaseModel):
    product_id: uuid.UUID
    quantity: Decimal = Field(gt=0)


class RestockBody(BaseModel):
    location_id: uuid.UUID
    items: list[RestockItem] = Field(min_length=1)


class PriceBody(BaseModel):
    location_id: uuid.UUID
    product_id: uuid.UUID
    price: Decimal = Field(gt=0)

    @field_validator("price")
    @classmethod
    def _2_casas(cls, v: Decimal) -> Decimal:
        return v.quantize(Decimal("0.01"))


async def _load_target(session: AsyncSession, org_id: uuid.UUID, location_id: uuid.UUID) -> dict:
    """Local + vínculo + integração, sempre escopado pela organização."""
    row = (
        await session.execute(
            text(
                """
                select l.id as location_id, l.name,
                       ll.machine_id, ll.installation_id,
                       i.id as integration_id, i.config
                  from core.location l
                  join core.location_link ll on ll.location_id = l.id
                  join core.integration i on i.id = ll.integration_id and i.active
                 where l.id = :location_id and l.org_id = :org_id
                """
            ),
            {"location_id": str(location_id), "org_id": str(org_id)},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "local não encontrado nesta organização")
    if row["machine_id"] is None or row["installation_id"] is None:
        raise HTTPException(409, "local sem vínculo de máquina/instalação — sincronize antes")
    return dict(row)


async def _external_ids(
    session: AsyncSession, integration_id: Any, product_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    rows = (
        await session.execute(
            text(
                """
                select product_id, external_id
                  from core.product_link
                 where integration_id = :integration_id
                   and product_id = any(:product_ids)
                """
            ),
            {
                "integration_id": str(integration_id),
                "product_ids": [str(p) for p in product_ids],
            },
        )
    ).mappings().all()
    return {r["product_id"]: int(r["external_id"]) for r in rows}


async def _open_action(
    session: AsyncSession, ctx: OrgContext, action: str, target: dict, params: dict
) -> int:
    row = (
        await session.execute(
            text(
                """
                insert into core.action_log (org_id, actor_user_id, action, target, params)
                values (:org_id, :actor, :action, cast(:target as jsonb), cast(:params as jsonb))
                returning id
                """
            ),
            {
                "org_id": str(ctx.org_id),
                "actor": str(ctx.principal.user_id),
                "action": action,
                "target": json.dumps(target),
                "params": json.dumps(params),
            },
        )
    ).first()
    # Commit ANTES do write-back: se o processo morrer no meio da chamada à
    # VMpay, fica o rastro "pending" — auditável — em vez de escrita sem log.
    await session.commit()
    return row[0]


async def _close_action(
    session: AsyncSession, action_id: int, *, error: str | None = None
) -> None:
    await session.execute(
        text(
            """
            update core.action_log
               set status = :status, error = :error, finished_at = now()
             where id = :id
            """
        ),
        {
            "status": "error" if error else "success",
            "error": error,
            "id": action_id,
        },
    )
    await session.commit()


@router.post("/restock", status_code=201)
async def restock(body: RestockBody, ctx: AdminCtx, session: Session) -> dict:
    """Entrada de estoque: empurra o ajuste para a VMpay e registra localmente."""
    target = await _load_target(session, ctx.org_id, body.location_id)
    externals = await _external_ids(
        session, target["integration_id"], [i.product_id for i in body.items]
    )
    faltando = [str(i.product_id) for i in body.items if i.product_id not in externals]
    if faltando:
        raise HTTPException(422, f"produtos sem vínculo com a integração: {', '.join(faltando)}")

    action_id = await _open_action(
        session,
        ctx,
        "stock.restock",
        {"location_id": str(body.location_id), "machine_id": target["machine_id"]},
        {"items": [{"product_id": str(i.product_id), "quantity": float(i.quantity)} for i in body.items]},
    )
    try:
        connector = get_connector(target["config"])
        async with connector.client:
            result = await connector.restock(
                target["machine_id"],
                target["installation_id"],
                [(externals[i.product_id], float(i.quantity)) for i in body.items],
            )
    except VMpayError as exc:
        detail = redact(str(exc))
        await _close_action(session, action_id, error=detail)
        raise HTTPException(502, f"a VMpay recusou o ajuste: {detail}") from None

    # Write-back aceito: refletir localmente e fechar o log.
    for item in body.items:
        await session.execute(
            text(
                """
                update core.stock_balance
                   set quantity = quantity + :qty, updated_at = now()
                 where location_id = :location_id and product_id = :product_id
                """
            ),
            {
                "qty": item.quantity,
                "location_id": str(body.location_id),
                "product_id": str(item.product_id),
            },
        )
        await session.execute(
            text(
                """
                insert into core.stock_movement
                    (org_id, location_id, product_id, kind, quantity, actor_user_id, source)
                values (:org_id, :location_id, :product_id, 'restock', :qty, :actor, 'manual')
                """
            ),
            {
                "org_id": str(ctx.org_id),
                "location_id": str(body.location_id),
                "product_id": str(item.product_id),
                "qty": item.quantity,
                "actor": str(ctx.principal.user_id),
            },
        )
    await _close_action(session, action_id)
    return {"action_id": action_id, "status": "success", "vmpay": result}


@router.post("/price")
async def set_price(body: PriceBody, ctx: AdminCtx, session: Session) -> dict:
    """Alteração de preço no planograma da instalação, via VMpay."""
    target = await _load_target(session, ctx.org_id, body.location_id)
    externals = await _external_ids(session, target["integration_id"], [body.product_id])
    if body.product_id not in externals:
        raise HTTPException(422, "produto sem vínculo com a integração")

    action_id = await _open_action(
        session,
        ctx,
        "stock.price",
        {"location_id": str(body.location_id), "machine_id": target["machine_id"]},
        {"product_id": str(body.product_id), "price": float(body.price)},
    )
    try:
        connector = get_connector(target["config"])
        async with connector.client:
            result = await connector.set_price(
                target["machine_id"],
                target["installation_id"],
                [(externals[body.product_id], float(body.price))],
            )
    except VMpayError as exc:
        detail = redact(str(exc))
        await _close_action(session, action_id, error=detail)
        raise HTTPException(502, f"a VMpay recusou o preço: {detail}") from None

    await session.execute(
        text(
            """
            update core.product set unit_price = :price, updated_at = now()
             where id = :product_id and org_id = :org_id
            """
        ),
        {"price": body.price, "product_id": str(body.product_id), "org_id": str(ctx.org_id)},
    )
    await _close_action(session, action_id)
    return {"action_id": action_id, "status": "success", "vmpay": result}


# ---------------------------------------------------------------------- audit


@router.get("/actions")
async def action_history(ctx: AdminCtx, session: Session, limit: int = 50) -> list[dict]:
    rows = (
        await session.execute(
            text(
                """
                select a.id, a.action, a.status, a.error, a.created_at, a.finished_at,
                       u.email as actor_email, a.target, a.params
                  from core.action_log a
                  left join auth.users u on u.id = a.actor_user_id
                 where a.org_id = :org_id
                 order by a.created_at desc
                 limit :limit
                """
            ),
            {"org_id": str(ctx.org_id), "limit": min(limit, 200)},
        )
    ).mappings().all()
    return [
        {
            "id": r["id"],
            "acao": r["action"],
            "status": r["status"],
            "erro": r["error"],
            "ator": r["actor_email"],
            "alvo": r["target"],
            "params": r["params"],
            "criada_em": r["created_at"].isoformat(),
            "finalizada_em": r["finished_at"].isoformat() if r["finished_at"] else None,
        }
        for r in rows
    ]
