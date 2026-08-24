"""Interruptores de segurança do servidor MCP.

São três níveis, do mais barato ao mais caro de errar:

1. leitura       — sempre disponível;
2. escrita       — cadastros, planogramas, pick lists (VMPAY_ALLOW_WRITES);
3. operação      — estoque e máquina física (VMPAY_ALLOW_MACHINE_OPS).

Cada nível é opt-in por variável de ambiente, e as tools que não estão liberadas
nem são registradas — o modelo não vê o que não pode usar, o que é mais eficaz
que recusar depois.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from vmpay.client import PRODUCTION


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "sim")


@dataclass(frozen=True)
class Settings:
    base_url: str
    base_explicit: bool
    allow_writes: bool
    allow_machine_ops: bool

    @classmethod
    def from_env(cls) -> Settings:
        base = os.environ.get("VMPAY_BASE", "").strip()
        explicit = bool(base)
        writes = _flag("VMPAY_ALLOW_WRITES")
        machine = _flag("VMPAY_ALLOW_MACHINE_OPS") and writes
        return cls(
            base_url=base or PRODUCTION,
            base_explicit=explicit,
            allow_writes=writes,
            allow_machine_ops=machine,
        )

    @property
    def writes_enabled(self) -> bool:
        """Escrita exige VMPAY_BASE declarado.

        A doc não publica a URL de homologação — ela vem do suporte da Nayax. Sem
        um default seguro para apontar, o jeito de não escrever em produção por
        distração é exigir que o ambiente seja dito em voz alta.
        """
        return self.allow_writes and self.base_explicit

    @property
    def machine_ops_enabled(self) -> bool:
        return self.allow_machine_ops and self.base_explicit

    def status(self) -> str:
        if self.allow_writes and not self.base_explicit:
            return (
                "somente leitura — VMPAY_ALLOW_WRITES está ligado mas VMPAY_BASE não "
                "foi declarado; declare a URL do ambiente para liberar escrita"
            )
        if self.machine_ops_enabled:
            return "leitura, escrita e operação em máquina"
        if self.writes_enabled:
            return "leitura e escrita (operação em máquina bloqueada)"
        return "somente leitura"
