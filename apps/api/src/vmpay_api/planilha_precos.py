"""Planilha de preços em lote: o formato que sai e a leitura do que volta.

Quem edita é o operador no Excel em português — então a leitura aceita o que o
Excel e o Google Sheets realmente produzem (`;` ou `,`, BOM, "R$ 6,99") e
recusa o que é ambíguo em vez de adivinhar. Nada aqui fala com banco ou VMpay.
"""

from __future__ import annotations

import csv
import io
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

#: Colunas da planilha exportada. Só `id` e `preco_novo` são lidas de volta;
#: as outras existem para o operador se achar (e `loja` para pegar planilha
#: subida na loja errada).
COLUNAS = ["id", "loja", "produto", "codigo_barras", "saldo", "preco_atual", "preco_novo"]
OBRIGATORIAS = ("id", "preco_novo")

#: Acima disso é quase sempre vírgula esquecida (699 em vez de 6,99).
PRECO_MAXIMO = Decimal("10000")

#: Planilha maior que isso não é de uma loja — é engano de arquivo.
MAX_LINHAS = 5000


class PlanilhaInvalida(ValueError):
    """O arquivo inteiro não serve (cabeçalho, formato). Erro de linha não é isto."""


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


_SO_PONTO_DECIMAL = re.compile(r"^\d+\.\d{1,2}$")
_MILHAR_BR = re.compile(r"^\d{1,3}(\.\d{3})+(,\d+)?$")


def ler_preco(bruto: str) -> Decimal:
    """'R$ 6,99', '6,99', '6.99', '1.299,90' -> Decimal. Ambíguo levanta.

    '1.299' sozinho pode ser mil e pouco (milhar) ou um e pouco (decimal com
    três casas): recusado, com a forma certa na mensagem.
    """
    texto = bruto.strip().replace("R$", "").replace(" ", "").replace(" ", "")
    if not texto:
        raise ValueError("preço vazio")
    if "," in texto:
        if "." in texto and not _MILHAR_BR.match(texto):
            raise ValueError(f"preço '{bruto.strip()}' não reconhecido — use 6,99")
        texto = texto.replace(".", "").replace(",", ".")
    elif "." in texto and not _SO_PONTO_DECIMAL.match(texto):
        raise ValueError(f"preço '{bruto.strip()}' é ambíguo — escreva com vírgula, como 1299,00 ou 1,29")
    try:
        valor = Decimal(texto)
    except InvalidOperation:
        raise ValueError(f"preço '{bruto.strip()}' não é um número") from None
    if valor != valor.quantize(Decimal("0.01")):
        raise ValueError(f"preço '{bruto.strip()}' tem mais de 2 casas decimais")
    if valor <= 0:
        raise ValueError("preço tem de ser maior que zero")
    if valor > PRECO_MAXIMO:
        raise ValueError(f"preço R$ {formatar_preco(valor)} parece engano (vírgula esquecida?)")
    return valor.quantize(Decimal("0.01"))


def _delimitador(cabecalho: str) -> str:
    # Excel pt-BR salva com ';'; Google Sheets e Excel em inglês, com ','.
    # Conta no cabeçalho, que é nosso e não tem vírgula em nome de coluna.
    candidatos = {d: cabecalho.count(d) for d in (";", ",", "\t")}
    melhor = max(candidatos, key=candidatos.get)
    if candidatos[melhor] == 0:
        raise PlanilhaInvalida(
            "não achei as colunas — o arquivo precisa ser CSV com a primeira linha de títulos"
        )
    return melhor


def ler_planilha(conteudo: str) -> list[LinhaPreco]:
    """Lê o CSV inteiro. Erro de arquivo levanta; erro de linha vai na linha.

    Linha sem `preco_novo` volta com preco_novo=None: é a forma de dizer "não
    mexa neste". Produto ausente da planilha também não é mexido — faltar
    linha nunca significa apagar nem zerar.
    """
    texto = conteudo.lstrip("﻿")
    if not texto.strip():
        raise PlanilhaInvalida("o arquivo está vazio")
    primeira = texto.splitlines()[0]
    leitor = csv.reader(io.StringIO(texto), delimiter=_delimitador(primeira))
    cabecalho = [c.strip().lower() for c in next(leitor)]
    faltando = [c for c in OBRIGATORIAS if c not in cabecalho]
    if faltando:
        raise PlanilhaInvalida(
            f"faltam as colunas {', '.join(faltando)} — baixe a planilha de preços da loja de novo"
        )
    col = {nome: cabecalho.index(nome) for nome in cabecalho if nome in COLUNAS}

    def campo(valores: list[str], nome: str) -> str:
        i = col.get(nome)
        return valores[i].strip() if i is not None and i < len(valores) else ""

    linhas: list[LinhaPreco] = []
    for numero, valores in enumerate(leitor, start=2):
        if not any(v.strip() for v in valores):
            continue
        if len(linhas) >= MAX_LINHAS:
            raise PlanilhaInvalida(f"mais de {MAX_LINHAS} linhas — isto não é a planilha de uma loja")
        linha = LinhaPreco(
            linha=numero,
            product_id=None,
            loja=campo(valores, "loja") or None,
            produto=campo(valores, "produto") or None,
            preco_novo=None,
        )
        linhas.append(linha)
        bruto_id = campo(valores, "id")
        try:
            linha.product_id = uuid.UUID(bruto_id)
        except ValueError:
            linha.erro = "coluna id vazia ou alterada — o produto não pode ser identificado"
            continue
        bruto_preco = campo(valores, "preco_novo")
        if not bruto_preco:
            continue
        try:
            linha.preco_novo = ler_preco(bruto_preco)
        except ValueError as exc:
            linha.erro = str(exc)
    return linhas
