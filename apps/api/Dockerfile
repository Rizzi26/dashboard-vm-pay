# Backend FastAPI + worker de ingestão.
#
# O contexto de build é a RAIZ do repo — o pacote vmpay é dependência por
# caminho (packages/vmpay) e precisa estar dentro do contexto:
#
#   docker build -f apps/api/Dockerfile -t vmpay-api .
#
# A mesma imagem serve os dois papéis:
#   API:    (comando default)
#   worker: docker run vmpay-api vmpay-ingest

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Camada de dependências primeiro: mudança de código não reinstala tudo.
COPY packages/vmpay/pyproject.toml packages/vmpay/pyproject.toml
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY packages/vmpay/src packages/vmpay/src
COPY apps/api/src apps/api/src

RUN pip install --quiet ./packages/vmpay ./apps/api

# Usuário sem privilégio — nada aqui precisa de root.
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

# O Render injeta PORT; localmente cai no 8000.
CMD ["sh", "-c", "uvicorn vmpay_api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
