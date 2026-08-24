"""Limitador local para não bater no 429 da VMpay.

O limite documentado é de 300 requisições por minuto **por access_token**. Como
cada consumidor (worker, MCP, API) usa sua própria chave, cada processo tem seu
próprio balde.
"""

import asyncio
import time


class TokenBucket:
    """Balde com reposição contínua.

    Reposição contínua em vez de janela fixa de 1 min: uma janela fixa permite
    600 requests em dois segundos na virada do minuto, o que estoura o limite do
    servidor mesmo respeitando a contagem local.
    """

    def __init__(self, rate: int = 300, per_seconds: float = 60.0):
        self.capacity = float(rate)
        self.refill_per_second = rate / per_seconds
        self._tokens = float(rate)
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        self._tokens = min(
            self.capacity, self._tokens + (now - self._updated) * self.refill_per_second
        )
        self._updated = now

    async def acquire(self) -> None:
        while True:
            async with self._lock:
                self._refill()
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                deficit = 1 - self._tokens
                wait = deficit / self.refill_per_second
            await asyncio.sleep(wait)

    @property
    def available(self) -> int:
        self._refill()
        return int(self._tokens)
