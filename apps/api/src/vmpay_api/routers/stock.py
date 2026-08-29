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
from ..config import settings
from ..connector import VMpayConnector
from ..db import get_session
from ..sync_core import resolve_token

router = APIRouter(prefix="/orgs/{org}/stock", tags=["estoque"])

Session = Annotated[AsyncSession, Depends(get_session)]
ViewerCtx = Annotated[OrgContext, Depends(require_role("viewer"))]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]


def require_writes_enabled() -> None:
    """Fase atual: banco com dados de produção, escrita na VMpay bloqueada.

    O 503 é deliberado (e não 403): não é falta de permissão do usuário, é o
    write-back da plataforma que está desligado. A UI mostra a mensagem como
    veio.
    """
    if not settings().vmpay_allow_writes:
        raise HTTPException(
            503,
            "escrita na VMpay está desligada nesta fase (VMPAY_ALLOW_WRITES=0); "
            "as ações voltam quando o write-back for liberado",
        )


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
       coalesce(b.price, p.unit_price) as unit_price,
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


# ------------------------------------------------------------------ histórico

#: Quedas de saldo entre fotos consecutivas que as vendas do intervalo não
#: explicam. O confronto é feito na leitura, não na ingestão: um vend que
#: chegue atrasado (rodada seguinte) entra pelo occurred_at — que é a hora da
#: máquina — e a "quebra" falsa desaparece sozinha na próxima consulta.
#: Limite conhecido: reposição e venda no MESMO intervalo se cancelam e podem
#: esconder quebra; com 3+ fotos por dia o intervalo é curto o bastante.
QUEBRAS_SQL = """
with serie as (
    select s.location_id, s.product_id, s.snapshot_at, s.quantity, s.price,
           lag(s.quantity)    over w as qtd_anterior,
           lag(s.snapshot_at) over w as foto_anterior
      from core.stock_snapshot s
      join core.location l on l.id = s.location_id
     where l.org_id = :org_id
       and s.snapshot_at >= now() - make_interval(days => :days)
    window w as (partition by s.location_id, s.product_id order by s.snapshot_at)
), quedas as (
    select *, (qtd_anterior - quantity) as saida
      from serie
     where qtd_anterior is not null and quantity < qtd_anterior
)
select q.location_id,
       l.name as location_name,
       q.product_id,
       p.name as product_name,
       p.barcode,
       q.foto_anterior,
       q.snapshot_at,
       q.saida,
       coalesce(vd.vendidas, 0) as vendidas,
       q.saida - coalesce(vd.vendidas, 0) as quebra,
       coalesce(q.price, p.unit_price) as preco
  from quedas q
  join core.product  p on p.id = q.product_id
  join core.location l on l.id = q.location_id
  left join lateral (
        select sum(coalesce(v.quantity, 1)) as vendidas
          from core.location_link ll
          join core.product_link  pl on pl.integration_id = ll.integration_id
                                    and pl.product_id = q.product_id
          join vmpay.vend v on v.machine_id = ll.machine_id
                           and v.good_id = cast(pl.external_id as bigint)
                           and v.occurred_at >  q.foto_anterior
                           and v.occurred_at <= q.snapshot_at
         where ll.location_id = q.location_id
       ) vd on true
 where q.saida > coalesce(vd.vendidas, 0)
 order by q.snapshot_at desc, quebra desc
"""


@router.get("/quebras")
async def stock_losses(ctx: ViewerCtx, session: Session, days: int = 30) -> dict:
    """Suspeitas de quebra: saldo caiu mais do que as vendas do intervalo."""
    days = max(1, min(days, 365))
    rows = (
        await session.execute(
            text(QUEBRAS_SQL), {"org_id": str(ctx.org_id), "days": days}
        )
    ).mappings().all()
    eventos = [
        {
            "location_id": str(r["location_id"]),
            "local": r["location_name"],
            "product_id": str(r["product_id"]),
            "produto": r["product_name"],
            "barcode": r["barcode"],
            "de": r["foto_anterior"].isoformat(),
            "ate": r["snapshot_at"].isoformat(),
            "saida": float(r["saida"]),
            "vendidas": float(r["vendidas"]),
            "quebra": float(r["quebra"]),
            "preco": float(r["preco"]) if r["preco"] is not None else None,
            "valor": (
                round(float(r["quebra"]) * float(r["preco"]), 2)
                if r["preco"] is not None
                else None
            ),
        }
        for r in rows
    ]
    return {
        "dias": days,
        "resumo": {
            "eventos": len(eventos),
            "unidades": sum(e["quebra"] for e in eventos),
            "valor": round(sum(e["valor"] or 0 for e in eventos), 2),
        },
        "eventos": eventos,
    }


HISTORICO_SQL = """
select s.snapshot_at, s.location_id, l.name as location_name, s.quantity
  from core.stock_snapshot s
  join core.location l on l.id = s.location_id
 where l.org_id = :org_id
   and s.product_id = :product_id
   and s.snapshot_at >= now() - make_interval(days => :days)
 order by s.snapshot_at
"""


@router.get("/history/{product_id}")
async def stock_history(
    product_id: uuid.UUID, ctx: ViewerCtx, session: Session, days: int = 30
) -> list[dict]:
    """Série do saldo de um produto, uma amostra por rodada de ingestão."""
    days = max(1, min(days, 365))
    rows = (
        await session.execute(
            text(HISTORICO_SQL),
            {"org_id": str(ctx.org_id), "product_id": str(product_id), "days": days},
        )
    ).mappings().all()
    return [
        {
            "em": r["snapshot_at"].isoformat(),
            "local": r["location_name"],
            "quantidade": float(r["quantity"]),
        }
        for r in rows
    ]


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
    require_writes_enabled()
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
    require_writes_enabled()
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
    await session.execute(
        text(
            """
            update core.stock_balance set price = :price, updated_at = now()
             where location_id = :location_id and product_id = :product_id
            """
        ),
        {"price": body.price, "location_id": str(body.location_id), "product_id": str(body.product_id)},
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
