"""Leitura das planilhas que o operador sobe (preço, carga, contagem…).

Quem edita é gente no Excel em português — então a leitura aceita o que o
Excel e o Google Sheets realmente produzem (`;` ou `,`, BOM, "R$ 6,99",
"1.299,90") e recusa o que é ambíguo em vez de adivinhar. Erro do arquivo
inteiro (cabeçalho, formato) levanta; erro de uma linha fica na linha.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterator
from decimal import Decimal, InvalidOperation

#: Planilha maior que isso não é de uma loja — é engano de arquivo.
MAX_LINHAS = 5000


class PlanilhaInvalida(ValueError):
    """O arquivo inteiro não serve (cabeçalho, formato). Erro de linha não é isto."""


def _delimitador(cabecalho: str) -> str:
    # Excel pt-BR salva com ';'; Google Sheets e Excel em inglês, com ','.
    # Conta no cabeçalho, que é nosso e não tem vírgula em nome de coluna.
    candidatos = {d: cabecalho.count(d) for d in (";", ",", "\t")}
    melhor = max(candidatos, key=candidatos.get)
    # Sem separador nenhum é planilha de uma coluna só: segue, e a checagem
    # de colunas obrigatórias diz o que falta (mensagem melhor que "formato").
    return melhor if candidatos[melhor] else ";"


def linhas_do_csv(
    conteudo: str, *, exige: tuple[str, ...], uma_de: tuple[str, ...] = ()
) -> Iterator[tuple[int, dict[str, str]]]:
    """(número da linha como o Excel conta, {coluna: valor}) por linha não vazia.

    `exige`: colunas obrigatórias. `uma_de`: pelo menos uma destas (ex.: id OU
    código de barras). Colunas extras são ignoradas; nome de coluna não liga
    para maiúscula nem espaço.
    """
    texto = conteudo.lstrip("﻿")
    if not texto.strip():
        raise PlanilhaInvalida("o arquivo está vazio")
    leitor = csv.reader(io.StringIO(texto), delimiter=_delimitador(texto.splitlines()[0]))
    cabecalho = [c.strip().lower() for c in next(leitor)]
    faltando = [c for c in exige if c not in cabecalho]
    if faltando:
        raise PlanilhaInvalida(f"faltam as colunas {', '.join(faltando)} — baixe o modelo de novo")
    if uma_de and not any(c in cabecalho for c in uma_de):
        raise PlanilhaInvalida(f"a planilha precisa de uma destas colunas: {', '.join(uma_de)}")
    lidas = 0
    for numero, valores in enumerate(leitor, start=2):
        if not any(v.strip() for v in valores):
            continue
        lidas += 1
        if lidas > MAX_LINHAS:
            raise PlanilhaInvalida(f"mais de {MAX_LINHAS} linhas — isto não é a planilha de uma loja")
        yield numero, {
            nome: (valores[i].strip() if i < len(valores) else "")
            for i, nome in enumerate(cabecalho)
        }


_SO_PONTO_DECIMAL = re.compile(r"^\d+\.\d{1,2}$")
_MILHAR_BR = re.compile(r"^\d{1,3}(\.\d{3})+(,\d+)?$")


def ler_numero(bruto: str, *, casas: int, nome: str = "valor") -> Decimal:
    """'R$ 6,99', '6,99', '6.99', '1.299,90' -> Decimal. Ambíguo levanta.

    '1.299' sozinho pode ser mil e pouco (milhar) ou um e pouco (decimal com
    três casas): recusado, com a forma certa na mensagem.
    """
    original = bruto.strip()
    texto = original.replace("R$", "").replace(" ", "").replace(" ", "")
    if not texto:
        raise ValueError(f"{nome} vazio")
    if "," in texto:
        if "." in texto and not _MILHAR_BR.match(texto):
            raise ValueError(f"{nome} '{original}' não reconhecido — use vírgula, como 6,99")
        texto = texto.replace(".", "").replace(",", ".")
    elif "." in texto and not _SO_PONTO_DECIMAL.match(texto):
        raise ValueError(f"{nome} '{original}' é ambíguo — escreva com vírgula, como 1299,00 ou 1,29")
    try:
        valor = Decimal(texto)
    except InvalidOperation:
        raise ValueError(f"{nome} '{original}' não é um número") from None
    passo = Decimal(1).scaleb(-casas)
    if valor != valor.quantize(passo):
        raise ValueError(f"{nome} '{original}' tem mais de {casas} casas decimais")
    return valor.quantize(passo)
