"""Sincronização snapshot: catálogo e estoque da VMpay -> schema core.

Diferente da ingestão de vendas (incremental por cursor), catálogo e saldo não
têm cursor na API — cada rodada pagina tudo e faz upsert. Na escala da PoC
(centenas de produtos, per_page=1000) isso é uma ou duas requisições por
recurso.

Dirigido por core.integration: o cron itera as integrações ativas, resolve o
token pelo NOME de env var guardado em config (nunca o valor), e sincroniza
cada organização. Sem integração cadastrada, não faz nada — o seed da PoC cria
a primeira.
"""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayClient, VMpayError
from vmpay.client import PRODUCTION
from vmpay.redact import redact

from . import models_core as core
from .transform import installations_map, location_external_id, map_balance, map_product

log = logging.getLogger("vmpay_api.sync_core")

DEFAULT_TOKEN_ENV = "VMPAY_INGEST_TOKEN"


@dataclass
class SnapshotReport:
    integration_id: str
    org_id: str
    products: int = 0
    locations: int = 0
    balances: int = 0
    stale_balances_removed: int = 0
    # "completo" ou "pulado" (atualização manual sem produto novo à vista).
    catalogo: str = "completo"
    error: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "integration": self.integration_id,
            "org": self.org_id,
            "produtos": self.products,
            "catalogo": self.catalogo,
            "locais": self.locations,
            "saldos": self.balances,
            "saldos_removidos": self.stale_balances_removed,
            "erro": self.error,
        }


def resolve_token(config: dict[str, Any]) -> str:
    """Token da conta ORIGINAL: o config aponta o NOME da env var.

    Conta com token no Vault (config.secret_id) não passa por aqui: cair no
    token da env var leria OUTRA conta em silêncio. Use token_da_conta().
    """
    if config.get("secret_id"):
        raise VMpayError("conta com token no cofre: resolva com token_da_conta()")
    env_name = config.get("token_env", DEFAULT_TOKEN_ENV)
    # strip: valor colado em dashboard costuma vir com quebra de linha, espaço
    # ou aspas junto — e a VMpay responde 401 sem dizer por quê.
    token = os.environ.get(env_name, "").strip().strip('"').strip("'")
    if not token:
        raise VMpayError(f"env var {env_name} (token da integração) não está definida")
    return token


async def token_da_conta(session: AsyncSession, config: dict[str, Any]) -> str:
    """Token de qualquer conta: Vault (contas do painel) ou env (a original).

    Quem chama faz commit/rollback logo depois, ANTES de ir à rede: a leitura
    do cofre abre transação, e transação ociosa esperando a VMpay é o que o
    pooler derruba (ver sync_integration).
    """
    secret_id = (config or {}).get("secret_id")
    if not secret_id:
        return resolve_token(config or {})
    token = await session.scalar(
        text("select decrypted_secret from vault.decrypted_secrets where id = cast(:id as uuid)"),
        {"id": str(secret_id)},
    )
    if not token:
        raise VMpayError("token da conta não encontrado no cofre (vault)")
    return token.strip()


def eh_conta_original(config: dict[str, Any]) -> bool:
    """A conta de antes das contas múltiplas — com o token na env var ou já
    migrado para o cofre (config.cursor == "legado"). Ela mantém o cursor de
    vendas de sempre e não pode ser desativada pelo painel."""
    config = config or {}
    return not config.get("secret_id") or config.get("cursor") == "legado"


#: Linhas por statement. O asyncpg limita a 32.767 parâmetros por query; com
#: ~10 colunas, 200 linhas usam ~2.000 — folga de uma ordem de grandeza. A
#: primeira ingestão real estourou o limite com um catálogo de 6.000+ produtos
#: num upsert só.
UPSERT_CHUNK = 200


async def _upsert(session: AsyncSession, table, rows: list[dict], keys: list[str]) -> None:
    if not rows:
        return
    for start in range(0, len(rows), UPSERT_CHUNK):
        chunk = rows[start : start + UPSERT_CHUNK]
        stmt = insert(table).values(chunk)
        updatable = {
            c.name: stmt.excluded[c.name]
            for c in table.__table__.columns
            if c.name not in keys and c.name not in ("created_at",)
        }
        await session.execute(
            stmt.on_conflict_do_update(index_elements=keys, set_=updatable)
        )


async def sync_products(
    client: VMpayClient, session: AsyncSession, integration: core.Integration
) -> tuple[int, dict[str, uuid.UUID]]:
    """Catálogo -> core.product + product_link.

    Devolve o mapa external_id -> product_id, que o sync de saldos usa para não
    reler os links.
    """
    known = {
        row.external_id: row.product_id
        for row in (
            await session.execute(
                select(core.ProductLink).where(
                    core.ProductLink.integration_id == integration.id
                )
            )
        ).scalars()
    }

    now = datetime.now(timezone.utc)
    products: list[dict] = []
    links: list[dict] = []
    count = 0
    async for payload in client.paginate("products"):
        count += 1
        external_id = str(payload["id"])
        product_id = known.get(external_id) or uuid.uuid4()
        known[external_id] = product_id
        products.append(
            {
                "id": product_id,
                "org_id": integration.org_id,
                "updated_at": now,
                **map_product(payload),
            }
        )
        links.append(
            {
                "integration_id": integration.id,
                "external_id": external_id,
                "product_id": product_id,
                "raw": payload,
                "synced_at": now,
            }
        )

    await _upsert(session, core.Product, products, ["id"])
    await _upsert(session, core.ProductLink, links, ["integration_id", "external_id"])
    return count, known


