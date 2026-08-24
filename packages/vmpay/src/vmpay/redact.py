"""O token da VMpay viaja na query string. Nada sai daqui sem passar por isto."""

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
