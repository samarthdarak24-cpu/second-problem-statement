"""Catalogue access: stations, materials and the shared design vocabulary.

The data comes from JSON written by `scripts/export-catalogue.ts`, which reads
the TypeScript modules. TypeScript therefore remains the single source of truth
for *data* — the same station normals, the same U-values, the same "high
insulation is 100 mm" mapping — and this service cannot quietly disagree with the
frontend about any of it.

Loaded once at import and cached, because these files do not change at runtime.
"""

from __future__ import annotations

import json
from functools import lru_cache
from math import asin, cos, radians, sin, sqrt
from typing import Any

from .config import DATA_DIR


def _load(name: str) -> dict[str, Any]:
    path = DATA_DIR / name
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path}. Run `npx tsx scripts/export-catalogue.ts` in the "
            "project root to generate the catalogue from the TypeScript source."
        )
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache
def _stations_payload() -> dict[str, Any]:
    return _load("stations.json")


@lru_cache
def _materials_payload() -> dict[str, Any]:
    return _load("materials.json")


@lru_cache
def _vocabulary_payload() -> dict[str, Any]:
    return _load("vocabulary.json")


# --------------------------------------------------------------------------- #
# Stations                                                                    #
# --------------------------------------------------------------------------- #


@lru_cache
def all_stations() -> tuple[dict[str, Any], ...]:
    return tuple(_stations_payload()["stations"])


@lru_cache
def station_index() -> dict[str, dict[str, Any]]:
    return {station["location"]["id"]: station for station in all_stations()}


def get_station(station_id: str) -> dict[str, Any] | None:
    return station_index().get(station_id)


@lru_cache
def countries() -> tuple[str, ...]:
    return tuple(sorted({station["location"]["country"] for station in all_stations()}))


def stations_in_country(country: str) -> list[dict[str, Any]]:
    return [s for s in all_stations() if s["location"]["country"] == country]


def haversine_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    """Great-circle distance, km.

    The same formula and the same Earth radius the TypeScript side uses, so a
    "nearest station" answer cannot differ between the two.
    """
    d_lat = radians(lat_b - lat_a)
    d_lon = radians(lon_b - lon_a)
    h = sin(d_lat / 2) ** 2 + cos(radians(lat_a)) * cos(radians(lat_b)) * sin(d_lon / 2) ** 2
    return 2 * 6371 * asin(min(1.0, sqrt(h)))


def nearest_station(latitude: float, longitude: float) -> tuple[dict[str, Any], float]:
    best: dict[str, Any] | None = None
    best_distance = float("inf")
    for station in all_stations():
        location = station["location"]
        distance = haversine_km(latitude, longitude, location["latitude"], location["longitude"])
        if distance < best_distance:
            best_distance = distance
            best = station
    if best is None:  # pragma: no cover - the catalogue is never empty
        raise RuntimeError("Station catalogue is empty")
    return best, best_distance


# --------------------------------------------------------------------------- #
# Materials                                                                   #
# --------------------------------------------------------------------------- #


@lru_cache
def all_materials() -> tuple[dict[str, Any], ...]:
    return tuple(_materials_payload()["materials"])


@lru_cache
def material_index() -> dict[str, dict[str, Any]]:
    return {material["id"]: material for material in all_materials()}


def materials_by_category(category: str) -> list[dict[str, Any]]:
    return [m for m in all_materials() if m["category"] == category]


# --------------------------------------------------------------------------- #
# Shared vocabulary                                                           #
# --------------------------------------------------------------------------- #


@lru_cache
def vocabulary() -> dict[str, Any]:
    return _vocabulary_payload()


def insulation_thickness(level: str) -> float:
    """Thickness for an insulation level, metres.

    Read from the exported vocabulary rather than duplicated here: the whole
    reason that mapping lives in one place is so that a slider, a cost estimate
    and a heat balance cannot disagree about how thick "high" is.
    """
    return float(vocabulary()["insulation"]["thicknessM"].get(level, 0.0))


def ventilation_ach(strategy: str) -> float:
    return float(vocabulary()["ventilation"]["ach"].get(strategy, 3.0))


def roof_pitch(roof_type: str) -> float:
    return float(vocabulary()["roof"]["pitchDeg"].get(roof_type, 0.0))


def default_requirements() -> dict[str, Any]:
    return dict(vocabulary()["defaultRequirements"])


def catalogue_stats() -> dict[str, int]:
    return {"stations": len(all_stations()), "materials": len(all_materials())}
