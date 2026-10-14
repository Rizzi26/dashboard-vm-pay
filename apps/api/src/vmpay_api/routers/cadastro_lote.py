"""Cadastro de produtos em lote, já entrando na prateleira da loja.

Modelo → prévia → aplicar, como o preço em lote. A diferença é que aqui não
dá para ser tudo ou nada: a VMpay cria produto um por um. Então cada produto
criado é gravado (no core e no product_link) assim que a VMpay aceita, e o
resultado volta por linha. A entrada na prateleira é um PATCH só no
planograma da loja com todos os que chegaram até ali; se ela falhar, os
produtos ficam no cadastro e subir a mesma planilha de novo só os inclui na
prateleira (a prévia reconhece pelo código de barras).
"""

from __future__ import annotations

import csv
import difflib
import io
import json
import re
import unicodedata
import uuid
from collections import Counter
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayError
from vmpay.redact import redact

from ..audit import registrar
from ..auth import OrgContext, require_role
from ..config import settings
from ..connector import PlanogramView
from ..db import get_session
from ..planilha import PlanilhaInvalida, linhas_do_csv, ler_numero
from ..planilha_precos import PRECO_MAXIMO, formatar_preco
from . import stock as estoque

router = APIRouter(prefix="/orgs/{org}/products/lote", tags=["produtos"])

Session = Annotated[AsyncSession, Depends(get_session)]
AdminCtx = Annotated[OrgContext, Depends(require_role("admin"))]

COLUNAS = [
    "nome",
    "codigo_barras",
    "preco",
    "fabricante",
    "categoria",
    "categoria_abastecimento",
    "capacidade",
    "nivel_ideal",
    "nivel_alerta",
]

#: A VMpay cria um produto por requisição e serve devagar: mais que isso numa
#: planilha deixa o operador minutos olhando a tela.
MAX_PRODUTOS = 100

#: Sem planograma de referência (loja vazia), os níveis da prateleira nascem assim.
PADRAO_SEM_REFERENCIA = {"capacidade": 100, "nivel_ideal": 20, "nivel_alerta": 3}

# O Excel transforma 7896002110983 em "7,89600E+12" ao abrir o CSV.
_NOTACAO_CIENTIFICA = re.compile(r"^\d+([.,]\d+)?[eE][+-]?\d+$")

REFS = (
    ("fabricante", "fabricantes"),
    ("categoria", "categorias"),
    ("categoria_abastecimento", "categorias_abastecimento"),
)


def _normalizado(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return " ".join(sem_acento.upper().split())


def _codigo(texto: str) -> str:
    return "".join(c for c in texto if c.isdigit())


def _ean_valido(codigo: str) -> bool:
    """Dígito verificador de EAN-8/UPC-12/EAN-13/GTIN-14. Outros tamanhos
    (código interno da loja) não têm regra — passam."""
    if len(codigo) not in (8, 12, 13, 14):
        return True
    corpo, verificador = codigo[:-1], int(codigo[-1])
    soma = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(corpo)))
    return (10 - soma % 10) % 10 == verificador


def _padroes(view: PlanogramView) -> dict[str, float]:
    """Os níveis mais comuns na prateleira da loja — o que o operador já usa."""
    trincas = Counter(
        (i.get("capacity"), i.get("par_level"), i.get("alert_level"))
        for i in view.items
        if i.get("type") == "Coil" and i.get("capacity") is not None
    )
    if not trincas:
        return dict(PADRAO_SEM_REFERENCIA)
    cap, ideal, alerta = trincas.most_common(1)[0][0]
    return {
        "capacidade": float(cap),
        "nivel_ideal": float(ideal or 0),
        "nivel_alerta": float(alerta or 0),
    }


async def _contexto(session: AsyncSession, ctx: OrgContext, location_id: uuid.UUID) -> tuple[dict, str]:
    target = await estoque._load_target(session, ctx.org_id, location_id)
    token = await estoque._token_ou_502(session, target["config"])
    await session.commit()  # fecha a leitura do cofre antes da rede
    return target, token


