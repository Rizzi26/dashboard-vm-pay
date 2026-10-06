"""Contas VMpay do lojista: cada mercadinho dele pode ser uma conta à parte.

Adicionar = colar o token da conta. A API testa o token na VMpay ANTES de
aceitar, recusa conta já conectada, guarda o token cifrado no Supabase Vault
(core.integration só guarda o id do segredo) e dispara a primeira importação.
O token nunca volta para a tela nem para log.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayAuthError, VMpayClient, VMpayError
from vmpay.client import PRODUCTION
from vmpay.redact import redact

from ..audit import registrar
from ..auth import OrgContext, require_role
from ..db import get_session
from ..ingest import sincronizar_conta
from ..sync_core import eh_conta_original
from ..transform import installations_map

log = logging.getLogger(__name__)

router = APIRouter(prefix="/orgs/{org}/contas", tags=["contas VMpay"])

Session = Annotated[AsyncSession, Depends(get_session)]
MasterCtx = Annotated[OrgContext, Depends(require_role("master"))]


def _limpar(token: str) -> str:
    # Token colado do email/painel costuma vir com espaço, quebra ou aspas.
    return token.strip().strip('"').strip("'").strip()


class NovaConta(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    token: str = Field(min_length=10, max_length=300)

    @field_validator("token")
    @classmethod
    def _token(cls, v: str) -> str:
        v = _limpar(v)
        if any(c.isspace() for c in v):
            raise ValueError("o token não pode ter espaços")
        return v


class MudarConta(BaseModel):
    nome: str | None = Field(default=None, min_length=1, max_length=80)
    ativo: bool | None = None
    token: str | None = Field(default=None, min_length=10, max_length=300)


async def maquinas_da_conta(token: str) -> set[int]:
    """Testa o token na VMpay e devolve as máquinas que a conta enxerga.

    401/403 vira 422 com mensagem para o lojista: token errado é o erro mais
    comum (copiou pela metade, conta errada, token de homologação).
    """
    base = os.environ.get("VMPAY_BASE") or PRODUCTION
    try:
        async with VMpayClient(token, base_url=base, max_retries=1) as client:
            instalacoes = [p async for p in client.paginate("installations")]
    except VMpayAuthError:
        raise HTTPException(
            422, "a VMpay recusou este token — confira se copiou inteiro e se é desta conta"
        ) from None
    except VMpayError as exc:
        raise HTTPException(502, f"a VMpay não respondeu: {redact(str(exc))}") from None
    return set(installations_map(instalacoes).keys())


async def _maquinas_da_integracao(session: AsyncSession, conta_id: uuid.UUID) -> set[int]:
    rows = (
        await session.execute(
            text(
                """
                select distinct machine_id from core.location_link
                 where integration_id = :id and machine_id is not null
                """
            ),
            {"id": str(conta_id)},
        )
    ).mappings().all()
    return {int(r["machine_id"]) for r in rows}


async def _maquinas_conectadas(session: AsyncSession, org_id: uuid.UUID) -> dict[int, str]:
    rows = (
        await session.execute(
            text(
                """
                select ll.machine_id, l.name
                  from core.location_link ll
                  join core.location l on l.id = ll.location_id
                  join core.integration i on i.id = ll.integration_id and i.active
                 where l.org_id = :org_id and ll.machine_id is not null
                """
            ),
            {"org_id": str(org_id)},
        )
    ).mappings().all()
    return {int(r["machine_id"]): r["name"] for r in rows}


@router.get("")
async def listar(ctx: MasterCtx, session: Session) -> list[dict]:
    rows = (
        await session.execute(
            text(
                """
                select i.id, i.nome, i.active, i.created_at,
                       (i.config ? 'secret_id') as no_cofre,
                       coalesce(i.config->>'cursor', '') = 'legado' as legado,
                       coalesce(array_agg(distinct l.name) filter (where l.name is not null), '{}') as lojas,
                       -- Toda leitura grava o saldo; o cursor de vendas, não
                       -- (loja sem venda nunca o grava e ficaria "importando").
                       max(b.updated_at) as lida
                  from core.integration i
                  left join core.location_link ll on ll.integration_id = i.id
                  left join core.location l on l.id = ll.location_id
                  left join core.stock_balance b on b.location_id = l.id
                 where i.org_id = :org_id and i.kind = 'vmpay'
                 group by i.id
                 order by i.created_at
                """
            ),
            {"org_id": str(ctx.org_id)},
        )
    ).mappings().all()
    cursores = (
        await session.execute(text("select resource, last_error from vmpay.sync_cursor"))
    ).mappings().all()

    def erro_de(conta_id: str, principal: bool) -> str | None:
        # Conta principal usa a chave de sempre ("vends"); as outras, "vends@<id>".
        erros = [
            c["last_error"] for c in cursores
            if c["last_error"]
            and ("@" not in c["resource"] if principal else c["resource"].endswith(f"@{conta_id}"))
        ]
        return erros[0] if erros else None

    return [
        {
            "id": str(r["id"]),
            "nome": r["nome"] or "Conta VMpay",
            "ativa": r["active"],
            "principal": (not r["no_cofre"]) or r["legado"],
            # A conta principal começa com o token em variável de ambiente; a
            # tela oferece movê-lo para o cofre (trocar token).
            "token_no_cofre": r["no_cofre"],
            "lojas": list(r["lojas"]),
            "criada_em": r["created_at"].isoformat(),
            "ultima_leitura": r["lida"].isoformat() if r["lida"] else None,
            "erro": erro_de(str(r["id"]), (not r["no_cofre"]) or r["legado"]),
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def adicionar(
    body: NovaConta, ctx: MasterCtx, session: Session, background: BackgroundTasks
) -> dict:
    maquinas = await maquinas_da_conta(body.token)
    repetidas = {m: nome for m, nome in (await _maquinas_conectadas(session, ctx.org_id)).items() if m in maquinas}
    if repetidas:
        raise HTTPException(
            409, f"essa conta já está conectada — é a loja {', '.join(sorted(set(repetidas.values())))}"
        )

    conta_id = uuid.uuid4()
    secret_id = await session.scalar(
        text("select vault.create_secret(:token, :nome, :descricao)"),
        {
            "token": body.token,
            # Nome único no cofre; descrição para quem abrir o painel do Supabase.
            "nome": f"vmpay:{ctx.org_slug}:{conta_id}",
            "descricao": f"Token da conta VMpay '{body.nome}' ({ctx.org_slug})",
        },
    )
    await session.execute(
        text(
            """
            insert into core.integration (id, org_id, kind, config, active, nome, created_by)
            values (:id, :org_id, 'vmpay', cast(:config as jsonb), true, :nome, :por)
            """
        ),
        {
            "id": str(conta_id),
            "org_id": str(ctx.org_id),
            "config": json.dumps({"secret_id": str(secret_id)}),
            "nome": body.nome,
            "por": str(ctx.principal.user_id),
        },
    )
    await registrar(
        session, ctx, "contas.adicionar",
        {"conta": str(conta_id), "nome": body.nome, "maquinas": len(maquinas)},
        commit=False,
    )
    await session.commit()  # cofre + integração + auditoria: tudo ou nada

    background.add_task(sincronizar_conta, conta_id)
    return {"id": str(conta_id), "nome": body.nome, "maquinas": len(maquinas), "importando": True}


@router.patch("/{conta_id}")
async def mudar(conta_id: uuid.UUID, body: MudarConta, ctx: MasterCtx, session: Session) -> dict:
    conta = (
        await session.execute(
            text(
                """
                select id, nome, active, config from core.integration
                 where id = :id and org_id = :org_id and kind = 'vmpay'
                """
            ),
            {"id": str(conta_id), "org_id": str(ctx.org_id)},
        )
    ).mappings().first()
    if conta is None:
        raise HTTPException(404, "conta não encontrada nesta organização")
    config = conta["config"] or {}
    secret_id = config.get("secret_id")
    if eh_conta_original(config) and body.ativo is False:
        # Desligar a principal pararia a ingestão que já está em produção.
        raise HTTPException(409, "a conta principal não pode ser desativada pelo painel")

    mudancas: dict = {}
    if body.token:
        token = _limpar(body.token)
        novas = await maquinas_da_conta(token)  # token novo também passa pelo teste
        # Trocar token é da MESMA conta: o token novo tem de enxergar as
        # máquinas que esta conta já tem. Senão é token de outra loja colado
        # no lugar errado — e a conta passaria a ler outra loja em silêncio.
        atuais = await _maquinas_da_integracao(session, conta_id)
        if atuais and not (atuais & novas):
            raise HTTPException(
                409, "esse token é de outra conta VMpay — ele não enxerga as máquinas desta loja"
            )
        if secret_id:
            await session.execute(
                text("select vault.update_secret(cast(:id as uuid), :token)"),
                {"id": str(secret_id), "token": token},
            )
        else:
            # Conta principal saindo da env var para o cofre. "cursor: legado"
            # mantém a chave de cursor de sempre: nada de vendas é reprocessado.
            secret_id = await session.scalar(
                text("select vault.create_secret(:token, :nome, :descricao)"),
                {
                    "token": token,
                    "nome": f"vmpay:{ctx.org_slug}:{conta_id}",
                    "descricao": f"Token da conta VMpay principal ({ctx.org_slug})",
                },
            )
            await session.execute(
                text("update core.integration set config = cast(:config as jsonb) where id = :id"),
                {
                    "config": json.dumps({"secret_id": str(secret_id), "cursor": "legado"}),
                    "id": str(conta_id),
                },
            )
            mudancas["cofre"] = "token movido da variável de ambiente para o cofre"
        mudancas["token"] = "trocado"
    if body.nome is not None:
        mudancas["nome"] = body.nome
    if body.ativo is not None:
        mudancas["ativa"] = body.ativo
    await session.execute(
        text(
            """
            update core.integration
               set nome = coalesce(:nome, nome), active = coalesce(:ativo, active)
             where id = :id
            """
        ),
        {"nome": body.nome, "ativo": body.ativo, "id": str(conta_id)},
    )
    await registrar(session, ctx, "contas.alterar", {"conta": str(conta_id), **mudancas}, commit=False)
    await session.commit()
    return {"id": str(conta_id), **mudancas}
