"""Cliente da API VMpay v1.

    from vmpay import VMpayClient

    async with VMpayClient.from_env() as vm:
        async for venda in vm.paginate("cashless_facts", transaction_id_greater_than=0):
            ...
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from collections.abc import AsyncIterator, Mapping
from datetime import datetime, timezone
from types import TracebackType
from typing import Any

import httpx

from .errors import VMpayError, VMpayRateLimited, for_status
from .ratelimit import TokenBucket
from .redact import redact

log = logging.getLogger("vmpay")

PRODUCTION = "https://vmpay.vertitecnologia.com.br/api/v1"

MAX_PER_PAGE = 1000
"""Acima disso a API devolve 400 (documentado em Visão geral → Paginação)."""


def to_vmpay_datetime(value: datetime | str) -> str:
    """Formata uma data para os filtros start_date/end_date.

    A API aceita ISO 8601 e `dd/mm/yyyy hh:mi:ss`, mas em ambos os casos
    interpreta a hora como **UTC**. Datas ingênuas (sem tzinfo) são tratadas como
    UTC; datas com fuso são convertidas. Passar hora é obrigatório na prática —
    se omitida a API assume 00:00 UTC e a janela silenciosamente muda.
    """
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


class VMpayClient:
    """Um cliente = uma chave de operador = um balde de 300 req/min."""

    def __init__(
        self,
        token: str,
        *,
        base_url: str = PRODUCTION,
        child_operator_id: str | int | None = None,
        rate_limit: int = 300,
        max_retries: int = 5,
        timeout: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ):
        if not token:
            raise ValueError("token vazio")
        # Operadores filhos: o id vai anexado ao próprio token, separado por '@'.
        self._token = f"{token}@{child_operator_id}" if child_operator_id else token
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self._bucket = TokenBucket(rate_limit)
        self._http = client or httpx.AsyncClient(timeout=timeout)
        self._owns_http = client is None

    @classmethod
    def from_env(cls, prefix: str = "VMPAY", **kwargs: Any) -> VMpayClient:
        """Lê VMPAY_TOKEN, VMPAY_BASE e VMPAY_CHILD_OPERATOR_ID do ambiente."""
        token = os.environ.get(f"{prefix}_TOKEN")
        if not token:
            raise VMpayError(f"{prefix}_TOKEN não está definido no ambiente")
        return cls(
            token,
            base_url=os.environ.get(f"{prefix}_BASE", PRODUCTION),
            child_operator_id=os.environ.get(f"{prefix}_CHILD_OPERATOR_ID") or None,
            **kwargs,
        )

    def __repr__(self) -> str:  # nunca vaza o token
        return f"<VMpayClient base={self.base_url} tokens={self._bucket.available}/300>"

    async def __aenter__(self) -> VMpayClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    # ---------------------------------------------------------------- requests

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Any = None,
    ) -> Any:
        """Uma chamada, com rate limit e retry. Devolve o JSON já decodificado."""
        url = f"{self.base_url}/{path.lstrip('/')}"
        query: dict[str, Any] = {"access_token": self._token}
        for key, value in (params or {}).items():
            if value is None:
                continue
            query[key] = to_vmpay_datetime(value) if isinstance(value, datetime) else value

        last: Exception | None = None
        for attempt in range(self.max_retries + 1):
            await self._bucket.acquire()
            try:
                response = await self._http.request(method, url, params=query, json=json)
            except httpx.TransportError as exc:
                last = exc
                if attempt == self.max_retries:
                    raise VMpayError(f"falha de rede em {redact(url)}: {exc}") from exc
                await self._backoff(attempt)
                continue

            if response.status_code < 400:
                if response.status_code == 204 or not response.content:
                    return None
                return response.json()

            error = for_status(response.status_code, response.text)
            # 429 e 5xx são transitórios; o resto é problema do request.
            if response.status_code == 429 or response.status_code >= 500:
                last = error
                if attempt == self.max_retries:
                    raise error
                log.warning(
                    "VMpay %s em %s, tentativa %d/%d",
                    response.status_code,
                    redact(str(response.url)),
                    attempt + 1,
                    self.max_retries,
                )
                await self._backoff(attempt)
                continue
            raise error

        raise last or VMpayError("esgotou as tentativas")

    async def _backoff(self, attempt: int) -> None:
        """Espera progressiva com jitter.

        A API não manda `Retry-After` no 429, então a espera é cega: 1s, 2s, 4s…
        limitada a 60s. O jitter evita que vários workers reiniciem em uníssono.
        """
        delay = min(2**attempt, 60) * (0.5 + random.random())
        await asyncio.sleep(delay)

    async def get(self, path: str, **params: Any) -> Any:
        return await self.request("GET", path, params=params)

    async def post(self, path: str, json: Any = None, **params: Any) -> Any:
        return await self.request("POST", path, params=params, json=json)

    async def patch(self, path: str, json: Any = None, **params: Any) -> Any:
        return await self.request("PATCH", path, params=params, json=json)

    async def delete(self, path: str, **params: Any) -> Any:
        return await self.request("DELETE", path, params=params)

    # -------------------------------------------------------------- paginação

    async def paginate(
        self, path: str, *, per_page: int = MAX_PER_PAGE, **params: Any
    ) -> AsyncIterator[dict[str, Any]]:
        """Percorre todas as páginas de um recurso, registro a registro.

        A API não devolve total nem cursor de paginação: a última página é aquela
        que volta com menos registros que `per_page`. Uma página exatamente cheia
        no fim custa uma requisição extra que volta vazia — é o preço do protocolo.
        """
        if per_page > MAX_PER_PAGE:
            raise ValueError(f"per_page máximo é {MAX_PER_PAGE}, recebi {per_page}")

        page = 1
        while True:
            batch = await self.get(path, page=page, per_page=per_page, **params)
            if not isinstance(batch, list):
                raise VMpayError(f"{path} não devolveu uma lista; paginação não se aplica")
            for record in batch:
                yield record
            if len(batch) < per_page:
                return
            page += 1

    async def iter_since(
        self,
        path: str,
        *,
        cursor_param: str,
        since_id: int = 0,
        per_page: int = MAX_PER_PAGE,
        **params: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        """Ingestão incremental por id — o caminho recomendado pela própria doc.

        `cursor_param` é `transaction_id_greater_than` para /cashless_facts e
        `vend_id_greater_than` para /vends.

        Atenção: quando o cursor é passado, a API **ignora** start_date/end_date.
        Para backfill histórico use `paginate` com janela de data.

        Ordenação não é garantida crescente, então o cursor avança pelo maior id
        visto no lote, não pelo último.
        """
        cursor = since_id
        while True:
            batch = await self.get(
                path, **{cursor_param: cursor}, per_page=per_page, **params
            )
            if not batch:
                return
            highest = cursor
            for record in batch:
                yield record
                highest = max(highest, int(record["id"]))
            if highest <= cursor:
                # Nada avançou: sem isto, um lote sem id maior gira para sempre.
                raise VMpayError(
                    f"cursor travado em {cursor} para {path}: o lote não trouxe id maior"
                )
            cursor = highest
            if len(batch) < per_page:
                return