async def _catalogo_por_codigo(session: AsyncSession, integration_id: Any) -> dict[str, dict]:
    """Produtos da conta VMpay da loja, pelo código de barras (só dígitos, sem zero à esquerda)."""
    rows = (
        await session.execute(
            text(
                """
                select p.id, p.name, p.barcode, pl.external_id
                  from core.product p
                  join core.product_link pl on pl.product_id = p.id
                 where pl.integration_id = :integration_id and p.barcode is not null
                """
            ),
            {"integration_id": str(integration_id)},
        )
    ).mappings().all()
    return {_codigo(r["barcode"]).lstrip("0"): dict(r) for r in rows if _codigo(r["barcode"])}


# --------------------------------------------------------------- planilhas


def _csv(cabecalho: list[str], linhas: list[list[Any]], nome: str) -> Response:
    buffer = io.StringIO()
    buffer.write("﻿")  # sem BOM o Excel abre o UTF-8 como Latin-1
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(cabecalho)
    writer.writerows(linhas)
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )


@router.get("/modelo.csv")
async def modelo(ctx: AdminCtx) -> Response:
    """Planilha em branco: uma linha por produto novo."""
    return _csv(COLUNAS, [], "cadastro.csv")


@router.get("/referencias.csv")
async def referencias(ctx: AdminCtx, session: Session, location_id: Annotated[uuid.UUID, Query()]) -> Response:
    """Fabricantes e categorias válidos da conta VMpay da loja, para copiar o nome."""
    target, token = await _contexto(session, ctx, location_id)
    refs = await _refs(target, token)
    linhas = [[coluna, r["nome"]] for coluna, chave in REFS for r in sorted(refs[chave], key=lambda r: r["nome"])]
    return _csv(["coluna", "nome"], linhas, "referencias.csv")


async def _refs(target: dict, token: str) -> dict[str, list[dict]]:
    try:
        connector = estoque.get_connector(target["config"], token)
        async with connector.client:
            return await connector.product_refs()
    except VMpayError as exc:
        raise HTTPException(502, f"a VMpay não respondeu fabricantes/categorias: {redact(str(exc))}") from None


async def _planograma(target: dict, token: str) -> PlanogramView:
    try:
        connector = estoque.get_connector(target["config"], token)
        async with connector.client:
            return await connector.current_planogram(target["machine_id"], target["installation_id"])
    except VMpayError as exc:
        raise HTTPException(502, f"não deu para ler a prateleira na VMpay: {redact(str(exc))}") from None


# -------------------------------------------------------------------- prévia


class PreviaBody(BaseModel):
    location_id: uuid.UUID
    conteudo: str = Field(max_length=2_000_000)


def _nivel(bruto: str, padrao: float, nome: str) -> float:
    if not bruto:
        return padrao
    valor = ler_numero(bruto, casas=0, nome=nome)
    if valor < 0:
        raise ValueError(f"{nome} não pode ser negativo")
    return float(valor)


@router.post("/previa")
async def previa(body: PreviaBody, ctx: AdminCtx, session: Session) -> dict:
    """O que a planilha cadastraria e incluiria na prateleira. Não escreve nada."""
    try:
        linhas = list(linhas_do_csv(body.conteudo, exige=("nome", "preco")))
    except PlanilhaInvalida as exc:
        raise HTTPException(422, str(exc)) from None
    if len(linhas) > MAX_PRODUTOS:
        raise HTTPException(422, f"{len(linhas)} produtos numa planilha; o limite é {MAX_PRODUTOS} por vez")

    target, token = await _contexto(session, ctx, body.location_id)
    catalogo = await _catalogo_por_codigo(session, target["integration_id"])
    refs = await _refs(target, token)
    view = await _planograma(target, token)
    padroes = _padroes(view)
    na_prateleira = {i["good_id"] for i in view.items}
    por_nome = {chave: {_normalizado(r["nome"]): r for r in refs[chave]} for _, chave in REFS}

    vistos: Counter[str] = Counter(_codigo(c.get("codigo_barras", "")).lstrip("0") for _, c in linhas)
    itens: list[dict[str, Any]] = []
    erros: list[dict[str, Any]] = []
    for numero, campos in linhas:
        nome = campos["nome"]
        try:
            item = _linha(campos, padroes, por_nome, refs, catalogo, na_prateleira, vistos)
        except ValueError as exc:
            erros.append({"linha": numero, "nome": nome or None, "motivo": str(exc)})
            continue
        itens.append({"linha": numero, **item})

    return {
        "location_id": str(body.location_id),
        "loja": target["name"],
        "padroes": padroes,
        "itens": itens,
        "erros": erros,
        "resumo": {
            "criar": sum(1 for i in itens if i["acao"] == "criar"),
            "incluir": sum(1 for i in itens if i["acao"] == "incluir"),
            "erros": len(erros),
        },
        "escrita_liberada": settings().vmpay_allow_writes,
    }


