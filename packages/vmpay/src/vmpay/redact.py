"""O token da VMpay viaja na query string. Nada sai daqui sem passar por isto."""

import logging
import re

_TOKEN_RE = re.compile(r"(access_token=)([^&\s]+)")


def redact(text: str) -> str:
    """Troca o valor de access_token por [REDACTED] em qualquer string.

    Preserva o sufixo @id_filho de operadores filhos, que não é segredo e ajuda
    a identificar a chamada no log.
    """

    def _sub(m: re.Match[str]) -> str:
        value = m.group(2)
        child = ""
        if "@" in value:
            child = "@" + value.split("@", 1)[1]
        return f"{m.group(1)}[REDACTED]{child}"

    return _TOKEN_RE.sub(_sub, text)


class RedactFilter(logging.Filter):
    """Passa a mensagem já formatada por redact() antes de qualquer handler.

    O httpx loga cada requisição com a URL inteira em INFO — e a URL da VMpay
    carrega o access_token. No GitHub Actions o valor saía mascarado (***) e
    ninguém viu; no log do Render saía em claro (out/2026).
    """

    def filter(self, record: logging.LogRecord) -> bool:
        mensagem = record.getMessage()
        if "access_token=" in mensagem:
            record.msg = redact(mensagem)
            record.args = ()
        return True


#: Bibliotecas que logam a URL da requisição.
LOGGERS_HTTP = ("httpx", "httpcore")


def proteger_logs_http() -> None:
    """Instala o filtro nos loggers HTTP. Idempotente."""
    for nome in LOGGERS_HTTP:
        logger = logging.getLogger(nome)
        if not any(isinstance(f, RedactFilter) for f in logger.filters):
            logger.addFilter(RedactFilter())
