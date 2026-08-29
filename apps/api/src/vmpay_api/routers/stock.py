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
import math
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayClient, VMpayError
from vmpay.client import PRODUCTION
from vmpay.redact import redact

from ..auth import OrgContext, require_role
from ..config import settings
from ..connector import VMpayConnector
from ..db import get_session, session_factory
from ..models_core import Integration
from ..sync_core import resolve_token, sync_integration

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


# ----------------------------------------------------------------- reposição

#: Item entra na lista se está zerado OU se o saldo cobre menos que este
#: horizonte de dias no ritmo de venda do período.
REPOSICAO_HORIZONTE_DIAS = 5

#: A sugestão de compra mira uma semana de venda — o ciclo típico de visita.
REPOSICAO_ALVO_DIAS = 7

REPOSICAO_SQL = """
with vendas as (
    select ll.location_id, pl.product_id,
           sum(coalesce(v.quantity, 1)) as unidades,
           max(v.occurred_at)           as ultima_venda
      from vmpay.vend v
      join core.location_link ll on ll.machine_id = v.machine_id
      join core.product_link  pl on pl.integration_id = ll.integration_id
                                and cast(pl.external_id as bigint) = v.good_id
      join core.location l on l.id = ll.location_id
     where l.org_id = :org_id
       and v.occurred_at >= now() - make_interval(days => :days)
     group by ll.location_id, pl.product_id
)
select b.location_id, l.name as location_name,
       b.product_id, p.name as product_name, p.barcode,
       b.quantity,
       coalesce(b.price, p.unit_price) as preco,
       va.unidades as vendidas,
       va.ultima_venda,
       va.unidades / cast(:days as numeric) as por_dia
  from core.stock_balance b
  join core.location l on l.id = b.location_id
  join core.product  p on p.id = b.product_id
  join vendas va on va.location_id = b.location_id and va.product_id = b.product_id
 where l.org_id = :org_id
   and (
        b.quantity = 0
        or b.quantity / (va.unidades / cast(:days as numeric)) <= :horizonte
   )
 order by (va.unidades / cast(:days as numeric)) * coalesce(b.price, p.unit_price, 0) desc
"""


async def _reposicao_itens(session: AsyncSession, org_id: uuid.UUID, days: int) -> list[dict]:
    rows = (
        await session.execute(
            text(REPOSICAO_SQL),
            {
                "org_id": str(org_id),
                "days": days,
                "horizonte": REPOSICAO_HORIZONTE_DIAS,
            },
        )
    ).mappings().all()

    itens = []
    for r in rows:
        quantidade = float(r["quantity"])
        por_dia = float(r["por_dia"])
        preco = float(r["preco"]) if r["preco"] is not None else None
        alvo = por_dia * REPOSICAO_ALVO_DIAS
        sugestao = max(1, math.ceil(alvo - quantidade))
        # Saldo negativo existe: oversell de planograma na VMpay. Para o
        # repositor é a mesma coisa que zerado — e "restam -1" na tela não.
        zerado = quantidade <= 0
        itens.append(
            {
                "location_id": str(r["location_id"]),
                "local": r["location_name"],
                "product_id": str(r["product_id"]),
                "produto": r["product_name"],
                "barcode": r["barcode"],
                "quantidade": quantidade,
                "status": "ruptura" if zerado else "acabando",
                "dias_restantes": (
                    0.0 if zerado else round(quantidade / por_dia, 1)
                ),
                "vendidas_periodo": float(r["vendidas"]),
                "por_dia": round(por_dia, 2),
                "ultima_venda": (
                    r["ultima_venda"].isoformat() if r["ultima_venda"] else None
                ),
                "preco": preco,
                "risco_dia": round(por_dia * preco, 2) if preco is not None else None,
                "sugestao": sugestao,
            }
        )
    return itens


@router.get("/reposicao")
async def restock_list(ctx: ViewerCtx, session: Session, days: int = 30) -> dict:
    """O que levar na próxima visita: produto que VENDE e está zerado/acabando.

    Ruptura sem venda no período não entra — produto morto é decisão de
    sortimento, não de reposição. A ordem é por faturamento diário em risco.
    """
    days = max(7, min(days, 365))
    itens = await _reposicao_itens(session, ctx.org_id, days)
    return {
        "dias": days,
        "resumo": {
            "ruptura": sum(1 for i in itens if i["status"] == "ruptura"),
            "acabando": sum(1 for i in itens if i["status"] == "acabando"),
            "risco_dia": round(sum(i["risco_dia"] or 0 for i in itens), 2),
        },
        "itens": itens,
    }