def _linha(
    campos: dict[str, str],
    padroes: dict[str, float],
    por_nome: dict[str, dict[str, dict]],
    refs: dict[str, list[dict]],
    catalogo: dict[str, dict],
    na_prateleira: set[int],
    vistos: Counter[str],
) -> dict[str, Any]:
    """Uma linha válida vira item; qualquer problema levanta ValueError com o motivo."""
    nome = campos["nome"]
    if not nome:
        raise ValueError("nome vazio")
    if len(nome) > 200:
        raise ValueError("nome com mais de 200 caracteres")

    bruto_codigo = campos.get("codigo_barras", "")
    codigo = _codigo(bruto_codigo)
    if _NOTACAO_CIENTIFICA.match(bruto_codigo.replace(" ", "")):
        raise ValueError(
            f"código '{bruto_codigo}' foi estragado pelo Excel (notação científica) — formate a coluna como texto"
        )
    if codigo and not _ean_valido(codigo):
        raise ValueError(f"código {bruto_codigo} com dígito verificador errado — confira a digitação")
    if codigo and vistos[codigo.lstrip("0")] > 1:
        raise ValueError(f"código {bruto_codigo} aparece em mais de uma linha")

    preco = ler_numero(campos["preco"], casas=2, nome="preço") if campos["preco"] else None
    if preco is None or preco <= 0:
        raise ValueError("preço obrigatório e maior que zero — é o preço de venda na prateleira")
    if preco > PRECO_MAXIMO:
        raise ValueError(f"preço R$ {formatar_preco(preco)} parece engano (vírgula esquecida?)")

    capacidade = _nivel(campos.get("capacidade", ""), padroes["capacidade"], "capacidade")
    ideal = _nivel(campos.get("nivel_ideal", ""), padroes["nivel_ideal"], "nível ideal")
    alerta = _nivel(campos.get("nivel_alerta", ""), padroes["nivel_alerta"], "nível de alerta")
    if ideal > capacidade:
        raise ValueError(f"nível ideal ({ideal:g}) maior que a capacidade ({capacidade:g})")
    if alerta > ideal:
        raise ValueError(f"nível de alerta ({alerta:g}) maior que o nível ideal ({ideal:g})")
    niveis = {"capacidade": capacidade, "nivel_ideal": ideal, "nivel_alerta": alerta}

    existente = catalogo.get(codigo.lstrip("0")) if codigo else None
    if existente is not None:
        if int(existente["external_id"]) in na_prateleira:
            raise ValueError(f"já cadastrado e já na prateleira desta loja ({existente['name']})")
        return {
            "acao": "incluir",
            "nome": existente["name"],
            "codigo_barras": existente["barcode"],
            "product_id": str(existente["id"]),
            "preco": float(preco),
            **niveis,
            "avisos": [f"já existe no cadastro como \"{existente['name']}\" — só entra na prateleira"],
        }

    resolvidos: dict[str, dict] = {}
    for coluna, chave in REFS:
        valor = campos.get(coluna, "")
        if chave == "categorias_abastecimento" and len(refs[chave]) <= 1:
            # A VMpay só exige quando a conta usa mais de uma: com uma, é ela;
            # sem nenhuma (ou sem permissão de ler a lista), vai sem o campo.
            if not valor and refs[chave]:
                resolvidos[coluna] = {"id": refs[chave][0]["id"], "nome": refs[chave][0]["nome"]}
                continue
            if not valor:
                continue
        if not valor:
            raise ValueError(f"coluna {coluna} vazia — a VMpay exige")
        achado = por_nome[chave].get(_normalizado(valor))
        if achado is None:
            parecido = difflib.get_close_matches(_normalizado(valor), list(por_nome[chave]), n=1, cutoff=0.6)
            dica = f" — seria \"{por_nome[chave][parecido[0]]['nome']}\"?" if parecido else " — veja a planilha de referências"
            raise ValueError(f"{coluna} \"{valor}\" não existe nesta conta{dica}")
        resolvidos[coluna] = {"id": achado["id"], "nome": achado["nome"]}

    return {
        "acao": "criar",
        "nome": nome,
        "codigo_barras": bruto_codigo or None,
        "product_id": None,
        "preco": float(preco),
        **niveis,
        **resolvidos,
        "avisos": [] if codigo else ["sem código de barras"],
    }


