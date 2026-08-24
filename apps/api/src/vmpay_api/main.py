"""Aplicação FastAPI. Roda no Render; o dashboard na Vercel consome daqui."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import health, sales

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")


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
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.allowed_origins,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(sales.router)
    return app


app = create_app()