@router.get("/reposicao/export.csv")
async def restock_csv(ctx: ViewerCtx, session: Session, days: int = 30) -> Response:
    """A lista de compra em planilha — para imprimir ou levar no bolso."""
    days = max(7, min(days, 365))
    itens = await _reposicao_itens(session, ctx.org_id, days)
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")  # Excel pt-BR abre ; direto
    writer.writerow(
        ["produto", "codigo_barras", "situacao", "restam", "dura_dias", "vende_por_dia", "levar"]
    )
    for i in itens:
        writer.writerow(
            [
                i["produto"],
                i["barcode"] or "",
                "zerado" if i["status"] == "ruptura" else "acabando",
                max(0, int(i["quantidade"])),
                str(i["dias_restantes"]).replace(".", ","),
                str(i["por_dia"]).replace(".", ","),
                i["sugestao"],
            ]
        )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="reposicao.csv"'},
    )


# ---------------------------------------------------------------- atualização

#: Entre duas sincronizações sob demanda. O cron continua existindo; o botão
#: serve para "acabei de repor, quero ver agora" — não para polling de UI.
SYNC_COOLDOWN_S = 120


async def _executar_sync(integration_id: str) -> None:
    """Snapshot fora do request: o 202 volta na hora, a VMpay demora o que for.

    Sessão própria porque a do request fecha junto com a resposta.
    """
    async with session_factory()() as sessao:
        integ = await sessao.get(Integration, uuid.UUID(integration_id))
        if integ is not None:
            await sync_integration(sessao, integ)


@router.post("/sync", status_code=202)
async def sync_now(ctx: AdminCtx, session: Session, background: BackgroundTasks) -> dict:
    """Sincroniza catálogo + saldos da organização agora, sem esperar o cron.

    Não passa pelo action_log de propósito: o log audita escrita NA VMpay;
    isto é leitura — o rastro fica no updated_at dos saldos.
    """
    row = (
        await session.execute(
            text(
                """
                select i.id, i.config
                  from core.integration i
                 where i.org_id = :org_id and i.active and i.kind = 'vmpay'
                 order by i.created_at
                 limit 1
                """
            ),
            {"org_id": str(ctx.org_id)},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(404, "organização sem integração VMpay ativa")
    try:
        # Valida o token ANTES de agendar: sem env no ambiente da API, o 503
        # explica o que falta em vez de uma tarefa morrer em silêncio.
        resolve_token(row["config"] or {})
    except VMpayError as exc:
        raise HTTPException(503, redact(str(exc))) from None

    ultimo = await session.scalar(
        text(
            """
            select max(b.updated_at)
              from core.stock_balance b
              join core.location l on l.id = b.location_id
             where l.org_id = :org_id
            """
        ),
        {"org_id": str(ctx.org_id)},
    )
    if ultimo is not None:
        idade = (datetime.now(timezone.utc) - ultimo).total_seconds()
        if idade < SYNC_COOLDOWN_S:
            raise HTTPException(
                429,
                f"estoque sincronizado há {int(idade)}s — aguarde "
                f"{SYNC_COOLDOWN_S - int(idade)}s para pedir de novo",
            )

    background.add_task(_executar_sync, str(row["id"]))
    return {"status": "agendado"}


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
       sum(q.saida - coalesce(vd.vendidas, 0)) as quebra,
       sum(
           (q.saida - coalesce(vd.vendidas, 0)) * coalesce(q.price, p.unit_price)
       ) as valor,
       max(q.snapshot_at) as ultima
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
 group by q.location_id, l.name, q.product_id, p.name, p.barcode
 order by quebra desc, ultima desc
"""


@router.get("/quebras")
async def stock_losses(ctx: ViewerCtx, session: Session, days: int = 30) -> dict:
    """Quebra por produto: quanto saiu sem venda registrada no período.

    Agregado por produto de propósito — o operador quer saber O QUE sumiu e
    quanto custou; o intervalo exato de cada queda é mecânica de detecção, e
    ficava confuso na tela.
    """
    days = max(1, min(days, 365))
    rows = (
        await session.execute(
            text(QUEBRAS_SQL), {"org_id": str(ctx.org_id), "days": days}
        )
    ).mappings().all()
    itens = [
        {
            "location_id": str(r["location_id"]),
            "local": r["location_name"],
            "product_id": str(r["product_id"]),
            "produto": r["product_name"],
            "barcode": r["barcode"],
            "quebra": float(r["quebra"]),
            "valor": (
                round(float(r["valor"]), 2) if r["valor"] is not None else None
            ),
            "ultima": r["ultima"].isoformat(),
        }
        for r in rows
    ]
    return {
        "dias": days,
        "resumo": {
            "unidades": sum(i["quebra"] for i in itens),
            "valor": round(sum(i["valor"] or 0 for i in itens), 2),
        },
        "itens": itens,
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
