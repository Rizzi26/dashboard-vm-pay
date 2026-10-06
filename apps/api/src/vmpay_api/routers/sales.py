"""Agregados de venda para o dashboard.

Toda leitura de faturamento parte da view `vmpay.sale`, que já exclui transação
cancelada. Não consulte `cashless_fact` direto aqui.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import OrgContext, require_role
from ..db import get_session

# Escopo por organização + papel mínimo viewer. O staging de vendas (vmpay.*)
# não tem coluna de organização; o que amarra a venda ao lojista é a MÁQUINA:
# toda consulta lê só as máquinas que os locais da organização vinculam
# (core.location_link). É isso que impede um lojista de ver venda de outro.
router = APIRouter(
    prefix="/orgs/{org}/sales",
    tags=["vendas"],
    dependencies=[Depends(require_role("viewer"))],
)

DEFAULT_WINDOW_DAYS = 30

ViewerCtx = Annotated[OrgContext, Depends(require_role("viewer"))]

#: Máquinas da organização — ou só as de uma loja (core.location). Vai como
#: filtro em toda leitura de vmpay.sale / cashless_fact / vend.
MAQUINAS_DA_ORG = """
    machine_id in (
        select ll.machine_id
          from core.location_link ll
          join core.location l on l.id = ll.location_id
         where l.org_id = :org_id
           and ll.machine_id is not null
           and (cast(:loja as uuid) is null or l.id = cast(:loja as uuid))
    )
"""


def _escopo(ctx: OrgContext, loja: uuid.UUID | None) -> dict:
    return {"org_id": str(ctx.org_id), "loja": str(loja) if loja else None}


def _window(start: date | None, end: date | None) -> tuple[date, date]:
    end = end or date.today()
    start = start or end - timedelta(days=DEFAULT_WINDOW_DAYS)
    return start, end


@router.get("/summary")
async def summary(
    ctx: ViewerCtx,
    start: date | None = None,
    end: date | None = None,
    loja: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Totais do período: faturamento, transações, ticket médio."""
    start, end = _window(start, end)
    row = (
        await session.execute(
            text(
                """
                select coalesce(sum(value), 0)                as revenue,
                       count(*)                               as transactions,
                       coalesce(sum(quantity), 0)             as items,
                       coalesce(sum(discount_value), 0)       as discounts,
                       count(distinct machine_id)             as machines
                  from vmpay.sale
                 where occurred_at >= :start and occurred_at < :end
                   and """ + MAQUINAS_DA_ORG + """
                """
            ),
            {"start": start, "end": end + timedelta(days=1), **_escopo(ctx, loja)},
        )
    ).mappings().one()
    revenue, transactions = float(row["revenue"]), row["transactions"]
    return {
        "periodo": {"inicio": start.isoformat(), "fim": end.isoformat()},
        "faturamento": revenue,
        "transacoes": transactions,
        "itens": float(row["items"]),
        "descontos": float(row["discounts"]),
        "maquinas_ativas": row["machines"],
        "ticket_medio": revenue / transactions if transactions else 0.0,
    }


