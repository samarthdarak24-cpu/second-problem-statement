"""Service health and capability reporting.

`GET /api/health` is the one endpoint the frontend polls, and its shape is fixed
by `api/client.ts`'s `BackendHealth`: `status`, `version`, `engines`. The extra
fields are additive — a client that only reads the three it knows about keeps
working, and a human poking at the service gets a useful picture of what is
actually loaded.
"""

from __future__ import annotations

from fastapi import APIRouter

from .. import catalog, db
from ..config import get_settings
from ..models import HealthResponse

router = APIRouter(tags=["service"])


@router.get("/api/health", response_model=HealthResponse, summary="Liveness and capability probe")
def health() -> HealthResponse:
    settings = get_settings()
    stats = catalog.catalogue_stats()

    # Reported honestly rather than optimistically: `surrogate_ready` is true
    # only when a trained model actually cleared its validation gate *for every
    # target*. Checking `any(...)` over the per-target rows would report ready
    # as soon as one target passed — while `/api/optimize` still refuses, which
    # is exactly the kind of overstatement this service is meant to avoid. The
    # readiness rule is defined once, in `ml.describe_registry`, and reused here
    # so the two can never drift apart.
    from ..ml import describe_registry

    surrogate_ready = describe_registry()["ready"] > 0

    engines = ["climate", "catalogue", "persistence"]
    engines.append("ml-surrogate" if surrogate_ready else "ml-untrained")

    return HealthResponse(
        status="ok",
        version=settings.version,
        engines=engines,
        database=db.describe_database(),
        stations=stats["stations"],
        materials=stats["materials"],
        surrogate_ready=surrogate_ready,
    )
