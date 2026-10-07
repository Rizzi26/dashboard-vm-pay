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
    """Totais do período: faturamento, transações, ticket médio.

    `anterior` é a janela de mesmo tamanho logo antes desta — base do "+12%
    vs período anterior". Uma consulta só: as duas janelas são contíguas.
    """
    start, end = _window(start, end)
    anterior_inicio = start - (end - start + timedelta(days=1))
    row = (
        await session.execute(
            text(
                """
                select coalesce(sum(value) filter (where occurred_at >= :start), 0)    as revenue,
                       count(*) filter (where occurred_at >= :start)                  as transactions,
                       coalesce(sum(quantity) filter (where occurred_at >= :start), 0) as items,
                       coalesce(sum(discount_value) filter (where occurred_at >= :start), 0) as discounts,
                       count(distinct machine_id) filter (where occurred_at >= :start) as machines,
                       coalesce(sum(value) filter (where occurred_at < :start), 0)     as prev_revenue,
                       count(*) filter (where occurred_at < :start)                   as prev_transactions
                  from vmpay.sale
                 where occurred_at >= :prev_start and occurred_at < :end
                   and """ + MAQUINAS_DA_ORG + """
                """
            ),
            {
                "start": start,
                "end": end + timedelta(days=1),
                "prev_start": anterior_inicio,
                **_escopo(ctx, loja),
            },
        )
    ).mappings().one()
    revenue, transactions = float(row["revenue"]), row["transactions"]
    prev_revenue = float(row.get("prev_revenue") or 0)
    prev_transactions = int(row.get("prev_transactions") or 0)
    return {
        "anterior": {
            "inicio": anterior_inicio.isoformat(),
            "fim": (start - timedelta(days=1)).isoformat(),
            "faturamento": prev_revenue,
            "transacoes": prev_transactions,
            "ticket_medio": prev_revenue / prev_transactions if prev_transactions else 0.0,
        },
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


# ---------------------------------------------------------------- C2 / C3

#: Dia da semana × hora no relógio da LOJA (Brasília): a venda das 19h é das
#: 19h para quem repõe, não das 22h UTC. isodow: 1 = segunda … 7 = domingo.
HEATMAP_SQL = """
select extract(isodow from occurred_at at time zone 'America/Sao_Paulo')::int as dia,
       extract(hour   from occurred_at at time zone 'America/Sao_Paulo')::int as hora,
       coalesce(sum(value), 0) as revenue,
       count(*)                as transactions
  from vmpay.sale
 where occurred_at >= :start and occurred_at < :end
   and """ + MAQUINAS_DA_ORG + """
 group by 1, 2
"""


@router.get("/heatmap")
async def heatmap(
    ctx: ViewerCtx,
    start: date | None = None,
    end: date | None = None,
    loja: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Quando a loja vende: faturamento e transações por dia da semana × hora."""
    start, end = _window(start, end)
    rows = (
        await session.execute(
            text(HEATMAP_SQL),
            {"start": start, "end": end + timedelta(days=1), **_escopo(ctx, loja)},
        )
    ).mappings().all()
    return {
        "periodo": {"inicio": start.isoformat(), "fim": end.isoformat()},
        "celulas": [
            {
                "dia": r["dia"],
                "hora": r["hora"],
                "faturamento": float(r["revenue"]),
                "transacoes": r["transactions"],
            }
            for r in rows
        ],
    }


#: Venda por produto (vmpay.vend: uma linha por item dispensado). O produto
#: canônico vem do vínculo da integração da organização; good sem vínculo
#: ainda aparece, pelo nome do catálogo da VMpay. Fragmento FROM/WHERE
#: compartilhado pela curva ABC e pelos "mais vendidos" — a regra de escopo
#: mora num lugar só.
VEND_DA_ORG = """
  from vmpay.vend v
  left join vmpay.good g on g.id = v.good_id
  left join (
        select pl.external_id, pl.product_id
          from core.product_link pl
          join core.integration i on i.id = pl.integration_id
         where i.org_id = :org_id
  ) pl on pl.external_id = cast(v.good_id as text)
  left join core.product p on p.id = pl.product_id
 where v.occurred_at >= :start and v.occurred_at < :end
   and v.""" + MAQUINAS_DA_ORG.strip()

ABC_SQL = """
select pl.product_id,
       coalesce(p.name, g.name, 'Produto ' || v.good_id) as nome,
       v.good_id,
       coalesce(sum(v.value), 0)              as revenue,
       coalesce(sum(coalesce(v.quantity, 1)), 0) as units
""" + VEND_DA_ORG + """
 group by 1, 2, 3
 order by revenue desc
"""

#: Cortes da curva: A até 80% do faturamento acumulado, B até 95%, C o resto.
ABC_CORTES = (("A", 0.80), ("B", 0.95))


@router.get("/abc")
async def curva_abc(
    ctx: ViewerCtx,
    start: date | None = None,
    end: date | None = None,
    loja: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Curva ABC por faturamento: os poucos produtos que fazem a maior parte."""
    start, end = _window(start, end)
    rows = (
        await session.execute(
            text(ABC_SQL),
            {"start": start, "end": end + timedelta(days=1), **_escopo(ctx, loja)},
        )
    ).mappings().all()
    total = sum(float(r["revenue"]) for r in rows) or 0.0
    itens, acumulado = [], 0.0
    for posicao, r in enumerate(rows, start=1):
        faturamento = float(r["revenue"])
        # A classe usa o acumulado ANTES do item: o produto que cruza 80% ainda
        # é A — é ele que leva a curva até lá.
        antes = acumulado / total if total else 1.0
        classe = next((c for c, corte in ABC_CORTES if antes < corte), "C")
        acumulado += faturamento
        itens.append(
            {
                "posicao": posicao,
                "product_id": str(r["product_id"]) if r["product_id"] else None,
                "produto": r["nome"],
                "faturamento": faturamento,
                "unidades": float(r["units"]),
                "participacao": faturamento / total if total else 0.0,
                "acumulado": acumulado / total if total else 0.0,
                "classe": classe,
            }
        )
    resumo = {
        c: {
            "produtos": sum(1 for i in itens if i["classe"] == c),
            "faturamento": sum(i["faturamento"] for i in itens if i["classe"] == c),
        }
        for c in ("A", "B", "C")
    }
    return {
        "periodo": {"inicio": start.isoformat(), "fim": end.isoformat()},
        "total": total,
        "resumo": resumo,
        "itens": itens,
    }


# ---------------------------------------------------------------- top produtos

#: Granularidade pelo tamanho da janela: ~30 pontos por linha no máximo útil
#: antes de virar serrilhado. Semana começa na segunda (date_trunc do Postgres).
GRANULARIDADES = (("dia", 31), ("semana", 120))
_TRUNC = {"dia": "day", "semana": "week", "mes": "month"}


def _granularidade(start: date, end: date) -> str:
    dias = (end - start).days + 1
    return next((g for g, teto in GRANULARIDADES if dias <= teto), "mes")


def _balde(d: date, granularidade: str) -> date:
    if granularidade == "semana":
        return d - timedelta(days=d.weekday())
    if granularidade == "mes":
        return d.replace(day=1)
    return d


def _proximo(d: date, granularidade: str) -> date:
    if granularidade == "semana":
        return d + timedelta(days=7)
    if granularidade == "mes":
        return (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return d + timedelta(days=1)


def _serie_sql(granularidade: str) -> str:
    # O balde é no relógio da loja (como o heatmap), mas a JANELA segue a
    # mesma das outras consultas: assim a soma da série bate com o ranking e
    # com a curva ABC. O que cai fora dos baldes pela diferença de fuso (as
    # últimas horas da véspera do início) é preso ao primeiro/último balde,
    # em vez de criar um ponto fora do período.
    trunc = _TRUNC[granularidade]  # valor fixo do dicionário, nunca da URL
    return (
        """
select coalesce(v.good_id, -1) as good_id,
       greatest(cast(:primeiro as date), least(cast(:ultimo as date),
           date_trunc('""" + trunc + """', v.occurred_at at time zone 'America/Sao_Paulo')::date)) as inicio,
       coalesce(sum(v.value), 0)                 as revenue,
       coalesce(sum(coalesce(v.quantity, 1)), 0) as units
"""
        + VEND_DA_ORG
        + """
   and coalesce(v.good_id, -1) = any(cast(:goods as bigint[]))
 group by 1, 2
"""
    )


@router.get("/top-produtos")
async def top_produtos(
    ctx: ViewerCtx,
    start: date | None = None,
    end: date | None = None,
    loja: uuid.UUID | None = None,
    n: int = Query(default=5, ge=1, le=10),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Os N produtos de maior faturamento e a série de cada um no período.

    O ranking é o topo da curva ABC (mesma consulta), então os dois cartões da
    tela nunca discordam sobre quem é o 1º. A série traz TODOS os baldes, com
    zero onde não houve venda — senão a linha liga dois pontos por cima do
    buraco e esconde a falta.
    """
    start, end = _window(start, end)
    granularidade = _granularidade(start, end)
    escopo = {"start": start, "end": end + timedelta(days=1), **_escopo(ctx, loja)}
    ranking = (
        await session.execute(text(ABC_SQL + " limit :n"), {**escopo, "n": n})
    ).mappings().all()

    produtos, chave_do_good = [], {}
    for posicao, r in enumerate(ranking, start=1):
        good = r["good_id"] if r["good_id"] is not None else -1
        chave = str(r["product_id"]) if r["product_id"] else str(good)
        chave_do_good[good] = chave
        produtos.append(
            {
                "posicao": posicao,
                "chave": chave,
                "product_id": str(r["product_id"]) if r["product_id"] else None,
                "produto": r["nome"] or f"Produto {good}",
                "faturamento": float(r["revenue"]),
                "unidades": float(r["units"]),
            }
        )

    primeiro, ultimo = _balde(start, granularidade), _balde(end, granularidade)
    pontos: list[dict] = []
    if produtos:
        linhas = (
            await session.execute(
                text(_serie_sql(granularidade)),
                {**escopo, "goods": list(chave_do_good), "primeiro": primeiro, "ultimo": ultimo},
            )
        ).mappings().all()
        valores: dict[date, dict[str, dict]] = {}
        for linha in linhas:
            chave = chave_do_good.get(linha["good_id"])
            if chave is None:
                continue
            valores.setdefault(linha["inicio"], {})[chave] = {
                "faturamento": float(linha["revenue"]),
                "unidades": float(linha["units"]),
            }
        # "Tudo" começa em 2000: sem este corte seriam 25 anos de zeros antes
        # da primeira venda. Só os baldes INICIAIS vazios saem; buraco no meio
        # fica, com zero.
        if valores:
            primeiro = max(primeiro, min(valores))
        balde = primeiro
        while balde <= ultimo:
            do_balde = valores.get(balde, {})
            pontos.append(
                {
                    "inicio": balde.isoformat(),
                    "valores": {
                        p["chave"]: do_balde.get(p["chave"], {"faturamento": 0.0, "unidades": 0.0})
                        for p in produtos
                    },
                }
            )
            balde = _proximo(balde, granularidade)

    return {
        "granularidade": granularidade,
        "periodo": {"inicio": start.isoformat(), "fim": end.isoformat()},
        "produtos": produtos,
        "pontos": pontos,
    }
