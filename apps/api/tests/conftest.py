"""Fixtures compartilhadas: settings limpos e JWT de teste (HS256)."""

import time
import uuid

import jwt
import pytest

from vmpay_api.config import settings

SECRET = "segredo-de-teste-com-32-bytes-ok!!"
USER_ID = uuid.UUID("00000000-0000-0000-0000-00000000aaaa")


@pytest.fixture(autouse=True)
def _clean_settings(monkeypatch):
    """Cada teste parte de settings recém-lidos, com HS256 de teste ligado."""
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://teste.supabase.co")
    settings.cache_clear()
    yield
    settings.cache_clear()


def make_token(
    user_id: uuid.UUID = USER_ID,
    *,
    email: str = "pessoa@teste.dev",
    aud: str = "authenticated",
    expires_in: int = 3600,
    secret: str = SECRET,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": str(user_id), "email": email, "aud": aud, "iat": now, "exp": now + expires_in},
        secret,
        algorithm="HS256",
    )
