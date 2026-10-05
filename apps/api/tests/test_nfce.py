"""NFC-e: interpretação da entrada, chave e leitura da página da SEFAZ-SP.

A fixture é a página real de um cupom com emitente, consumidor, chave e hash
trocados — o repositório é público.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
import respx

from vmpay_api import nfce

PAGINA = (Path(__file__).parent / "fixtures" / "nfce_sp_qrcode.html").read_text(encoding="utf-8")
CHAVE = "35260911222333000181650010000141921386520530"
P = f"{CHAVE}|2|1|2|{'0' * 40}"
URL_QR = f"{nfce.SP_QRCODE_URL}?p={P.replace('|', '%7C')}"


def test_digito_verificador():
    assert nfce.digito_verificador(CHAVE[:43]) == CHAVE[43]


@pytest.mark.parametrize(
    "texto",
    [URL_QR, P, URL_QR.replace("https://www.", "http://")],
)
def test_interpretar_qrcode(texto):
    entrada = nfce.interpretar(texto)
    assert entrada == nfce.Entrada(chave=CHAVE, qr_param=P)


def test_interpretar_chave_com_espacos():
    espacada = " ".join(CHAVE[i : i + 4] for i in range(0, 44, 4))
    assert nfce.interpretar(espacada) == nfce.Entrada(chave=CHAVE, qr_param=None)


@pytest.mark.parametrize(
    ("texto", "erro"),
    [
        ("", "informe"),
        (CHAVE[:43] + "9", "dígito verificador"),
        ("123", "44 dígitos"),
        (f"https://evil.example/x?p={P}", "SEFAZ-SP"),
        (f"https://{nfce.SP_HOST}.evil.example/x?p={P}", "SEFAZ-SP"),
        (f"https://{nfce.SP_HOST}/x?q=1", "parâmetro"),
        (f"{CHAVE}|2|1|<script>", "formato"),
    ],
)
def test_interpretar_recusa(texto, erro):
    with pytest.raises(nfce.NFCeError, match=erro):
        nfce.interpretar(texto)


def test_chave_de_nfe_modelo_55_recusada():
    c43 = CHAVE[:20] + "55" + CHAVE[22:43]
    with pytest.raises(nfce.NFCeError, match="modelo 65"):
        nfce.validar_chave(c43 + nfce.digito_verificador(c43))


def test_parse_cabecalho():
    cupom = nfce.parse(PAGINA)
    assert cupom.chave == CHAVE
    assert (cupom.numero, cupom.serie) == ("14192", "1")
    assert cupom.emitente_cnpj == "11222333000181"
    assert cupom.emitente_nome == "DISTRIBUIDORA EXEMPLO LTDA"
    assert cupom.consumidor_doc == "99888777000160"
    assert cupom.emitido_em == datetime(2026, 9, 28, 19, 3, 58, tzinfo=timezone(timedelta(hours=-3)))
    assert cupom.valor_total == Decimal("616.92")


def test_parse_itens_fecham_com_o_total():
    cupom = nfce.parse(PAGINA)
    assert len(cupom.itens) == 25
    assert [i.numero for i in cupom.itens] == list(range(1, 26))
    assert cupom.itens[0] == nfce.Item(
        numero=1,
        codigo="24344",
        descricao="BISC. BAUDUCCO MEIO AMARGO",
        quantidade=Decimal("3"),
        unidade="UN",
        valor_unitario=Decimal("6.95"),
        valor_total=Decimal("20.85"),
    )
    assert sum(i.valor_total for i in cupom.itens) == cupom.valor_total


def test_parse_pagina_sem_cupom():
    with pytest.raises(nfce.NFCeError, match="não devolveu"):
        nfce.parse("<html><body>Captcha</body></html>")


@respx.mock
async def test_consultar_remonta_url_no_host_fixo():
    rota = respx.get(nfce.SP_QRCODE_URL).mock(return_value=httpx.Response(200, text=PAGINA))
    cupom = await nfce.consultar(nfce.Entrada(chave=CHAVE, qr_param=P))
    assert len(cupom.itens) == 25
    assert rota.calls.last.request.url.params["p"] == P


async def test_consultar_so_com_chave_explica_captcha():
    with pytest.raises(nfce.NFCeError, match="CAPTCHA"):
        await nfce.consultar(nfce.Entrada(chave=CHAVE, qr_param=None))


@respx.mock
async def test_consultar_sefaz_fora():
    respx.get(nfce.SP_QRCODE_URL).mock(side_effect=httpx.ConnectTimeout("x"))
    with pytest.raises(nfce.NFCeError, match="não respondeu"):
        await nfce.consultar(nfce.Entrada(chave=CHAVE, qr_param=P))