def _saldo_mudou(anterior: tuple | None, novo: dict) -> bool:
    """Compara o saldo do banco (Decimal) com o do relatório (float do JSON).

    A comparação é por valor numérico com 2 casas no preço — Decimal("6.9900")
    e 6.99 são o mesmo preço, não uma mudança.
    """
    if anterior is None:
        return True
    qtd_anterior, preco_anterior = anterior
    if float(qtd_anterior) != float(novo["quantity"]):
        return True
    de = None if preco_anterior is None else round(float(preco_anterior), 2)
    para = None if novo["price"] is None else round(float(novo["price"]), 2)
    return de != para


async def sync_stock(
    client: VMpayClient,
    session: AsyncSession,
    integration: core.Integration,
    product_by_external: dict[str, uuid.UUID],
) -> tuple[int, int, int]:
    """Instalações + saldos -> core.location(+link) + core.stock_balance."""
    installations = [p async for p in client.paginate("installations")]
    by_machine = installations_map(installations)

    known_locations = {
        row.external_id: row.location_id
        for row in (
            await session.execute(
                select(core.LocationLink).where(
                    core.LocationLink.integration_id == integration.id
                )
            )
        ).scalars()
    }

    now = datetime.now(timezone.utc)
    locations: dict[str, dict] = {}
    links: dict[str, dict] = {}
    balances: dict[tuple[uuid.UUID, uuid.UUID], dict] = {}
    skipped = 0

    async for payload in client.paginate("installation_stock_balances"):
        row = map_balance(payload)
        if row is None:
            skipped += 1
            continue
        installation = by_machine.get(row["machine_id"])
        product_id = product_by_external.get(str(row["good_id"]))
        if installation is None or product_id is None:
            # Máquina sem instalação ativa ou produto fora do catálogo: não há
            # onde pendurar o saldo. Contado e logado, nunca silencioso.
            skipped += 1
            continue
        external = location_external_id(row["machine_id"], installation["id"])
        location_id = known_locations.get(external) or uuid.uuid4()
        known_locations[external] = location_id
        locations[external] = {
            "id": location_id,
            "org_id": integration.org_id,
            "name": row["location_name"],
        }
        links[external] = {
            "integration_id": integration.id,
            "external_id": external,
            "location_id": location_id,
            "machine_id": row["machine_id"],
            "installation_id": installation["id"],
            "raw": {"installation": installation},
            "synced_at": now,
        }
        balances[(location_id, product_id)] = {
            "location_id": location_id,
            "product_id": product_id,
            "quantity": row["quantity"],
            # Unitário derivado do valor total do saldo (ver map_balance) —
            # produto pode nem ter preço padrão no catálogo (o da PoC não tem).
            "price": row["unit_price"],
            "updated_at": now,
        }

    # O saldo ANTERIOR é lido antes do upsert que o sobrescreve — é contra ele
    # que a foto histórica decide o que mudou.
    location_ids = list({b["location_id"] for b in balances.values()})
    anterior: dict[tuple, tuple] = {}
    primeira_foto = True
    if location_ids:
        primeira_foto = (
            await session.scalar(
                select(core.StockSnapshot.snapshot_at)
                .where(core.StockSnapshot.location_id.in_(location_ids))
                .limit(1)
            )
        ) is None
        anterior = {
            (r.location_id, r.product_id): (r.quantity, r.price)
            for r in (
                await session.execute(
                    select(core.StockBalance).where(
                        core.StockBalance.location_id.in_(location_ids)
                    )
                )
            ).scalars()
        }

    await _upsert(session, core.Location, list(locations.values()), ["id"])
    await _upsert(
        session, core.LocationLink, list(links.values()), ["integration_id", "external_id"]
    )
    await _upsert(
        session, core.StockBalance, list(balances.values()), ["location_id", "product_id"]
    )

    # Foto append-only da rodada, saldo zero incluído — é a chegada ao zero que
    # data uma ruptura. Sem histórico não há como separar venda de quebra: o
    # balance acima só guarda o presente.
    #
    # Só entra na foto quem MUDOU desde o saldo anterior: com rodada de hora em
    # hora, regravar ~800 linhas idênticas 24×/dia incharia a tabela sem
    # informação nova — e a série em degraus reconstrói o "não mudou" sozinha.
    # A primeira rodada (tabela de fotos vazia para estes locais) grava tudo,
    # como âncora; produto novo no planograma se ancora ao aparecer.
    snapshot_rows = [
        {
            "snapshot_at": now,
            "location_id": b["location_id"],
            "product_id": b["product_id"],
            "quantity": b["quantity"],
            "price": b["price"],
        }
        for key, b in balances.items()
        if primeira_foto or _saldo_mudou(anterior.get(key), b)
    ]
    for start in range(0, len(snapshot_rows), UPSERT_CHUNK):
        await session.execute(
            insert(core.StockSnapshot).values(snapshot_rows[start : start + UPSERT_CHUNK])
        )

    # O snapshot é a verdade: saldo que sumiu do relatório sai da tabela — senão
    # produto removido da máquina continuaria "em estoque" para sempre. A
    # identificação é por timestamp (linhas destes locais não tocadas nesta
    # rodada), não por lista de pares — que estourava o limite de parâmetros do
    # asyncpg em catálogos grandes.
    removed = 0
    location_ids = list({loc["id"] for loc in locations.values()})
    if location_ids:
        result = await session.execute(
            delete(core.StockBalance).where(
                core.StockBalance.location_id.in_(location_ids),
                core.StockBalance.updated_at < now,
            )
        )
        removed = result.rowcount or 0

    if skipped:
        log.warning("sync_stock: %d saldos sem vínculo (instalação/produto)", skipped)
    return len(locations), len(balances), removed


