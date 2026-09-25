"""FastAPI application.

WHAT THE SERVICE IS FOR
The frontend is a complete, self-contained application: every engine — climate
classification, thermal simulation, PMV, solar geometry, optimisation — has a
verified TypeScript implementation that runs in the browser. Nothing here is
required for the demo to work, and that is a deliberate design decision rather
than an accident.

The service exists because three things genuinely belong on a server:

  1. CLIMATE CACHING. Resolving a site's climate is a network fetch and an
     aggregation over five years of daily reanalysis. Doing it once and serving
     it to every client is what a cache is for.
  2. PERSISTENCE. A saved design that survives a page reload is not something a
     browser can offer.
  3. MODEL SERVING. Training a gradient-boosted surrogate is CPU-bound and the
     artefact is too large to ship to a browser.

It deliberately does *not* re-implement the thermal physics. Two authorities on
thermal performance that can disagree with each other is strictly worse than
one, so the Python side consumes the verified engine's output as training data
and as its catalogue of record — see `scripts/export-catalogue.ts`.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import catalog, db
from .config import get_settings
from .routers import catalogue, climate, designs, health, ml_routes, optimize

logger = logging.getLogger("thermal_shelter")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Create the schema, seed the station catalogue, report what loaded."""
    settings = get_settings()

    db.init_db()
    written = db.seed_stations()
    stats = catalog.catalogue_stats()

    logger.info(
        "%s v%s ready — %d stations (%d newly seeded), %d materials, db=%s",
        settings.app_name,
        settings.version,
        stats["stations"],
        written,
        stats["materials"],
        db.describe_database(),
    )

    if not settings.enable_live_climate:
        logger.warning("Live climate is disabled; every request will use the offline catalogue.")

    yield


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Climate resolution, catalogue access, persisted designs and a trained "
        "surrogate for screening design candidates.\n\n"
        "**The thermal physics is not implemented here.** It lives in the verified "
        "TypeScript engine in the frontend. This service caches, persists and serves "
        "models; it is not a second authority on what a design does."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(climate.router)
app.include_router(catalogue.router)
app.include_router(ml_routes.router)
app.include_router(optimize.router)
app.include_router(designs.router)


# --------------------------------------------------------------------------- #
# Error handling                                                              #
# --------------------------------------------------------------------------- #


@app.exception_handler(FileNotFoundError)
async def missing_file(_request: Request, error: FileNotFoundError) -> JSONResponse:
    """A missing artefact is a configuration problem, not a client error.

    503 rather than 500: the client should fall back to its own engine, and 503
    is the status that says "this capability is not available right now" rather
    than "your request was wrong" or "the server is broken".
    """
    return JSONResponse(
        status_code=503,
        content={
            "detail": str(error),
            "hint": (
                "Run `npx tsx scripts/export-catalogue.ts` to regenerate the catalogue, "
                "or `npm run export:dataset` followed by POST /api/ml/train to build a model."
            ),
        },
    )


@app.exception_handler(PermissionError)
async def refused(_request: Request, error: PermissionError) -> JSONResponse:
    """A model that failed its validation gate refused to answer.

    Reported as 503 with the reason intact. This is the single most important
    error in the service: it is the mechanism that stops a confidently wrong
    model from quietly ranking designs.
    """
    return JSONResponse(
        status_code=503,
        content={
            "detail": str(error),
            "reason": "surrogate-failed-validation-gate",
        },
    )


@app.exception_handler(ValueError)
async def invalid_request(_request: Request, error: ValueError) -> JSONResponse:
    """A handler raised a `ValueError`: the request asked for something invalid.

    This is how the training and screening gates report themselves — "need at
    least 200 rows", "unknown target", "prediction needs all 42 features". They
    are the caller's mistake, so they are a 422 with the message intact, not a
    500 that hides the reason behind a stack trace.
    """
    return JSONResponse(status_code=422, content={"detail": str(error)})


@app.get("/", include_in_schema=False)
def index() -> dict[str, object]:
    return {
        "service": settings.app_name,
        "version": settings.version,
        "docs": "/docs",
        "endpoints": [
            "GET  /api/health",
            "POST /api/climate/resolve",
            "GET  /api/climate/stations",
            "GET  /api/climate/nearest",
            "GET  /api/materials",
            "GET  /api/vocabulary",
            "GET  /api/ml/contract",
            "GET  /api/ml/registry",
            "POST /api/ml/train",
            "POST /api/ml/predict",
            "POST /api/optimize",
            "GET  /api/designs",
            "POST /api/designs",
        ],
        "note": (
            "The thermal physics engine is not implemented in this service. It lives in "
            "the verified TypeScript frontend; this service caches, persists and serves models."
        ),
    }