# ------------------------------------------------------------------- aplicar


class Ref(BaseModel):
    id: int
    nome: str


class ItemLote(BaseModel):
    linha: int
    acao: str = Field(pattern="^(criar|incluir)$")
    nome: str = Field(min_length=1, max_length=200)
    codigo_barras: str | None = Field(default=None, max_length=64)
    product_id: uuid.UUID | None = None
    preco: Decimal = Field(gt=0, le=PRECO_MAXIMO)
    capacidade: float = Field(ge=0)
    nivel_ideal: float = Field(ge=0)
    nivel_alerta: float = Field(ge=0)
    fabricante: Ref | None = None
    categoria: Ref | None = None
    categoria_abastecimento: Ref | None = None


class AplicarBody(BaseModel):
    location_id: uuid.UUID
    itens: list[ItemLote] = Field(min_length=1, max_length=MAX_PRODUTOS)


@router.post("/aplicar")
async def aplicar(body: AplicarBody, ctx: AdminCtx, session: Session) -> dict:
    """Cria o que é novo (um por um) e põe tudo na prateleira (um PATCH só)."""
    estoque.require_writes_enabled()
    for item in body.itens:
        if item.acao == "criar" and not (item.fabricante and item.categoria):
            raise HTTPException(422, f"linha {item.linha}: faltam fabricante/categoria")
        if item.acao == "incluir" and item.product_id is None:
            raise HTTPException(422, f"linha {item.linha}: falta o produto a incluir")

    target, token = await _contexto(session, ctx, body.location_id)
    catalogo = await _catalogo_por_codigo(session, target["integration_id"])
    view = await _planograma(target, token)
    na_prateleira = {i["good_id"] for i in view.items}

    action_id = await estoque._open_action(
        session,
        ctx,
        "product.batch_create",
        {"location_id": str(body.location_id), "machine_id": target["machine_id"]},
        {"itens": [i.model_dump(mode="json") for i in body.itens]},
    )

    resultado: dict[int, dict[str, Any]] = {}
    para_prateleira: list[tuple[ItemLote, uuid.UUID, int]] = []
    connector = estoque.get_connector(target["config"], token)
    async with connector.client:
        for item in body.itens:
            codigo = _codigo(item.codigo_barras or "").lstrip("0")
            existente = catalogo.get(codigo) if codigo else None
            if item.acao == "incluir" or existente is not None:
                # Criado por outra planilha/aba entre a prévia e o clique: não duplica.
                product_id, good_id = await _produto_existente(session, target, item, existente)
                if good_id is None:
                    resultado[item.linha] = {"status": "erro", "motivo": "produto sem vínculo com a conta da loja"}
                    continue
                resultado[item.linha] = {"status": "ja_cadastrado", "product_id": str(product_id)}
            else:
                try:
                    criado = await connector.create_product(_campos_vmpay(item))
                except VMpayError as exc:
                    resultado[item.linha] = {"status": "erro", "motivo": f"a VMpay recusou: {redact(str(exc))}"}
                    continue
                product_id, good_id = await _espelhar(session, ctx, target, item, criado)
                resultado[item.linha] = {"status": "criado", "product_id": str(product_id)}
            if good_id in na_prateleira:
                resultado[item.linha]["prateleira"] = "ja_estava"
                continue
            para_prateleira.append((item, product_id, good_id))

        erro_prateleira: str | None = None
        if para_prateleira:
            try:
                await connector.incluir_no_planograma(
                    target["machine_id"],
                    target["installation_id"],
                    [
                        {
                            "good_id": good_id,
                            "preco": float(item.preco),
                            "capacidade": item.capacidade,
                            "nivel_ideal": item.nivel_ideal,
                            "nivel_alerta": item.nivel_alerta,
                        }
                        for item, _, good_id in para_prateleira
                    ],
                    view=view,
                )
            except VMpayError as exc:
                erro_prateleira = redact(str(exc))

    for item, product_id, _ in para_prateleira:
        if erro_prateleira:
            resultado[item.linha]["prateleira"] = "erro"
            continue
        resultado[item.linha]["prateleira"] = "incluido"
        # Já aparece na Prateleira como zerado; o próximo snapshot confirma.
        await session.execute(
            text(
                """
                insert into core.stock_balance (location_id, product_id, quantity, price, updated_at)
                values (:location_id, :product_id, 0, :price, now())
                on conflict (location_id, product_id) do nothing
                """
            ),
            {"location_id": str(body.location_id), "product_id": str(product_id), "price": item.preco},
        )

    falhas = [linha for linha, r in resultado.items() if r["status"] == "erro"]
    problemas = []
    if falhas:
        problemas.append(f"{len(falhas)} produto(s) recusados")
    if erro_prateleira:
        problemas.append(f"prateleira recusada: {erro_prateleira}")
    await estoque._close_action(session, action_id, error="; ".join(problemas) or None)
    await registrar(
        session, ctx, "produtos.cadastro_lote",
        {"location_id": str(body.location_id), "itens": len(body.itens), "falhas": len(falhas)},
    )
    return {
        "action_id": action_id,
        "erro_prateleira": erro_prateleira,
        "linhas": [{"linha": linha, **r} for linha, r in sorted(resultado.items())],
        "resumo": {
            "criados": sum(1 for r in resultado.values() if r["status"] == "criado"),
            "na_prateleira": sum(1 for r in resultado.values() if r.get("prateleira") == "incluido"),
            "erros": len(falhas),
        },
    }


