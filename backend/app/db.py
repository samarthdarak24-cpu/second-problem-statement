"""Persistence layer.

SQLAlchemy 2.0 with a JSON column type, so the same schema runs on PostgreSQL in
a deployment and SQLite in a test with no branching. The station catalogue is
stored relationally (one row per station, monthly normals as JSON) rather than
read from the exported file on every request, which is what makes the database
worth having: the file is the seed, the database is the source of truth at
runtime.

Nothing here recomputes anything. The database stores and returns; the engines
live in TypeScript.
"""

from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from sqlalchemy import JSON, Float, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# Tables                                                                      #
# --------------------------------------------------------------------------- #


class StationRow(Base):
    """One climatology station, with its twelve monthly normals."""

    __tablename__ = "stations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    city: Mapped[str] = mapped_column(String(128), index=True)
    state: Mapped[str] = mapped_column(String(128))
    country: Mapped[str] = mapped_column(String(128), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    elevation: Mapped[float] = mapped_column(Float)
    climate_type: Mapped[str] = mapped_column(String(128))
    climate_zone: Mapped[str] = mapped_column(String(32), index=True)
    monthly: Mapped[list[dict[str, Any]]] = mapped_column(JSON)

    def to_record(self) -> dict[str, Any]:
        return {
            "location": {
                "id": self.id,
                "city": self.city,
                "state": self.state,
                "country": self.country,
                "latitude": self.latitude,
                "longitude": self.longitude,
                "elevation": self.elevation,
            },
            "climateType": self.climate_type,
            "climateZone": self.climate_zone,
            "monthly": self.monthly,
        }


class DesignRow(Base):
    """A saved design: the programme, and whatever metrics were recorded with it.

    Metrics are stored as a JSON blob rather than as columns because they are
    model output, not data the service owns — the shape changes whenever the
    engine gains a metric, and a schema migration for that would be noise.
    """

    __tablename__ = "saved_designs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    label: Mapped[str] = mapped_column(String(200))
    location_id: Mapped[str] = mapped_column(String(64), index=True)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), index=True)

    def to_record(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "locationId": self.location_id,
            "parameters": self.parameters,
            "metrics": self.metrics,
            "notes": self.notes,
            "createdAt": self.created_at,
        }


class SurrogateRow(Base):
    """A trained surrogate model and the evidence that it earned its place.

    The key is `(id, target)`, not `id` alone. One training run fits a separate
    booster per target and gives them all the same `model_id`, so the id is
    shared by design — it is the handle that lets a prediction resolve every
    target together. Making `id` unique would allow only one target per run.
    """

    __tablename__ = "surrogate_models"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    target: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    r2: Mapped[float] = mapped_column(Float)
    rmse: Mapped[float] = mapped_column(Float)
    rows: Mapped[int] = mapped_column(Integer)
    passed_gate: Mapped[bool] = mapped_column(Integer)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON)
    feature_importance: Mapped[list[dict[str, float]]] = mapped_column(JSON)
    artifact_path: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[str] = mapped_column(String(40), index=True)

    def to_record(self) -> dict[str, Any]:
        return {
            "modelId": self.id,
            "target": self.target,
            "createdAt": self.created_at,
            "metrics": self.metrics,
            "featureImportance": self.feature_importance,
            "passedGate": bool(self.passed_gate),
        }


# --------------------------------------------------------------------------- #
# Engine and session                                                          #
# --------------------------------------------------------------------------- #

_settings = get_settings()

