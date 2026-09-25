"""Climate resolution.

`POST /api/climate/resolve` is the contract the frontend already speaks: it posts
`{ location, prefer_live }` and expects a `ClimateData` back, which
`api/client.ts` casts straight into the TypeScript type without validation. The
response model here is therefore not documentation — it is the only thing
preventing a renamed field from arriving as `undefined` and rendering an em dash
in the dashboard.

`tests/test_parity.py` pins the actual numbers against values captured from the
TypeScript engine, because a shape check cannot catch a unit error.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query

from .. import catalog, climate as climate_engine, db
from ..models import (
    ClimateData,
    ClimateStationRecord,
    Location,
    ResolveClimateRequest,
)

router = APIRouter(prefix="/api/climate", tags=["climate"])


@router.post(
    "/resolve",
    response_model=ClimateData,
    summary="Resolve climate for a location",
)
async def resolve(payload: ResolveClimateRequest) -> ClimateData:
    """Run the provider chain: live reanalysis when asked, offline otherwise.

    The offline catalogue is not a degraded mode — it is the same hand-checked
    normals the frontend uses. `prefer_live` is an upgrade request, and a failure
    to satisfy it is reported in the resolution note rather than raised, so a
    venue with no wifi still gets a working answer.
    """
    resolution = await climate_engine.resolve_climate(
        payload.location,
        payload.prefer_live,
    )
    return resolution.data


@router.get(
    "/resolve/{station_id}",
    response_model=ClimateData,
    summary="Resolve climate for a known station id",
)
async def resolve_station(station_id: str, prefer_live: bool = False) -> ClimateData:
    """Convenience GET for the catalogue's own stations, for curl and for tests."""
    station = catalog.get_station(station_id)
    if station is None:
        raise HTTPException(status_code=404, detail=f"No station '{station_id}' in the catalogue")
    location = Location.model_validate(station["location"])
    resolution = await climate_engine.resolve_climate(location, prefer_live)
    return resolution.data


@router.get(
    "/stations",
    response_model=list[Location],
    summary="Every station in the catalogue",
)
def stations(country: str | None = Query(default=None, description="Filter by country")) -> list[Location]:
    records = catalog.stations_in_country(country) if country else list(catalog.all_stations())
    return [Location.model_validate(record["location"]) for record in records]


@router.get("/countries", response_model=list[str], summary="Distinct countries")
def countries() -> list[str]:
    return list(catalog.countries())


@router.get(
    "/stations/{station_id}",
    response_model=ClimateStationRecord,
    summary="Raw monthly normals for one station",
)
def station(station_id: str) -> ClimateStationRecord:
    record = db.station_record(station_id) or catalog.get_station(station_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No station '{station_id}' in the catalogue")
    return ClimateStationRecord.model_validate(record)


@router.get("/nearest", summary="Nearest station to a coordinate")
def nearest(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
) -> dict[str, object]:
    """Nearest catalogue station, with its distance.

    Used when the user clicks a point on the map rather than picking a city.
    Distance is reported so the caller can decide whether interpolation is
    appropriate — the client's own rule is 1500 km.
    """
    station_record, distance_km = catalog.nearest_station(latitude, longitude)
    return {
        "location": station_record["location"],
        "distanceKm": round(distance_km, 1),
        "climateZone": station_record["climateZone"],
    }


@router.get("/preview", response_model=ClimateData, summary="Climate for an arbitrary coordinate")
async def preview(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    elevation: float = Query(default=0.0, ge=-500, le=9000),
) -> ClimateData:
    """Interpolate or synthesise climate for a coordinate not in the catalogue.

    Deliberately synchronous-offline: a map click should answer instantly, and
    the alternative — waiting on a live fetch for a point the user is still
    dragging — is worse than an interpolated answer labelled as interpolated.
    """
    location = Location(
        id=f"custom-{latitude:.3f}-{longitude:.3f}",
        country="",
        state="",
        city=f"{latitude:.3f}, {longitude:.3f}",
        latitude=latitude,
        longitude=longitude,
        elevation=elevation,
    )
    data, _provider, _note = climate_engine.resolve_offline_for_location(location)
    return data


@router.get("/ping", summary="Round-trip check that the climate engine responds")
async def ping() -> dict[str, object]:
    """Resolve one known station and report how long it took.

    A health check that only proves the process is alive is not much use; this
    one proves the provider chain actually produces a classified climate.
    """
    station_record = catalog.get_station("in-pune") or catalog.all_stations()[0]
    location = Location.model_validate(station_record["location"])
    started = asyncio.get_event_loop().time()
    resolution = await climate_engine.resolve_climate(location)
    elapsed_ms = (asyncio.get_event_loop().time() - started) * 1000
    return {
        "ok": True,
        "provider": resolution.provider,
        "station": location.city,
        "climateZone": resolution.data.climate_zone,
        "durationMs": round(elapsed_ms, 2),
    }
