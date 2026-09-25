"""Surrogate-guided optimisation endpoint.

WHAT THIS RETURNS, AND WHY IT IS NOT AN `OptimizationResult`
The frontend's own optimiser produces a full `OptimizationResult` — parameters,
a complete `ThermalComfort`, a cost breakdown, a leaderboard. This endpoint does
not, and pretending otherwise would be the single most dishonest thing in the
project: filling a 40-field `ThermalComfort` from three surrogate predictions
would mean inventing the other 37 fields.

So the response is narrower and true: a ranked shortlist, three predicted
metrics per candidate, the model's held-out error bars, and a disclaimer. The
client's physics engine stays the authority on what a design actually does. The
endpoint is useful for exactly what a surrogate is good at — screening a space
far too large to simulate — and nothing else.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import climate as climate_engine
from .. import optimize as optimizer
from ..models import ScreenRequest, ScreenResponse

router = APIRouter(prefix="/api", tags=["optimisation"])


@router.post(
    "/optimize",
    response_model=ScreenResponse,
    summary="Screen a design neighbourhood with the surrogate",
)
def optimize(payload: ScreenRequest) -> ScreenResponse:
    """Rank a coordinate-descent neighbourhood using the trained surrogate.

    Requires a model that cleared the validation gate for every target. There is
    no fallback to a physics simulation here on purpose: if the client wanted a
    physics answer it would run its own engine, which is faster than a round trip.
    """
    # Climate is only needed for the site features the encoder consumes. When the
    # caller does not send one, resolve it from the offline catalogue so this
    # endpoint is usable on its own with curl.
    climate = payload.climate
    if climate is None:
        climate, _provider, _note = climate_engine.resolve_offline_for_location(payload.location)

    try:
        result = optimizer.screen_designs(
            payload.location,
            payload.requirements,
            payload.weights,
            climate,
            limit=payload.limit,
            exhaustive=payload.exhaustive,
        )
    except PermissionError as error:
        # No validated model. 503 rather than 500: the service is fine, the
        # capability is simply not available yet, and the client should fall back
        # to its own engine rather than retry.
        raise HTTPException(status_code=503, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return ScreenResponse.model_validate(result)


@router.get(
    "/design-space",
    summary="Describe the neighbourhood the screen endpoint explores",
)
def design_space(
    exhaustive: bool = False,
    location_id: str = "in-pune",
) -> dict[str, object]:
    """The axes and their options, with the size of the full cross product.

    Exposed so the UI can honestly say "screened 44 of 3,200,000 combinations"
    rather than claiming a full search it did not perform.
    """
    from .. import catalog
    from ..models import BuildingParameters

    station = catalog.get_station(location_id)
    if station is None:
        raise HTTPException(status_code=404, detail=f"No station '{location_id}'")

    requirements = BuildingParameters.model_validate(catalog.default_requirements())
    space = optimizer.build_design_space(requirements, exhaustive)

    return {
        "axes": list(optimizer.SEARCH_AXES),
        "options": {axis: len(space[axis]) for axis in optimizer.SEARCH_AXES},
        "spaceSize": optimizer.design_space_size(space),
        "evaluationsPerSweep": sum(len(space[axis]) for axis in optimizer.SEARCH_AXES),
        "exhaustive": exhaustive,
    }


@router.post("/climate-and-optimize", summary="Resolve climate, then screen")
async def climate_and_optimize(payload: ScreenRequest) -> dict[str, object]:
    """Convenience composition for a cold client: climate resolution plus screening.

    Kept separate from `/api/optimize` so the hot path stays a single, predictable
    request — this one can block on a network fetch when `prefer_live` is set.
    """
    resolution = await climate_engine.resolve_climate(payload.location)
    try:
        result = optimizer.screen_designs(
            payload.location,
            payload.requirements,
            payload.weights,
            resolution.data,
            limit=payload.limit,
            exhaustive=payload.exhaustive,
        )
    except (PermissionError, FileNotFoundError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return {
        "climate": resolution.data.model_dump(by_alias=True),
        "provider": resolution.provider,
        "note": resolution.note,
        "screen": result,
    }