@router.get("/daily")
async def daily(
    ctx: ViewerCtx,
    start: date | None = None,
    end: date | None = None,
    machine_id: int | None = None,
    loja: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Série diária de faturamento — o gráfico principal do dashboard."""
    start, end = _window(start, end)
    rows = (
        await session.execute(
            text(
                """
                select date_trunc('day', occurred_at)::date as day,
                       sum(value)                           as revenue,
                       count(*)                             as transactions
                  from vmpay.sale
                 where occurred_at >= :start and occurred_at < :end
                   -- cast() em vez de ::: o parser de parâmetros do SQLAlchemy
                   -- lê ":machine_id::bigint" errado e deixa o primeiro
                   -- placeholder sem substituir (500 em runtime).
                   and (cast(:machine_id as bigint) is null or machine_id = :machine_id)
                   and """ + MAQUINAS_DA_ORG + """
                 group by 1
                 order by 1
                """
            ),
            {
                "start": start,
                "end": end + timedelta(days=1),
                "machine_id": machine_id,
                **_escopo(ctx, loja),
            },
        )
    ).mappings().all()
    return [
        {"dia": r["day"].isoformat(), "faturamento": float(r["revenue"]), "transacoes": r["transactions"]}
        for r in rows
    ]


@router.get("/by-machine")
async def by_machine(
    ctx: ViewerCtx,
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(default=20, le=200),
    loja: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Ranking de máquinas no período."""
    start, end = _window(start, end)
    rows = (
        await session.execute(
            text(
                """
                select s.machine_id,
                       m.asset_number,
                       m.model_name,
                       sum(s.value)  as revenue,
                       count(*)      as transactions
                  from vmpay.sale s
                  left join vmpay.machine m on m.id = s.machine_id
                 where s.occurred_at >= :start and s.occurred_at < :end
                   and s.""" + MAQUINAS_DA_ORG.strip() + """
                 group by 1, 2, 3
                 order by revenue desc nulls last
                 limit :limit
                """
            ),
            {"start": start, "end": end + timedelta(days=1), "limit": limit, **_escopo(ctx, loja)},
        )
    ).mappings().all()
    return [
        {
            "machine_id": r["machine_id"],
            "patrimonio": r["asset_number"],
            "modelo": r["model_name"],
            "faturamento": float(r["revenue"] or 0),
            "transacoes": r["transactions"],
        }
        for r in rows
    ]


@router.get("/lost")
async def lost_sales(
    ctx: ViewerCtx,
    start: date | None = None,
    end: date | None = None,
    loja: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Vendas perdidas: interações do totem que não viraram dinheiro.

    Base: cashless_fact com status <> OK. O "valor não capturado" é teto, não
    piso — cliente com cartão recusado pode ter tentado de novo e comprado; a
    UI diz isso em vez de fingir precisão.
    """
    start, end = _window(start, end)
    params = {"start": start, "end": end + timedelta(days=1), **_escopo(ctx, loja)}
    resumo = (
        await session.execute(
            text(
                """
                select count(*) filter (where status is distinct from 'OK') as tentativas,
                       coalesce(sum(value) filter (where status is distinct from 'OK'), 0) as valor,
                       count(*) as interacoes
                  from vmpay.cashless_fact
                 where occurred_at >= :start and occurred_at < :end
                   and """ + MAQUINAS_DA_ORG + """
                """
            ),
            params,
        )
    ).mappings().one()
    motivos = (
        await session.execute(
            text(
                """
                select coalesce(nullif(cashless_error_friendly, ''), status) as motivo,
                       count(*)                as tentativas,
                       coalesce(sum(value), 0) as valor
                  from vmpay.cashless_fact
                 where status is distinct from 'OK'
                   and occurred_at >= :start and occurred_at < :end
                   and """ + MAQUINAS_DA_ORG + """
                 group by 1
                 order by 2 desc
                 limit 12
                """
            ),
            params,
        )
    ).mappings().all()
    tentativas, interacoes = resumo["tentativas"], resumo["interacoes"]
    return {
        "periodo": {"inicio": start.isoformat(), "fim": end.isoformat()},
        "tentativas": tentativas,
        "valor_nao_capturado": float(resumo["valor"]),
        "interacoes": interacoes,
        "taxa": tentativas / interacoes if interacoes else 0.0,
        "motivos": [
            {"motivo": m["motivo"], "tentativas": m["tentativas"], "valor": float(m["valor"])}
            for m in motivos
        ],
    }


@router.get("/sync-status")
async def sync_status(session: AsyncSession = Depends(get_session)) -> list[dict]:
    """Quão fresco está o dado — o dashboard mostra isto no rodapé.

    Sem este endpoint, um worker parado passa por 'dia fraco de vendas'.
    """
    rows = (
        await session.execute(
            text("select * from vmpay.sync_status order by resource")
        )
    ).mappings().all()
    return [
        {
            "recurso": r["resource"],
            "cursor": r["cursor_value"],
            "registros_ingeridos": r["rows_ingested"],
            "ultima_execucao": r["last_run_at"].isoformat() if r["last_run_at"] else None,
            "ultimo_sucesso": r["last_success"].isoformat() if r["last_success"] else None,
            "ultimo_erro": r["last_error"],
            "atraso_segundos": r["since_last_success"].total_seconds() if r["since_last_success"] else None,
        }
        for r in rows
    ]
