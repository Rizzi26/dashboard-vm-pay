"""Engine e sessão do Postgres do Supabase."""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .config import settings


@lru_cache
def engine() -> AsyncEngine:
    cfg = settings()
    if not cfg.database_url:
        raise RuntimeError("DATABASE_URL não está definida")
    return create_async_engine(
        cfg.asyncpg_url,
        pool_pre_ping=True,
        # O pooler do Supabase (pgbouncer em transaction mode) não suporta
        # prepared statements nomeados, que é o default do asyncpg.
        connect_args={"statement_cache_size": 0},
    )


@lru_cache
def session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine(), expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with session_factory()() as session:
        yield session