def _campos_vmpay(item: ItemLote) -> dict[str, Any]:
    campos: dict[str, Any] = {
        "name": item.nome,
        "manufacturer_id": item.fabricante.id,
        "category_id": item.categoria.id,
        "default_price": float(item.preco),
    }
    if item.categoria_abastecimento is not None:
        campos["supply_category_id"] = item.categoria_abastecimento.id
    if item.codigo_barras:
        campos["barcode"] = item.codigo_barras
    return campos


async def _espelhar(
    session: AsyncSession, ctx: OrgContext, target: dict, item: ItemLote, criado: Any
) -> tuple[uuid.UUID, int]:
    """core.product + product_link do produto que a VMpay acabou de aceitar.

    Commit na hora: se o lote cair no meio, o que a VMpay já criou não fica
    órfão aqui — a próxima planilha o reconhece pelo código e só o inclui.
    """
    good_id = int(criado["id"])
    product_id = (
        await session.execute(
            text(
                """
                insert into core.product (org_id, name, barcode, unit_price)
                values (:org_id, :name, :barcode, :price)
                returning id
                """
            ),
            {"org_id": str(ctx.org_id), "name": item.nome, "barcode": item.codigo_barras, "price": item.preco},
        )
    ).first()[0]
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
            "product_id": str(product_id),
            "integration_id": str(target["integration_id"]),
            "external_id": str(good_id),
            "raw": json.dumps(criado),
        },
    )
    await session.commit()
    return product_id, good_id


async def _produto_existente(
    session: AsyncSession, target: dict, item: ItemLote, existente: dict | None
) -> tuple[uuid.UUID, int | None]:
    if existente is not None:
        return existente["id"], int(existente["external_id"])
    row = (
        await session.execute(
            text(
                """
                select external_id from core.product_link
                 where product_id = :product_id and integration_id = :integration_id
                """
            ),
            {"product_id": str(item.product_id), "integration_id": str(target["integration_id"])},
        )
    ).first()
    return item.product_id, (int(row[0]) if row else None)
