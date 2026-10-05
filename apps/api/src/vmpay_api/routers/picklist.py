"""Pick list: entrada de estoque a partir do cupom fiscal de compra (NFC-e).

Consulta → conferência na tela → aprovação. A aprovação é um restock como o
de /stock/restock (mesma trava, mesmo action_log), com o cupom gravado no
MESMO commit do log pendente: se a VMpay recusar, o cupom fica em 'error' e
pode ser reaprovado; se der certo, a chave fica travada contra recarga.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import nfce
from ..auth import OrgContext, require_role
from ..db import get_session
from .stock import RestockBody, RestockItem, RestockRecusado, executar_restock, preparar_restock

router = APIRouter(prefix="/orgs/{org}/picklist", tags=["pick list"])

Session = Annotated[AsyncSession, Depends(get_session)]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]

# Descrição de cupom é abreviada ("PRES.SEARA FAT.", "QJO PRATO IPANEMA") e
# casa mal com nome de catálogo por similaridade de string. A comparação é
# por palavra, com prefixo (PRES → PRESUNTO, FAT → FATIADO) e um punhado de
# abreviações que não são prefixo.
ABREVIACOES = {"QJO": "QUEIJO", "REQ": "REQUEIJAO", "PH": "PAPEL", "CX": "CAIXA", "COC": "CHOC"}
# Unidade e conectivo não distinguem produto; número fica (80G ≠ 20G).
IGNORADAS = {"DE", "DA", "DO", "COM", "E", "C", "S", "G", "GR", "GRS", "ML", "L", "LT", "LTS",
             "KG", "UN", "UND", "UNID"}
MAX_SUGESTOES = 3


def _palavras(texto: str) -> list[str]:
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    brutas = re.findall(r"[A-Z]+|\d+", sem_acento.upper())
    return [ABREVIACOES.get(p, p) for p in brutas if p not in IGNORADAS]


def _casa(termo: str, palavras: list[str]) -> bool:
    if termo.isdigit():
        return termo in palavras
    return any(p.startswith(termo) for p in palavras)


def _sugerir(descricao: str, produtos: list[dict]) -> list[str]:
    """Até 3 candidatos do catálogo para uma linha do cupom.

    Cada palavra do cupom pesa pela raridade no catálogo: "TORTUGUIT" casa
    com um produto e decide; "CHOC" casa com dezenas e quase não conta. Sem
    isso, "CHOC ARCOR TORTUGUIT" perdia para qualquer chocolate.
    """
    termos = list(dict.fromkeys(_palavras(descricao)))
    if not termos or not produtos:
        return []
    casa = {t: [_casa(t, p["_palavras"]) for p in produtos] for t in termos}
    # Palavra que não aparece no catálogo (marca do fornecedor, "ARCOR") não
    # diz qual produto é — fica fora da conta em vez de pesar contra todos.
    termos = [t for t in termos if any(casa[t])]
    if not termos:
        return []
    peso = {t: math.log(1 + len(produtos) / (1 + sum(casa[t]))) for t in termos}
    total = sum(peso.values())

    notas = []
    for i, p in enumerate(produtos):
        casadas = [t for t in termos if casa[t][i]]
        # Pelo menos uma palavra de verdade: só "500" casaria meio catálogo.
        if not any(not t.isdigit() for t in casadas):
            continue
        cobertura = sum(peso[t] for t in casadas) / total
        if cobertura < 0.5:
            continue
        # Desempate: o nome do catálogo com menos palavras sobrando.
        precisao = len(casadas) / max(len(p["_palavras"]), 1)
        notas.append((cobertura * 0.8 + precisao * 0.2, p["id"]))
    notas.sort(reverse=True)
    return [pid for _, pid in notas[:MAX_SUGESTOES]]


def fornecedor_da_chave(chave: str) -> str:
    """CNPJ do emitente: posições 7–20 da chave de acesso."""
    return chave[6:20]


# ------------------------------------------------------------------ consulta


class ConsultaBody(BaseModel):
    entrada: str = Field(min_length=1, max_length=2000)


async def _produtos_vinculados(session: AsyncSession, org_id: uuid.UUID) -> list[dict]:
    """Só produto com vínculo na integração pode virar restock na VMpay."""
    rows = (
        await session.execute(
            text(
                """
                select distinct p.id, p.name, p.barcode
                  from core.product p
                  join core.product_link pl on pl.product_id = p.id
                  join core.integration i on i.id = pl.integration_id and i.active
                 where p.org_id = :org_id and p.active
                 order by p.name
                """
            ),
            {"org_id": str(org_id)},
        )
    ).mappings().all()
    return [{"id": str(r["id"]), "name": r["name"], "barcode": r["barcode"]} for r in rows]


async def _de_para(session: AsyncSession, org_id: uuid.UUID, cnpj: str) -> dict[str, dict]:
    rows = (
        await session.execute(
            text(
                """
                select supplier_code, product_id, factor, ignored
                  from core.supplier_product_map
                 where org_id = :org_id and supplier_tax_id = :cnpj
                """
            ),
            {"org_id": str(org_id), "cnpj": cnpj},
        )
    ).mappings().all()
    return {r["supplier_code"]: dict(r) for r in rows}


async def _carga_existente(session: AsyncSession, org_id: uuid.UUID, chave: str) -> dict | None:
    row = (
        await session.execute(
            text(
                """
                select id, status, created_at
                  from core.purchase_receipt
                 where org_id = :org_id and access_key = :chave
                """
            ),
            {"org_id": str(org_id), "chave": chave},
        )
    ).mappings().first()
    return dict(row) if row else None


@router.post("/consulta")
async def consulta(body: ConsultaBody, ctx: AdminCtx, session: Session) -> dict:
    """Interpreta a entrada e, havendo QR Code, traz o cupom inteiro da SEFAZ.

    Nada é gravado aqui. Os itens voltam com o de-para já aplicado (vínculo
    lembrado de compras anteriores do mesmo fornecedor) ou com uma sugestão
    por nome, marcada como tal para a tela não tratá-la como confirmada.
    """
    try:
        entrada = nfce.interpretar(body.entrada)
    except nfce.NFCeError as exc:
        raise HTTPException(422, str(exc)) from None

    cnpj = fornecedor_da_chave(entrada.chave)
    existente = await _carga_existente(session, ctx.org_id, entrada.chave)
    resposta: dict = {
        "chave": entrada.chave,
        "origem": "qrcode" if entrada.qr_param else "manual",
        "fornecedor_cnpj": cnpj,
        "consulta_url": nfce.SP_CONSULTA_CHAVE_URL,
        "ja_carregado": (
            {"status": existente["status"], "em": existente["created_at"].isoformat()}
            if existente and existente["status"] != "error"
            else None
        ),
        "cupom": None,
    }
    if entrada.qr_param is None:
        return resposta

    try:
        cupom = await nfce.consultar(entrada)
    except nfce.NFCeError as exc:
        raise HTTPException(502, str(exc)) from None

    produtos = [
        {**p, "_palavras": _palavras(p["name"])}
        for p in await _produtos_vinculados(session, ctx.org_id)
    ]
    mapa = await _de_para(session, ctx.org_id, cnpj)
    itens = []
    for item in cupom.itens:
        lembrado = mapa.get(item.codigo)
        itens.append(
            {
                "linha": item.numero,
                "codigo": item.codigo,
                "descricao": item.descricao,
                "quantidade": item.quantidade,
                "unidade": item.unidade,
                "valor_unitario": item.valor_unitario,
                "valor_total": item.valor_total,
                "product_id": str(lembrado["product_id"]) if lembrado and lembrado["product_id"] else None,
                "fator": lembrado["factor"] if lembrado else Decimal(1),
                "ignorar": bool(lembrado and lembrado["ignored"]),
                "vinculo": "lembrado" if lembrado else None,
                "sugestoes": [] if lembrado else _sugerir(item.descricao, produtos),
            }
        )
    resposta["cupom"] = {
        "numero": cupom.numero,
        "serie": cupom.serie,
        "emitido_em": cupom.emitido_em.isoformat() if cupom.emitido_em else None,
        "fornecedor_nome": cupom.emitente_nome,
        "valor_total": cupom.valor_total,
        "itens": itens,
    }
    return resposta


@router.get("/opcoes")
async def opcoes(ctx: AdminCtx, session: Session) -> dict:
    """Locais e produtos que a tela oferece para destino e vínculo."""
    locais = (
        await session.execute(
            text("select id, name from core.location where org_id = :org_id order by name"),
            {"org_id": str(ctx.org_id)},
        )
    ).mappings().all()
    return {
        "locais": [{"id": str(r["id"]), "name": r["name"]} for r in locais],
        "produtos": await _produtos_vinculados(session, ctx.org_id),
    }


# ----------------------------------------------------------------- aprovação


class ItemConferido(BaseModel):
    linha: int = Field(ge=1)
    codigo: str | None = Field(default=None, max_length=60)
    descricao: str = Field(min_length=1, max_length=200)
    quantidade: Decimal = Field(gt=0)
    unidade: str | None = Field(default=None, max_length=10)
    valor_unitario: Decimal | None = Field(default=None, ge=0)
    valor_total: Decimal | None = Field(default=None, ge=0)
    product_id: uuid.UUID | None = None
    fator: Decimal = Field(default=Decimal(1), gt=0)
    ignorar: bool = False

    @model_validator(mode="after")
    def _vinculado_ou_ignorado(self) -> ItemConferido:
        if not self.ignorar and self.product_id is None:
            raise ValueError(f"item {self.linha}: ligue a um produto ou marque como ignorado")
        return self


class AprovarBody(BaseModel):
    chave: str
    origem: Literal["qrcode", "manual"]
    location_id: uuid.UUID
    numero: str | None = Field(default=None, max_length=20)
    serie: str | None = Field(default=None, max_length=5)
    emitido_em: datetime | None = None
    fornecedor_nome: str | None = Field(default=None, max_length=200)
    valor_total: Decimal | None = Field(default=None, ge=0)
    itens: list[ItemConferido] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def _coerente(self) -> AprovarBody:
        linhas = [i.linha for i in self.itens]
        if len(set(linhas)) != len(linhas):
            raise ValueError("linhas repetidas no cupom")
        if all(i.ignorar for i in self.itens):
            raise ValueError("todos os itens estão ignorados — nada a carregar")
        return self


def _somar_por_produto(itens: list[ItemConferido]) -> list[RestockItem]:
    """O mesmo produto pode vir em mais de uma linha; a VMpay recebe um ajuste por item."""
    total: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    for i in itens:
        if not i.ignorar:
            total[i.product_id] += i.quantidade * i.fator
    return [RestockItem(product_id=p, quantity=q) for p, q in total.items()]


async def _gravar_cupom(
    session: AsyncSession, ctx: OrgContext, body: AprovarBody, chave: str, cnpj: str
) -> uuid.UUID:
    receipt_id = (
        await session.execute(
            text(
                """
                insert into core.purchase_receipt
                    (org_id, location_id, access_key, number, series, issued_at,
                     supplier_tax_id, supplier_name, total, source, approved_by)
                values (:org_id, :location_id, :chave, :numero, :serie, :emitido_em,
                        :cnpj, :nome, :total, cast(:origem as core.receipt_source), :actor)
                returning id
                """
            ),
            {
                "org_id": str(ctx.org_id),
                "location_id": str(body.location_id),
                "chave": chave,
                "numero": body.numero,
                "serie": body.serie,
                "emitido_em": body.emitido_em,
                "cnpj": cnpj,
                "nome": body.fornecedor_nome,
                "total": body.valor_total,
                "origem": body.origem,
                "actor": str(ctx.principal.user_id),
            },
        )
    ).first()[0]

    for i in body.itens:
        await session.execute(
            text(
                """
                insert into core.purchase_receipt_item
                    (receipt_id, line, supplier_code, description, quantity, unit,
                     unit_price, total, product_id, factor, ignored)
                values (:receipt_id, :linha, :codigo, :descricao, :quantidade, :unidade,
                        :valor_unitario, :valor_total, :product_id, :fator, :ignorar)
                """
            ),
            {
                "receipt_id": str(receipt_id),
                **i.model_dump(exclude={"product_id"}),
                "product_id": str(i.product_id) if i.product_id else None,
            },
        )
        if i.codigo:
            # O vínculo vale para a próxima compra deste fornecedor.
            await session.execute(
                text(
                    """
                    insert into core.supplier_product_map
                        (org_id, supplier_tax_id, supplier_code, product_id, factor, ignored)
                    values (:org_id, :cnpj, :codigo, :product_id, :fator, :ignorar)
                    on conflict (org_id, supplier_tax_id, supplier_code) do update
                       set product_id = excluded.product_id,
                           factor = excluded.factor,
                           ignored = excluded.ignored,
                           updated_at = now()
                    """
                ),
                {
                    "org_id": str(ctx.org_id),
                    "cnpj": cnpj,
                    "codigo": i.codigo,
                    "product_id": str(i.product_id) if i.product_id else None,
                    "fator": i.fator,
                    "ignorar": i.ignorar,
                },
            )
    return receipt_id


async def _marcar(
    session: AsyncSession, receipt_id: uuid.UUID, status: str, action_id: int
) -> None:
    await session.execute(
        text(
            """
            update core.purchase_receipt
               set status = cast(:status as core.receipt_status), action_id = :action_id
             where id = :id
            """
        ),
        {"status": status, "action_id": action_id, "id": str(receipt_id)},
    )
    await session.commit()


@router.post("/aprovar", status_code=201)
async def aprovar(body: AprovarBody, ctx: AdminCtx, session: Session) -> dict:
    try:
        chave = nfce.validar_chave(body.chave)
    except nfce.NFCeError as exc:
        raise HTTPException(422, str(exc)) from None
    cnpj = fornecedor_da_chave(chave)

    existente = await _carga_existente(session, ctx.org_id, chave)
    if existente and existente["status"] == "approved":
        raise HTTPException(409, "este cupom já foi carregado no estoque")
    if existente and existente["status"] == "pending":
        # Pendente = aprovação em curso ou processo que morreu no meio. O
        # action_log diz qual; recarregar às cegas poderia dobrar o estoque.
        raise HTTPException(409, "este cupom tem uma carga em andamento — confira o histórico de ações")

    plano = await preparar_restock(
        session, ctx, RestockBody(location_id=body.location_id, items=_somar_por_produto(body.itens))
    )

    if existente:  # tentativa anterior recusada pela VMpay: substitui
        await session.execute(
            text("delete from core.purchase_receipt where id = :id"), {"id": str(existente["id"])}
        )
    try:
        receipt_id = await _gravar_cupom(session, ctx, body, chave, cnpj)
    except IntegrityError:
        # Duas aprovações simultâneas do mesmo cupom: a unique decide.
        await session.rollback()
        raise HTTPException(409, "este cupom acabou de ser carregado por outra pessoa") from None

    try:
        # O commit do action_log pendente leva o cupom e o de-para junto.
        resultado = await executar_restock(
            session,
            ctx,
            plano,
            action="picklist.approve",
            extra_params={"receipt_id": str(receipt_id), "chave": chave},
        )
    except RestockRecusado as exc:
        await _marcar(session, receipt_id, "error", exc.action_id)
        raise

    await _marcar(session, receipt_id, "approved", resultado["action_id"])
    return {"receipt_id": str(receipt_id), **resultado}


# ------------------------------------------------------------------ histórico


@router.get("")
async def historico(ctx: AdminCtx, session: Session, limit: int = 30) -> list[dict]:
    rows = (
        await session.execute(
            text(
                """
                select r.id, r.access_key, r.number, r.supplier_name, r.total,
                       r.status, r.source, r.created_at, l.name as location_name,
                       count(i.*) filter (where not i.ignored) as itens
                  from core.purchase_receipt r
                  join core.location l on l.id = r.location_id
                  left join core.purchase_receipt_item i on i.receipt_id = r.id
                 where r.org_id = :org_id
                 group by r.id, l.name
                 order by r.created_at desc
                 limit :limit
                """
            ),
            {"org_id": str(ctx.org_id), "limit": max(1, min(limit, 200))},
        )
    ).mappings().all()
    return [
        {**dict(r), "id": str(r["id"]), "created_at": r["created_at"].isoformat()} for r in rows
    ]