SNAPSHOT_RESOURCES = ("products", "installations", "installation_stock_balances")


class _Baixado:
    """Os recursos do snapshot já lidos da VMpay, servidos com a mesma
    interface `paginate` do cliente — a fase de banco não espera rede."""

    def __init__(self, dados: dict[str, list[dict[str, Any]]]):
        self._dados = dados

    @classmethod
    async def de(cls, client: VMpayClient, recursos: tuple[str, ...]) -> _Baixado:
        return cls({r: [p async for p in client.paginate(r)] for r in recursos})

    async def paginate(self, path: str, **_: Any):
        for item in self._dados[path]:
            yield item


async def sync_integration(
    session: AsyncSession,
    integration: core.Integration,
    *,
    client_factory=VMpayClient,
    catalogo_completo: bool = True,
) -> SnapshotReport:
    """Retrato de catálogo + locais + saldos de uma integração.

    catalogo_completo=False é o "Atualizar dados" do painel: o catálogo de
    produção tem milhares de produtos e a VMpay serve devagar (minutos), mas
    produto novo é raro. Saldos e instalações vêm sempre; o catálogo só se
    algum saldo citar produto que ainda não conhecemos. O cron segue completo
    — é ele que pega renome e cadastro alterado.
    """
    report = SnapshotReport(str(integration.id), str(integration.org_id))
    try:
        token = await token_da_conta(session, integration.config or {})
        await session.commit()  # fecha a leitura do cofre antes da rede
        base = os.environ.get("VMPAY_BASE") or PRODUCTION
        # Rede primeiro, banco depois. Baixar o catálogo de produção leva
        # minutos; com a transação já aberta, a conexão ficava ociosa esse
        # tempo todo, o pooler a derrubava, e o rollback do erro estourava em
        # MissingGreenlet — três rodadas seguidas sem estoque em 05/10/2026.
        async with client_factory(token, base_url=base) as client:
            if catalogo_completo:
                baixado = await _Baixado.de(client, SNAPSHOT_RESOURCES)
            else:
                baixado = await _Baixado.de(client, SNAPSHOT_RESOURCES[1:])
                conhecidos = {
                    str(x)
                    for x in (
                        await session.execute(
                            select(core.ProductLink.external_id).where(
                                core.ProductLink.integration_id == integration.id
                            )
                        )
                    ).scalars()
                }
                # Fecha a leitura antes de voltar à rede (ver o comentário abaixo).
                await session.commit()
                citados = {
                    str(linha["good_id"])
                    for linha in map(map_balance, baixado._dados["installation_stock_balances"])
                    if linha is not None and linha.get("good_id") is not None
                }
                if citados - conhecidos:
                    baixado._dados["products"] = [p async for p in client.paginate("products")]
                else:
                    baixado._dados["products"] = []
                    report.catalogo = "pulado"
        report.products, by_external = await sync_products(baixado, session, integration)
        report.locations, report.balances, report.stale_balances_removed = (
            await sync_stock(baixado, session, integration, by_external)
        )
        await session.commit()
    except VMpayError as exc:
        await session.rollback()
        report.error = redact(str(exc))
        log.error("snapshot da integração %s falhou: %s", integration.id, report.error)
    return report


async def sync_all_integrations(
    session: AsyncSession, *, catalogo_completo: bool = True
) -> list[dict[str, Any]]:
    integrations = (
        (
            await session.execute(
                select(core.Integration).where(
                    core.Integration.active, core.Integration.kind == "vmpay"
                )
            )
        )
        .scalars()
        .all()
    )
    if not integrations:
        log.info("nenhuma integração ativa — snapshot pulado (seed pendente?)")
        return []
    out = []
    for integration in integrations:
        report = await sync_integration(session, integration, catalogo_completo=catalogo_completo)
        log.info("snapshot: %s", report.as_dict())
        out.append(report.as_dict())
    return out