_connect_args = (
    {"check_same_thread": False} if _settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(
    _settings.database_url,
    echo=_settings.sql_echo,
    future=True,
    connect_args=_connect_args,
)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session scope."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """Create tables if they do not exist."""
    Base.metadata.create_all(engine)


def describe_database() -> str:
    """Redacted connection description, safe to return from `/api/health`."""
    url = _settings.database_url
    if "@" in url:  # postgresql://user:password@host/db
        scheme, rest = url.split("://", 1)
        return f"{scheme}://***@{rest.split('@', 1)[1]}"
    return url


# --------------------------------------------------------------------------- #
# Seeding                                                                     #
# --------------------------------------------------------------------------- #


def seed_stations(force: bool = False) -> int:
    """Load the exported station catalogue into the database.

    Idempotent: it updates existing rows rather than duplicating them, so running
    it after a catalogue export is safe.
    """
    from . import catalog

    with session_scope() as session:
        existing = {row.id for row in session.scalars(select(StationRow)).all()}
        written = 0

        for record in catalog.all_stations():
            location = record["location"]
            if location["id"] in existing and not force:
                continue
            row = session.get(StationRow, location["id"]) or StationRow(id=location["id"])
            row.city = location["city"]
            row.state = location["state"]
            row.country = location["country"]
            row.latitude = location["latitude"]
            row.longitude = location["longitude"]
            row.elevation = location["elevation"]
            row.climate_type = record["climateType"]
            row.climate_zone = record["climateZone"]
            row.monthly = record["monthly"]
            session.add(row)
            written += 1

        return written


# --------------------------------------------------------------------------- #
# Repositories                                                                #
# --------------------------------------------------------------------------- #


def list_station_rows() -> list[StationRow]:
    with session_scope() as session:
        return list(session.scalars(select(StationRow).order_by(StationRow.country, StationRow.city)))


def station_record(station_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        row = session.get(StationRow, station_id)
        return row.to_record() if row else None


def station_count() -> int:
    with session_scope() as session:
        return len(session.scalars(select(StationRow.id)).all())


def save_design(payload: dict[str, Any]) -> dict[str, Any]:
    design_id = payload.get("id") or str(uuid.uuid4())
    with session_scope() as session:
        row = DesignRow(
            id=design_id,
            label=payload["label"],
            location_id=payload["locationId"],
            parameters=payload["parameters"],
            metrics=payload.get("metrics") or {},
            notes=payload.get("notes"),
            created_at=_utcnow(),
        )
        session.add(row)
        return row.to_record()


def list_designs(location_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    with session_scope() as session:
        statement = select(DesignRow).order_by(DesignRow.created_at.desc()).limit(limit)
        if location_id:
            statement = (
                select(DesignRow)
                .where(DesignRow.location_id == location_id)
                .order_by(DesignRow.created_at.desc())
                .limit(limit)
            )
        return [row.to_record() for row in session.scalars(statement).all()]


def get_design(design_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        row = session.get(DesignRow, design_id)
        return row.to_record() if row else None


def delete_design(design_id: str) -> bool:
    with session_scope() as session:
        row = session.get(DesignRow, design_id)
        if row is None:
            return False
        session.delete(row)
        return True


def record_surrogate(payload: dict[str, Any]) -> dict[str, Any]:
    with session_scope() as session:
        row = SurrogateRow(
            id=payload["modelId"],
            target=payload["target"],
            r2=payload["metrics"]["r2"],
            rmse=payload["metrics"]["rmse"],
            rows=payload["metrics"]["rows"],
            passed_gate=1 if payload["metrics"]["passedGate"] else 0,
            metrics=payload["metrics"],
            feature_importance=payload["featureImportance"],
            artifact_path=payload["artifactPath"],
            created_at=payload["createdAt"],
        )
        session.add(row)
        return row.to_record()


def latest_surrogate(target: str | None = None) -> dict[str, Any] | None:
    with session_scope() as session:
        statement = select(SurrogateRow).order_by(SurrogateRow.created_at.desc())
        if target:
            statement = (
                select(SurrogateRow)
                .where(SurrogateRow.target == target)
                .order_by(SurrogateRow.created_at.desc())
            )
        row = session.scalars(statement).first()
        return row.to_record() if row else None


def all_surrogates() -> list[dict[str, Any]]:
    with session_scope() as session:
        rows = session.scalars(select(SurrogateRow).order_by(SurrogateRow.created_at.desc())).all()
        return [row.to_record() for row in rows]


def delete_surrogate(model_id: str) -> int:
    """Remove every target record for one model. Returns the number removed.

    The artefact files under `models/` are left alone — this makes a model
    unloadable, which is the reversible half of forgetting it.
    """
    with session_scope() as session:
        rows = session.scalars(
            select(SurrogateRow).where(SurrogateRow.id == model_id)
        ).all()
        for row in rows:
            session.delete(row)
        return len(rows)


def dumps(value: Any) -> str:
    """Stable JSON for logging and debug output."""
    return json.dumps(value, indent=2, sort_keys=True, default=str)
