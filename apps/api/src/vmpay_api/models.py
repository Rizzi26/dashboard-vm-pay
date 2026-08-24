"""Tabelas do schema vmpay. Espelham supabase/migrations/0001_init.sql."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, DateTime, Integer, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "vmpay"


class Base(DeclarativeBase):
    pass


class SyncCursor(Base):
    __tablename__ = "sync_cursor"
    __table_args__ = {"schema": SCHEMA}

    resource: Mapped[str] = mapped_column(Text, primary_key=True)
    cursor_value: Mapped[int] = mapped_column(BigInteger, default=0)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    rows_ingested: Mapped[int] = mapped_column(BigInteger, default=0)


class _Dimension(Base):
    """Base das dimensões extraídas do payload das vendas."""

    __abstract__ = True

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Client(_Dimension):
    __tablename__ = "client"
    __table_args__ = {"schema": SCHEMA}


class Location(_Dimension):
    __tablename__ = "location"
    __table_args__ = {"schema": SCHEMA}


class Good(_Dimension):
    __tablename__ = "good"
    __table_args__ = {"schema": SCHEMA}


class Machine(Base):
    __tablename__ = "machine"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    asset_number: Mapped[str | None] = mapped_column(Text)
    model_id: Mapped[int | None] = mapped_column(BigInteger)
    model_name: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class CashlessFact(Base):
    __tablename__ = "cashless_fact"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str | None] = mapped_column(Text)
    point_of_sale: Mapped[str | None] = mapped_column(Text)
    place: Mapped[str | None] = mapped_column(Text)

    installation_id: Mapped[int | None] = mapped_column(BigInteger)
    planogram_item_id: Mapped[int | None] = mapped_column(BigInteger)
    equipment_id: Mapped[int | None] = mapped_column(BigInteger)
    equipment_label_number: Mapped[str | None] = mapped_column(Text)
    equipment_serial_number: Mapped[str | None] = mapped_column(Text)

    client_id: Mapped[int | None] = mapped_column(BigInteger)
    location_id: Mapped[int | None] = mapped_column(BigInteger)
    machine_id: Mapped[int | None] = mapped_column(BigInteger)
    good_id: Mapped[int | None] = mapped_column(BigInteger)

    quantity: Mapped[Decimal | None] = mapped_column(Numeric)
    value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    discount_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    number_of_payments: Mapped[int | None] = mapped_column(Integer)

    eft_provider_name: Mapped[str | None] = mapped_column(Text)
    eft_authorizer_name: Mapped[str | None] = mapped_column(Text)
    eft_card_brand_name: Mapped[str | None] = mapped_column(Text)
    eft_card_type_name: Mapped[str | None] = mapped_column(Text)

    uuid: Mapped[str | None] = mapped_column(Text)
    request_number: Mapped[str | None] = mapped_column(Text)
    order_id: Mapped[int | None] = mapped_column(BigInteger)
    physical_locator: Mapped[str | None] = mapped_column(Text)
    cashless_error_friendly: Mapped[str | None] = mapped_column(Text)

    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Vend(Base):
    __tablename__ = "vend"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    client_id: Mapped[int | None] = mapped_column(BigInteger)
    location_id: Mapped[int | None] = mapped_column(BigInteger)
    machine_id: Mapped[int | None] = mapped_column(BigInteger)
    installation_id: Mapped[int | None] = mapped_column(BigInteger)
    planogram_item_id: Mapped[int | None] = mapped_column(BigInteger)
    good_id: Mapped[int | None] = mapped_column(BigInteger)
    audit_id: Mapped[int | None] = mapped_column(BigInteger)
    coil: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric)
    value: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
