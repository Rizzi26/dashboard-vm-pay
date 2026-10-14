"""Planilha de preços em lote: o formato que sai e a leitura do que volta."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from .planilha import PlanilhaInvalida, linhas_do_csv, ler_numero

__all__ = ["COLUNAS", "LinhaPreco", "PlanilhaInvalida", "formatar_preco", "ler_planilha", "ler_preco"]

#: Colunas da planilha exportada. Só `id` e `preco_novo` são lidas de volta;
#: as outras existem para o operador se achar (e `loja` para pegar planilha
#: subida na loja errada).
COLUNAS = ["id", "loja", "canaleta", "produto", "codigo_barras", "saldo", "preco_atual", "preco_novo"]

#: Acima disso é quase sempre vírgula esquecida (699 em vez de 6,99).
PRECO_MAXIMO = Decimal("10000")


@dataclass
class LinhaPreco:
    linha: int  # como o Excel numera: o cabeçalho é a 1
    product_id: uuid.UUID | None
    loja: str | None
    produto: str | None
    preco_novo: Decimal | None
    erro: str | None = None


def formatar_preco(valor: Decimal | float | None) -> str:
    """6,99 — como o Excel em português espera ler."""
    if valor is None:
        return ""
    return f"{Decimal(str(valor)):.2f}".replace(".", ",")


def ler_preco(bruto: str) -> Decimal:
    valor = ler_numero(bruto, casas=2, nome="preço")
    if valor <= 0:
        raise ValueError("preço tem de ser maior que zero")
    if valor > PRECO_MAXIMO:
        raise ValueError(f"preço R$ {formatar_preco(valor)} parece engano (vírgula esquecida?)")
    return valor


def ler_planilha(conteudo: str) -> list[LinhaPreco]:
    """Lê o CSV inteiro. Erro de arquivo levanta; erro de linha vai na linha.

    Linha sem `preco_novo` volta com preco_novo=None: é a forma de dizer "não
    mexa neste". Produto ausente da planilha também não é mexido — faltar
    linha nunca significa apagar nem zerar.
    """
    linhas: list[LinhaPreco] = []
    for numero, campos in linhas_do_csv(conteudo, exige=("id", "preco_novo")):
        linha = LinhaPreco(
            linha=numero,
            product_id=None,
            loja=campos.get("loja") or None,
            produto=campos.get("produto") or None,
            preco_novo=None,
        )
        linhas.append(linha)
        try:
            linha.product_id = uuid.UUID(campos["id"])
        except ValueError:
            linha.erro = "coluna id vazia ou alterada — o produto não pode ser identificado"
            continue
        if not campos["preco_novo"]:
            continue
        try:
            linha.preco_novo = ler_preco(campos["preco_novo"])
        except ValueError as exc:
            linha.erro = str(exc)
    return linhas
