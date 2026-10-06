"""Aplicação FastAPI. Roda no Render; o dashboard na Vercel consome daqui."""

from __future__ import annotations

import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import rotinas
from .config import settings
from .routers import auditoria, contas, health, interno, lojas, me, members, picklist, products, sales, stock, sync

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def _ciclo_de_vida(_app: FastAPI):
    # Agenda as rotinas no pg_cron (só no Render; idempotente; falha só loga).
    await rotinas.agendar()
    yield


def create_app() -> FastAPI:
    cfg = settings()
    app = FastAPI(
        title="VMpay API",
        version="0.1.0",
        description=(
            "Agregação sobre os dados ingeridos da VMpay. A API do fornecedor não "
            "agrega nada e limita 300 req/min por token, por isso o dashboard lê "
            "daqui e não de lá."
        ),
        lifespan=_ciclo_de_vida,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.allowed_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(me.router)
    app.include_router(members.router)
    app.include_router(sales.router)
    app.include_router(stock.router)
    app.include_router(products.router)
    app.include_router(picklist.router)
    app.include_router(sync.router)
    app.include_router(auditoria.router)
    app.include_router(lojas.router)
    app.include_router(contas.router)
    app.include_router(interno.router)
    return app


app = create_app()
