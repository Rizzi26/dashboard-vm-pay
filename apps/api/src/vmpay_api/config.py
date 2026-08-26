"""Configuração do backend, toda por variável de ambiente (Render, .env local)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    #: Connection string do Postgres do Supabase. Use o **pooler** (porta 6543)
    #: em serverless; a conexão direta (5432) é para o worker de ingestão, que é
    #: longo e se beneficia de sessão persistente.
    database_url: str = Field(default="", alias="DATABASE_URL")

    #: Chave de operador dedicada à ingestão. O limite de 300 req/min é por
    #: token, então esta não deve ser a mesma do MCP nem a da API.
    vmpay_token: str = Field(default="", alias="VMPAY_INGEST_TOKEN")
    vmpay_base: str = Field(default="", alias="VMPAY_BASE")

    #: Quantos registros acumular antes de gravar e avançar o cursor.
    ingest_batch_size: int = Field(default=500, alias="INGEST_BATCH_SIZE")

    #: Teto por rodada, para uma execução agendada não varrer anos de histórico
    #: sem querer. 0 desliga o teto (use no backfill).
    ingest_max_rows: int = Field(default=50_000, alias="INGEST_MAX_ROWS")

    #: Origens liberadas no CORS — o domínio da Vercel.
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")

    #: Trava de escrita na VMpay. DESLIGADA por padrão: com o banco populado de
    #: dados de produção, nenhuma ação (restock, preço) alcança a VMpay até
    #: alguém ligar isto de propósito no ambiente. Mesmo nome e semântica do
    #: interruptor do MCP.
    vmpay_allow_writes: bool = Field(default=False, alias="VMPAY_ALLOW_WRITES")

    # ------------------------------------------------------------ Supabase Auth

    #: URL do projeto Supabase (https://<ref>.supabase.co). Usada para montar o
    #: JWKS e para a Admin API de convite de usuário.
    supabase_url: str = Field(default="", alias="SUPABASE_URL")

    #: Service role key — SÓ para convite/remoção de usuário via Admin API.
    #: Nunca vai para o frontend.
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    #: Audience esperada no JWT. O Supabase emite "authenticated".
    supabase_jwt_aud: str = Field(default="authenticated", alias="SUPABASE_JWT_AUD")

    #: Segredo HS256 (projetos Supabase antigos e testes). Se vazio, a validação
    #: usa o JWKS assimétrico do projeto — o default dos projetos novos.
    supabase_jwt_secret: str = Field(default="", alias="SUPABASE_JWT_SECRET")

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def dashboard_url(self) -> str:
        """Para onde os emails de auth (convite, recuperação) mandam o usuário.

        A primeira origem do CORS é o dashboard por construção — reaproveitar
        evita uma variável a mais que alguém esquece de trocar e deixa o
        convite apontando para localhost.
        """
        origins = self.allowed_origins
        return origins[0] if origins else "http://localhost:3000"

    @property
    def asyncpg_url(self) -> str:
        """SQLAlchemy async quer o driver no esquema; o Supabase entrega postgresql://."""
        url = self.database_url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url


@lru_cache
def settings() -> Settings:
    return Settings()
