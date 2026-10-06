"""Central das lojas: um cartão por loja (core.location) da organização.

O lojista é a organização; cada mercadinho dele é um local. A central é a
primeira tela — de onde se vê qual loja precisa de atenção e se entra nela.
"""

from __future__ import annotations

from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import OrgContext, require_role
from ..db import get_session
from .stock import _reposicao_itens

router = APIRouter(prefix="/orgs/{org}/lojas", tags=["lojas"])

Session = Annotated[AsyncSession, Depends(get_session)]
ViewerCtx = Annotated[OrgContext, Depends(require_role("viewer"))]

# "Hoje" é o dia de Brasília: para quem toca a loja, a venda das 22h é de hoje,
# não de amanhã em UTC. Os demais agregados do painel continuam em dias UTC.
LOJAS_SQL = """
with lojas as (
    select l.id, l.name
      from core.location l
     where l.org_id = :org_id
), maquinas as (
    select ll.location_id, ll.machine_id
      from core.location_link ll
      join lojas on lojas.id = ll.location_id
     where ll.machine_id is not null
), vendas as (
    select m.location_id,
           coalesce(sum(s.value) filter (
               where s.occurred_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo')
                                       at time zone 'America/Sao_Paulo')), 0) as hoje,
           coalesce(sum(s.value) filter (where s.occurred_at >= now() - interval '7 days'), 0) as d7,
           coalesce(sum(s.value), 0)                                                         as d30,
           count(*)                                                                          as transacoes_30d,
           max(s.occurred_at)                                                                as ultima_venda
      from vmpay.sale s
      join maquinas m on m.machine_id = s.machine_id
     where s.occurred_at >= now() - interval '30 days'
     group by m.location_id
), estoque as (
    select b.location_id,
           count(*)                                  as itens,
           count(*) filter (where b.quantity <= 0)   as zerados,
           coalesce(sum(greatest(b.quantity, 0)), 0) as unidades,
           max(b.updated_at)                         as atualizado_em
      from core.stock_balance b
      join lojas on lojas.id = b.location_id
     group by b.location_id
)
select lojas.id, lojas.name,
       coalesce(v.hoje, 0) as hoje, coalesce(v.d7, 0) as d7, coalesce(v.d30, 0) as d30,
       coalesce(v.transacoes_30d, 0) as transacoes_30d, v.ultima_venda,
       coalesce(e.itens, 0) as itens, coalesce(e.zerados, 0) as zerados,
       coalesce(e.unidades, 0) as unidades, e.atualizado_em
  from lojas
  left join vendas  v on v.location_id = lojas.id
  left join estoque e on e.location_id = lojas.id
 order by coalesce(v.d30, 0) desc, lojas.name
"""


@router.get("")
async def central(ctx: ViewerCtx, session: Session) -> dict:
    rows = (
        await session.execute(text(LOJAS_SQL), {"org_id": str(ctx.org_id)})
    ).mappings().all()
    # "Acabando" usa a mesma regra da tela de Reposição (saldo cobre menos de
    # 5 dias no ritmo de venda) — a central não inventa outro critério.
    acabando = Counter(
        i["location_id"] for i in await _reposicao_itens(session, ctx.org_id, 30)
        if i["status"] == "acabando"
    )

    lojas = []
    for r in rows:
        transacoes = int(r["transacoes_30d"])
        d30 = float(r["d30"])
        lojas.append(
            {
                "id": str(r["id"]),
                "nome": r["name"],
                "vendas": {
                    "hoje": float(r["hoje"]),
                    "d7": float(r["d7"]),
                    "d30": d30,
                    "transacoes_30d": transacoes,
                    "ticket_30d": d30 / transacoes if transacoes else 0.0,
                    "ultima_venda": r["ultima_venda"].isoformat() if r["ultima_venda"] else None,
                },
                "estoque": {
                    "itens": int(r["itens"]),
                    "zerados": int(r["zerados"]),
                    "acabando": acabando.get(str(r["id"]), 0),
                    "unidades": float(r["unidades"]),
                    "atualizado_em": r["atualizado_em"].isoformat() if r["atualizado_em"] else None,
                },
            }
        )

    return {
        "lojas": lojas,
        "totais": {
            "hoje": sum(l["vendas"]["hoje"] for l in lojas),
            "d7": sum(l["vendas"]["d7"] for l in lojas),
            "d30": sum(l["vendas"]["d30"] for l in lojas),
            "zerados": sum(l["estoque"]["zerados"] for l in lojas),
            "acabando": sum(l["estoque"]["acabando"] for l in lojas),
        },
    }
