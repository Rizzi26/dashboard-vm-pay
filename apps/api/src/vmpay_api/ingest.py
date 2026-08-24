"""Worker de ingestão: VMpay -> Supabase.

A API é passiva e não agrega, então o dashboard não pode consultá-la ao vivo.
Este worker traz o que é novo usando o cursor por id recomendado pela doc e
grava no Postgres, de onde o dashboard lê.

Duas garantias que valem o código a mais:

1. **Idempotência.** A chave primária é o id da VMpay, e a gravação é upsert.
   Rodar duas vezes a mesma janela não duplica linha.
2. **O cursor só avança com o dado já gravado**, na mesma transação. Se o
   processo morrer no meio, a próxima rodada recomeça do último lote confirmado
   e no máximo reprocessa — nunca pula.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from vmpay import VMpayClient, VMpayError
from vmpay.client import PRODUCTION
from vmpay.redact import redact

from . import models
from .config import settings
from .db import session_factory
from .mapping import RESOURCES, dimensions_from

log = logging.getLogger("vmpay_api.ingest")

TABLES = {"cashless_facts": models.CashlessFact, "vends": models.Vend}
DIMENSION_TABLES = {
    "client": models.Client,
    "location": models.Location,
    "machine": models.Machine,
    "good": models.Good,
}


@dataclass
class IngestReport:
    resource: str
    rows: int = 0
    batches: int = 0
    cursor_before: int = 0
    cursor_after: int = 0
    truncated: bool = False
    error: str | None = None
    dimensions: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "recurso": self.resource,
            "registros": self.rows,
            "lotes": self.batches,
            "cursor_antes": self.cursor_before,
            "cursor_depois": self.cursor_after,
            "teto_atingido": self.truncated,
            "erro": self.error,
            "dimensoes": self.dimensions,
        }


async def read_cursor(session: AsyncSession, resource: str) -> int:
    value = await session.scalar(
        select(models.SyncCursor.cursor_value).where(models.SyncCursor.resource == resource)
    )
    return value or 0


async def _upsert(session: AsyncSession, table, rows: list[dict], key: str = "id") -> None:
    """Upsert em bloco, atualizando todas as colunas exceto a chave.

    Reingestão sobrescreve: se a VMpay corrigir uma transação, a correção chega.
    """
    if not rows:
        return
    stmt = insert(table).values(rows)
    updatable = {
        c.name: stmt.excluded[c.name]
        for c in table.__table__.columns
        if c.name not in (key, "ingested_at", "synced_at")
    }
    await session.execute(stmt.on_conflict_do_update(index_elements=[key], set_=updatable))


async def _flush(
    session: AsyncSession,
    resource: str,
    table,
    rows: list[dict],
    dims: dict[str, dict[int, dict]],
    cursor: int,
    report: IngestReport,
) -> None:
    """Grava um lote e avança o cursor — tudo numa transação só.

    As dimensões vão primeiro: os fatos têm FK para elas.
    """
    for name, bucket in dims.items():
        if bucket:
            await _upsert(session, DIMENSION_TABLES[name], list(bucket.values()))
            report.dimensions[name] = report.dimensions.get(name, 0) + len(bucket)
    await _upsert(session, table, rows)
    await session.execute(
        update(models.SyncCursor)
        .where(models.SyncCursor.resource == resource)
        .values(
            cursor_value=cursor,
            last_run_at=datetime.now(timezone.utc),
            last_success=datetime.now(timezone.utc),
            last_error=None,
            rows_ingested=models.SyncCursor.rows_ingested + len(rows),
        )
    )
    await session.commit()
    report.batches += 1
    report.rows += len(rows)
    report.cursor_after = cursor


async def sync_resource(
    resource: str,
    client: VMpayClient,
    session: AsyncSession,
    *,
    batch_size: int | None = None,
    max_rows: int | None = None,
) -> IngestReport:
    """Traz o que é novo de um recurso e devolve o relatório da rodada."""
    if resource not in RESOURCES:
        raise ValueError(f"recurso '{resource}' não é ingerível; conheço {list(RESOURCES)}")

    cfg = settings()
    batch_size = batch_size or cfg.ingest_batch_size
    max_rows = cfg.ingest_max_rows if max_rows is None else max_rows
    spec = RESOURCES[resource]
    table = TABLES[resource]

    cursor = await read_cursor(session, resource)
    report = IngestReport(resource=resource, cursor_before=cursor, cursor_after=cursor)

    buffer: list[dict] = []
    dims: dict[str, dict[int, dict]] = {name: {} for name in DIMENSION_TABLES}
    highest = cursor

    try:
        async for payload in client.iter_since(
            resource, cursor_param=spec["cursor_param"], since_id=cursor
        ):
            buffer.append(spec["mapper"](payload))
            highest = max(highest, int(payload["id"]))
            if spec["extract_dimensions"]:
                for name, encontrados in dimensions_from(payload).items():
                    for dim in encontrados:
                        dims[name][dim["id"]] = dim

            if len(buffer) >= batch_size:
                await _flush(session, resource, table, buffer, dims, highest, report)
                buffer, dims = [], {name: {} for name in DIMENSION_TABLES}

            if max_rows and report.rows + len(buffer) >= max_rows:
                report.truncated = True
                break

        if buffer:
            await _flush(session, resource, table, buffer, dims, highest, report)
    except VMpayError as exc:
        # O que já foi confirmado fica; o cursor aponta para o último lote bom.
        await session.rollback()
        report.error = redact(str(exc))
        await _record_failure(session, resource, report.error)
        log.error("ingestão de %s falhou: %s", resource, report.error)

    return report


async def _record_failure(session: AsyncSession, resource: str, message: str) -> None:
    await session.execute(
        update(models.SyncCursor)
        .where(models.SyncCursor.resource == resource)
        .values(last_run_at=datetime.now(timezone.utc), last_error=message[:2000])
    )
    await session.commit()


async def sync_all(resources: list[str] | None = None) -> list[dict[str, Any]]:
    """Uma rodada completa: staging de vendas + snapshot de catálogo/estoque.

    É isto que o cron (GitHub Actions) chama. O staging de vendas roda com o
    token global (tenant único, registrado); o snapshot itera as integrações
    ativas de core.integration — sem integração cadastrada, só o staging roda.
    """
    from .sync_core import sync_all_integrations

    cfg = settings()
    alvos = resources or list(RESOURCES)
    relatorios: list[dict[str, Any]] = []
    async with VMpayClient(cfg.vmpay_token, base_url=cfg.vmpay_base or PRODUCTION) as client:
        async with session_factory()() as session:
            for resource in alvos:
                relatorio = await sync_resource(resource, client, session)
                log.info("ingestão %s: %s", resource, relatorio.as_dict())
                relatorios.append(relatorio.as_dict())
    async with session_factory()() as session:
        relatorios.extend(await sync_all_integrations(session))
    return relatorios


def cli() -> None:
    """Entrada do `vmpay-ingest`, usada pelo cron job do Render."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    import json

    print(json.dumps(asyncio.run(sync_all()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    cli()
