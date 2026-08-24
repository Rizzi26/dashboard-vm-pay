"""Exceções da API VMpay, mapeadas a partir dos códigos documentados."""


class VMpayError(Exception):
    """Base. Nunca carrega o access_token na mensagem."""

    def __init__(self, message: str, *, status: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


class VMpayBadRequest(VMpayError):
    """400 — parâmetro obrigatório faltando, formato de data inválido, per_page > 1000."""


class VMpayAuthError(VMpayError):
    """401 — token de acesso inválido ou ausente."""


class VMpayNotFound(VMpayError):
    """404 — entidade não encontrada."""


class VMpayConflict(VMpayError):
    """409 — conflito no request."""


class VMpayValidationError(VMpayError):
    """422 — entidade não salva por erros de validação."""


class VMpayRateLimited(VMpayError):
    """429 — 300 req/min por access_token estourado."""


STATUS_MAP: dict[int, type[VMpayError]] = {
    400: VMpayBadRequest,
    401: VMpayAuthError,
    404: VMpayNotFound,
    409: VMpayConflict,
    422: VMpayValidationError,
    429: VMpayRateLimited,
}


def for_status(status: int, body: str) -> VMpayError:
    cls = STATUS_MAP.get(status, VMpayError)
    return cls(f"VMpay respondeu HTTP {status}", status=status, body=body[:500])
