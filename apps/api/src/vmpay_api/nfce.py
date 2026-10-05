"""NFC-e (modelo 65) da SEFAZ-SP: da URL do QR Code ao cupom estruturado.

Só a URL do QR Code é consultável sem humano. A consulta pela chave de acesso
(`/consulta`) exige CAPTCHA; a do QR carrega no parâmetro `p` um hash assinado
com o CSC do emitente, que a SEFAZ aceita sem desafio. Esse hash não pode ser
recomposto a partir da chave — por isso quem só tem a chave cai no lançamento
manual.

A URL que o operador cola NUNCA é requisitada como veio: dela se extrai apenas
o `p`, validado, e a requisição é remontada contra o host fixo da SEFAZ-SP.
Requisitar uma URL arbitrária vinda do cliente seria SSRF a partir do backend.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, unquote, urlparse

import httpx

SP_HOST = "www.nfce.fazenda.sp.gov.br"
SP_QRCODE_URL = f"https://{SP_HOST}/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx"
SP_CONSULTA_CHAVE_URL = f"https://{SP_HOST}/consulta"
UF_SP = "35"
MODELO_NFCE = "65"

# A página traz a hora local sem fuso. O Brasil não tem horário de verão desde
# 2019, então -03:00 fixo é exato — e não depende de tzdata na imagem Docker.
_BRT = timezone(timedelta(hours=-3))

_P_RE = re.compile(r"^\d{44}(\|[0-9A-Za-z]+)+$")


class NFCeError(Exception):
    """Falha esperada no fluxo de NFC-e; a mensagem vai para o operador."""


@dataclass(frozen=True)
class Entrada:
    chave: str
    # Parâmetro `p` do QR Code. None quando o operador só tem a chave.
    qr_param: str | None


@dataclass(frozen=True)
class Item:
    numero: int
    codigo: str
    descricao: str
    quantidade: Decimal
    unidade: str
    valor_unitario: Decimal
    valor_total: Decimal


@dataclass(frozen=True)
class Cupom:
    chave: str
    numero: str
    serie: str
    emitido_em: datetime | None
    emitente_cnpj: str
    emitente_nome: str
    consumidor_doc: str | None
    valor_total: Decimal
    itens: list[Item] = field(default_factory=list)


def digito_verificador(chave43: str) -> str:
    """Módulo 11 com pesos 2..9 da direita para a esquerda (Manual da NF-e)."""
    pesos = [2, 3, 4, 5, 6, 7, 8, 9]
    soma = sum(int(d) * pesos[i % 8] for i, d in enumerate(reversed(chave43)))
    resto = soma % 11
    return "0" if resto < 2 else str(11 - resto)


def validar_chave(chave: str) -> str:
    chave = re.sub(r"\D", "", chave)
    if len(chave) != 44:
        raise NFCeError("a chave de acesso tem 44 dígitos")
    if digito_verificador(chave[:43]) != chave[43]:
        raise NFCeError("chave de acesso inválida (dígito verificador não confere)")
    if chave[20:22] != MODELO_NFCE:
        raise NFCeError("a chave não é de NFC-e (modelo 65)")
    if chave[:2] != UF_SP:
        raise NFCeError("por enquanto só NFC-e de SP é suportada")
    return chave


def interpretar(texto: str) -> Entrada:
    """Aceita a URL do QR Code, o próprio `p`, ou só a chave (com ou sem espaços)."""
    texto = (texto or "").strip()
    if not texto:
        raise NFCeError("informe a URL do QR Code ou a chave de acesso")

    if "://" in texto:
        url = urlparse(texto)
        if url.hostname is None or url.hostname.lower() not in {SP_HOST, "nfce.fazenda.sp.gov.br"}:
            raise NFCeError("a URL não é da consulta de NFC-e da SEFAZ-SP")
        valores = parse_qs(url.query).get("p")
        if not valores:
            raise NFCeError("a URL não tem o parâmetro do QR Code (p=...)")
        texto = valores[0]

    p = unquote(texto).strip()
    if "|" in p:
        if not _P_RE.match(p):
            raise NFCeError("conteúdo do QR Code em formato inesperado")
        return Entrada(chave=validar_chave(p[:44]), qr_param=p)

    return Entrada(chave=validar_chave(p), qr_param=None)


# ------------------------------------------------------------------- parsing

_TAG_RE = re.compile(r"<[^>]+>")
_ITEM_RE = re.compile(r'<tr id="Item \+ (\d+)">(.*?)</tr>', re.S)


def _texto(fragmento: str) -> str:
    return " ".join(html_lib.unescape(_TAG_RE.sub(" ", fragmento)).split())


def _span(bloco: str, classe: str) -> str:
    m = re.search(rf'<span class="{classe}">(.*?)</span>', bloco, re.S)
    return _texto(m.group(1)) if m else ""


def _decimal_br(valor: str) -> Decimal:
    limpo = re.sub(r"[^\d,.-]", "", valor).replace(".", "").replace(",", ".")
    try:
        return Decimal(limpo)
    except InvalidOperation:
        raise NFCeError(f"valor ilegível na página da SEFAZ: {valor!r}") from None


def _depois_do_rotulo(texto: str, rotulo: str) -> str:
    """'Qtde.: 3' → '3'. O rótulo vem dentro de <strong> no mesmo span."""
    return texto.split(rotulo, 1)[-1].strip()


def parse(pagina: str) -> Cupom:
    """Lê a página de resultado do QR Code (layout XSLT 2.05 da SEFAZ-SP)."""
    if 'id="tabResult"' not in pagina:
        raise NFCeError(
            "a SEFAZ não devolveu o cupom — o QR pode estar incompleto ou a nota "
            "ainda não foi autorizada"
        )

    itens = []
    for numero, bloco in _ITEM_RE.findall(pagina):
        codigo = _span(bloco, "RCod")
        itens.append(
            Item(
                numero=int(numero),
                codigo=re.sub(r"^\(Código:\s*|\)$", "", codigo).strip(),
                descricao=_span(bloco, "txtTit"),
                quantidade=_decimal_br(_depois_do_rotulo(_span(bloco, "Rqtd"), "Qtde.:")),
                unidade=_depois_do_rotulo(_span(bloco, "RUN"), "UN:"),
                valor_unitario=_decimal_br(_depois_do_rotulo(_span(bloco, "RvlUnit"), "Vl. Unit.:")),
                valor_total=_decimal_br(_span(bloco, "valor")),
            )
        )
    if not itens:
        raise NFCeError("o cupom veio sem itens")

    texto = _texto(pagina)

    def achar(padrao: str) -> str:
        m = re.search(padrao, texto)
        return m.group(1).strip() if m else ""

    emissao = achar(r"Emissão:\s*(\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2})")
    total = re.search(
        r'Valor a pagar R\$:</label>\s*<span class="[^"]*">([^<]+)</span>', pagina
    )
    nome = re.search(r'<div id="u20" class="txtTopo">(.*?)</div>', pagina, re.S)
    consumidor = re.search(r"Consumidor\s+(?:CNPJ|CPF):\s*([\d./-]+)", texto)

    return Cupom(
        chave=re.sub(r"\D", "", achar(r"Chave de acesso:\s*([\d ]{44,60})")),
        numero=achar(r"Número:\s*(\d+)"),
        serie=achar(r"Série:\s*(\d+)"),
        emitido_em=(
            datetime.strptime(emissao, "%d/%m/%Y %H:%M:%S").replace(tzinfo=_BRT)
            if emissao
            else None
        ),
        emitente_cnpj=re.sub(r"\D", "", achar(r"CNPJ:\s*([\d./-]+)")),
        emitente_nome=_texto(nome.group(1)) if nome else "",
        consumidor_doc=re.sub(r"\D", "", consumidor.group(1)) if consumidor else None,
        valor_total=(
            _decimal_br(total.group(1)) if total else sum((i.valor_total for i in itens), Decimal(0))
        ),
        itens=itens,
    )


async def consultar(entrada: Entrada, client: httpx.AsyncClient | None = None) -> Cupom:
    """Busca e lê o cupom na SEFAZ-SP. Exige o `p` do QR Code."""
    if entrada.qr_param is None:
        raise NFCeError(
            "só com a chave a SEFAZ exige CAPTCHA — leia o QR Code ou lance os itens à mão"
        )
    proprio = client is None
    client = client or httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; vmpay-picklist)"},
    )
    try:
        resp = await client.get(SP_QRCODE_URL, params={"p": entrada.qr_param})
    except httpx.HTTPError as exc:
        raise NFCeError(f"a SEFAZ-SP não respondeu ({type(exc).__name__}); tente de novo") from None
    finally:
        if proprio:
            await client.aclose()
    if resp.status_code != 200:
        raise NFCeError(f"a SEFAZ-SP respondeu HTTP {resp.status_code}")

    cupom = parse(resp.text)
    if cupom.chave and cupom.chave != entrada.chave:
        raise NFCeError("a SEFAZ devolveu outra nota que não a do QR Code")
    return cupom
