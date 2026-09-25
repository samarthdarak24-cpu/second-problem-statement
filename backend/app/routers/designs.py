"""Saved designs.

This is the "PostgreSQL" half of the documented stack, and it is the part a
browser genuinely cannot do: a design that survives a page reload and can be
compared against a design somebody else saved.

The metrics are stored as a JSON blob rather than as columns, deliberately. They
are model *output*, not data the service owns — the shape changes whenever the
engine gains a metric, and a schema migration for that would be noise. The
parameters are also JSON for the same reason: they are the frontend's contract,
and re-declaring them as columns would create a second place to keep in step.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..models import SaveDesignRequest, SavedDesign

router = APIRouter(prefix="/api/designs", tags=["persistence"])


@router.get("", response_model=list[SavedDesign], summary="List saved designs")
def list_designs(
    location_id: str | None = Query(default=None, description="Filter by location id"),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[SavedDesign]:
    return [SavedDesign.model_validate(record) for record in db.list_designs(location_id, limit)]


@router.post("", response_model=SavedDesign, status_code=201, summary="Save a design")
def create_design(payload: SaveDesignRequest) -> SavedDesign:
    record = db.save_design(
        {
            "label": payload.label,
            "locationId": payload.location_id,
            "parameters": payload.parameters.model_dump(by_alias=True),
            "metrics": payload.metrics,
            "notes": payload.notes,
        }
    )
    return SavedDesign.model_validate(record)


@router.get("/{design_id}", response_model=SavedDesign, summary="Fetch one design")
def get_design(design_id: str) -> SavedDesign:
    record = db.get_design(design_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No design '{design_id}'")
    return SavedDesign.model_validate(record)


@router.delete("/{design_id}", summary="Delete a design")
def delete_design(design_id: str) -> dict[str, Any]:
    if not db.delete_design(design_id):
        raise HTTPException(status_code=404, detail=f"No design '{design_id}'")
    return {"deleted": design_id}


@router.get("/stats/summary", summary="How much is stored")
def stats() -> dict[str, Any]:
    """Counts, for the health panel. Cheap enough to call on every load."""
    designs = db.list_designs(limit=500)
    by_location: dict[str, int] = {}
    for record in designs:
        by_location[record["locationId"]] = by_location.get(record["locationId"], 0) + 1
    return {
        "designs": len(designs),
        "stations": db.station_count(),
        "models": len(db.all_surrogates()),
        "byLocation": by_location,
    }
