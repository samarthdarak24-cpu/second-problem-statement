"""Climate resolution.

A faithful port of `climate/classify.ts`, `climate/deriveClimate.ts` and the
provider chain in `climate/climateService.ts`. "Faithful" is testable rather than
aspirational: `tests/test_parity.py` compares this module's output against values
captured from the TypeScript engine and fails on any drift, because a backend
that classifies Pune as a different climate than the frontend does is worse than
no backend.

The provider chain is the same shape as the frontend's:

    1. Offline climatology database (station match by id)
    2. Inverse-distance interpolation of the nearest stations
    3. Latitude/elevation synthesis
    4. Optionally, the live Open-Meteo archive — an *upgrade* over 1–3, never a
       prerequisite, and bounded by a short probe timeout for the same reason the
       frontend bounds it: a dead network must not turn every request into a
       stall.
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

from . import catalog
from .config import get_settings
from .models import ClimateData, Location, MonthlyClimate
from .units import (
    DAYS_IN_MONTH,
    deg2rad,
    mean,
    normalize_deg,
    wet_bulb,
)

# --------------------------------------------------------------------------- #
# Classification                                                              #
# --------------------------------------------------------------------------- #

_CLASSIFICATION_FALLBACK = {
    "code": "H",
    "label": "Unclassified",
    "zone": "temperate",
    "annualMeanTemp": 20.0,
    "annualPrecip": 0.0,
    "coldestMonthTemp": 15.0,
    "warmestMonthTemp": 25.0,
    "annualHumidity": 60.0,
    "annualSolar": 5.0,
    "monsoonConcentration": 0.0,
}


def classify_climate(monthly: list[dict[str, Any]]) -> dict[str, Any]:
    """Köppen-style classification from 12 monthly normals.

    Deliberately simplified and explainable: it reproduces the Köppen family and
    second letter that matter for building design, without claiming full
    Köppen–Geiger precision.
    """
    if len(monthly) != 12:
        return dict(_CLASSIFICATION_FALLBACK)

    avg_temps = [m["avgTemp"] for m in monthly]
    annual_mean_temp = mean(avg_temps)
    coldest = min(avg_temps)
    warmest = max(avg_temps)
    annual_precip = sum(m["rainfall"] for m in monthly)
    annual_humidity = mean([m["humidity"] for m in monthly])
    annual_solar = mean([m["solarRadiation"] for m in monthly])

    max_window = 0.0
    for start in range(12):
        window = sum(monthly[(start + i) % 12]["rainfall"] for i in range(3))
        max_window = max(max_window, window)
    monsoon_concentration = max_window / annual_precip if annual_precip > 0 else 0.0

    # Köppen's aridity threshold: 20·T plus a term for how much rain falls in the
    # high-sun half of the year. See `climate/classify.ts` for why the previous
    # 12·T version was wrong — it classified Jodhpur, a desert, as a temperate
    # highland.
    northern = monthly[6]["avgTemp"] > monthly[0]["avgTemp"]
    high_sun_months = (3, 4, 5, 6, 7, 8) if northern else (9, 10, 11, 0, 1, 2)
    high_sun_rain = sum(monthly[index]["rainfall"] for index in high_sun_months)
    high_sun_share = high_sun_rain / annual_precip if annual_precip > 0 else 0.0

    aridity_threshold = 20 * annual_mean_temp + (
        280.0 if high_sun_share >= 0.7 else 140.0 if high_sun_share < 0.3 else 0.0
    )
    is_arid = annual_precip < aridity_threshold
    is_desert = annual_precip < 0.5 * aridity_threshold

    if is_arid:
        if annual_mean_temp >= 18:
            code, label = ("BWh", "Hot desert") if is_desert else ("BSh", "Hot semi-arid")
            zone = "hot-dry"
        else:
            code, label = ("BWk", "Cold desert") if is_desert else ("BSk", "Cold semi-arid")
            zone = "cold-desert"
    elif coldest >= 18:
        if annual_precip >= 2000:
            code, label, zone = "Af", "Tropical rainforest", "hot-humid"
        elif monsoon_concentration > 0.55 and annual_precip > 1200:
            code, label, zone = "Am", "Tropical monsoon", "hot-humid"
        else:
            code, label = "Aw", "Tropical wet and dry"
            zone = "hot-humid" if annual_humidity > 74 else "composite"
    elif coldest >= -3:
        hot_summer = warmest > 22
        humid = annual_humidity >= 66
        dry_winter = high_sun_share >= 0.7
        dry_summer = high_sun_share < 0.3

        if annual_mean_temp < 10:
            # A mild winter does not make a place temperate: Reykjavík's coldest
            # month sits just above freezing and its annual mean is 4 °C.
            code, label, zone = "Cfc", "Subpolar oceanic", "cold-cloudy"
        elif hot_summer and humid:
            code = "Cwa" if dry_winter else "Cfa"
            label = "Humid subtropical, dry winter" if dry_winter else "Humid subtropical"
            zone = "warm-humid"
        elif hot_summer and dry_summer:
            code, label, zone = "Csa", "Mediterranean", "hot-dry"
        elif hot_summer:
            code, label, zone = "Cwa", "Subtropical, dry winter", "composite"
        elif humid:
            code, label, zone = "Cfb", "Temperate oceanic", "temperate"
        else:
            code, label, zone = "Cwb", "Subtropical highland", "cold-cloudy"
    else:
        if warmest < 10:
            code = "ET" if annual_humidity > 72 else "EF"
            label = "Tundra" if annual_humidity > 72 else "Frost"
            zone = "cold-cloudy"
        elif warmest < 22:
            code, label = "Dfb", "Humid continental, warm summer"
            zone = "cold-sunny" if annual_solar >= 4.4 else "cold-cloudy"
        else:
            code, label = "Dfa", "Humid continental, hot summer"
            zone = "cold-sunny" if annual_solar >= 4.4 else "cold-cloudy"

    return {
        "code": code,
        "label": label,
        "zone": zone,
        "annualMeanTemp": annual_mean_temp,
        "annualPrecip": annual_precip,
        "coldestMonthTemp": coldest,
        "warmestMonthTemp": warmest,
        "annualHumidity": annual_humidity,
        "annualSolar": annual_solar,
        "monsoonConcentration": monsoon_concentration,
    }


# --------------------------------------------------------------------------- #
# Summary and design conditions                                               #
# --------------------------------------------------------------------------- #


def _circular_mean_direction(monthly: list[dict[str, Any]]) -> float:
    """Speed-weighted circular mean of wind directions, degrees.

    A plain arithmetic mean of compass bearings is wrong at the wrap-around — the
    mean of 350° and 10° is 0°, not 180° — so the directions are averaged as
    vectors.
    """
    x = 0.0
    y = 0.0
    for month in monthly:
        rad = deg2rad(month["windDirection"])
        x += math.cos(rad) * month["windSpeed"]
        y += math.sin(rad) * month["windSpeed"]
    if x == 0 and y == 0:
        return 225.0
    return normalize_deg(math.degrees(math.atan2(y, x)))


def derive_summary(monthly: list[dict[str, Any]]) -> dict[str, Any]:
    avg_temps = [m["avgTemp"] for m in monthly]
    max_temps = [m["maxTemp"] for m in monthly]
    min_temps = [m["minTemp"] for m in monthly]

    warmest = max(range(len(avg_temps)), key=lambda i: avg_temps[i])
    coldest = min(range(len(avg_temps)), key=lambda i: avg_temps[i])

    return {
        "avgTemperature": mean(avg_temps),
        "maxTemperature": max(max_temps),
        "minTemperature": min(min_temps),
        "humidity": mean([m["humidity"] for m in monthly]),
        "windSpeed": mean([m["windSpeed"] for m in monthly]),
        "windDirection": _circular_mean_direction(monthly),
        "solarRadiation": mean([m["solarRadiation"] for m in monthly]),
        "rainfall": sum(m["rainfall"] for m in monthly),
        "seasonalVariation": max(avg_temps) - min(avg_temps),
        "diurnalSwing": mean([m["maxTemp"] - m["minTemp"] for m in monthly]),
        "peakCoolingMonth": warmest,
        "peakHeatingMonth": coldest,
    }


def derive_design_conditions(monthly: list[dict[str, Any]]) -> dict[str, Any]:
    """Design conditions, as documented approximations of ASHRAE percentiles.

    Summer design dry-bulb approximates the 0.4 % cooling value as the hottest
    month's mean daily maximum plus 2.5 K; winter approximates the 99.6 % heating
    value as the coldest month's mean daily minimum minus 2.0 K. Both would
    normally need hourly records, which a monthly normals database does not have.
    """
    summary = derive_summary(monthly)
    hottest = monthly[summary["peakCoolingMonth"]]
    coldest = monthly[summary["peakHeatingMonth"]]

    summer_design_temp = hottest["maxTemp"] + 2.5
    summer_design_wet_bulb = wet_bulb(summer_design_temp, min(100.0, hottest["humidity"] + 8))
    winter_design_temp = coldest["minTemp"] - 2.0

    cooling_dd = 0.0
    heating_dd = 0.0
    for index, month in enumerate(monthly):
        days = DAYS_IN_MONTH[index]
        cooling_dd += days * max(0.0, month["avgTemp"] - 24)
        heating_dd += days * max(0.0, 18 - month["avgTemp"])

    return {
        "summerDesignTemp": summer_design_temp,
        "summerDesignWetBulb": summer_design_wet_bulb,
        "winterDesignTemp": winter_design_temp,
        "dailyRange": mean([m["maxTemp"] - m["minTemp"] for m in monthly]),
        "coolingDegreeDays": cooling_dd,
        "heatingDegreeDays": heating_dd,
    }


def apply_elevation(station: dict[str, Any], target_elevation: float) -> dict[str, Any]:
    """Re-apply the 6.5 K/km lapse rate for a different site elevation."""
    delta = (target_elevation - station["location"]["elevation"]) / 1000
    location = {**station["location"], "elevation": target_elevation}
    if abs(delta) < 0.001:
        return {**station, "location": location}

    shift = -6.5 * delta
    return {
        **station,
        "location": location,
        "monthly": [
            {
                **month,
                "avgTemp": month["avgTemp"] + shift,
                "maxTemp": month["maxTemp"] + shift,
                "minTemp": month["minTemp"] + shift,
            }
            for month in station["monthly"]
        ],
    }


def build_climate_data(
    station: dict[str, Any],
    source: Literal["database", "api", "simulated"],
    fetched_at: str | None = None,
) -> ClimateData:
    return ClimateData.model_validate(
        {
            "location": station["location"],
            "source": source,
            "climateType": station["climateType"],
            "climateZone": station["climateZone"],
            "summary": derive_summary(station["monthly"]),
            "monthly": station["monthly"],
            "designConditions": derive_design_conditions(station["monthly"]),
            "fetchedAt": fetched_at or datetime.now(timezone.utc).isoformat(),
        }
    )


# --------------------------------------------------------------------------- #
# Arbitrary coordinates                                                       #
# --------------------------------------------------------------------------- #


def interpolate_station(
    latitude: float, longitude: float, neighbours: int = 3
) -> tuple[dict[str, Any], float, int]:
    """Inverse-distance-weighted blend of the nearest stations."""
    ranked = sorted(
        (
            (
                station,
                catalog.haversine_km(
                    latitude,
                    longitude,
                    station["location"]["latitude"],
                    station["location"]["longitude"],
                ),
            )
            for station in catalog.all_stations()
        ),
        key=lambda pair: pair[1],
    )

    picked = ranked[: max(1, min(neighbours, len(ranked)))]
    weights = [1 / max(25.0, km) ** 2 for _, km in picked]
    weight_sum = sum(weights) or 1.0

    blended: list[dict[str, Any]] = []
    for month_index in range(12):
        rows = [station["monthly"][month_index] for station, _ in picked]

        def blend(key: str) -> float:
            # Wind direction must be blended on the circle, not as a scalar.
            if key == "windDirection":
                x = sum(
                    math.cos(deg2rad(row["windDirection"])) * weight
                    for row, weight in zip(rows, weights)
                )
                y = sum(
                    math.sin(deg2rad(row["windDirection"])) * weight
                    for row, weight in zip(rows, weights)
                )
                return normalize_deg(math.degrees(math.atan2(y, x)))
            return sum(row[key] * weight for row, weight in zip(rows, weights)) / weight_sum

        blended.append(
            {
                "month": month_index,
                "avgTemp": blend("avgTemp"),
                "maxTemp": blend("maxTemp"),
                "minTemp": blend("minTemp"),
                "humidity": blend("humidity"),
                "windSpeed": blend("windSpeed"),
                "windDirection": blend("windDirection"),
                "solarRadiation": blend("solarRadiation"),
                "rainfall": blend("rainfall"),
                "sunshineHours": blend("sunshineHours"),
            }
        )

    blended_elevation = (
        sum(station["location"]["elevation"] * weight for (station, _), weight in zip(picked, weights))
        / weight_sum
    )

    dominant = picked[0][0]
    nearest_location = dominant["location"]

    station = {
        "location": {
            "id": f"interp-{latitude:.2f}-{longitude:.2f}",
            "city": f"Near {nearest_location['city']}",
            "state": nearest_location["state"],
            "country": nearest_location["country"],
            "latitude": latitude,
            "longitude": longitude,
            "elevation": round(blended_elevation),
        },
        "climateType": f"{dominant['climateType']} (interpolated)",
        "climateZone": dominant["climateZone"],
        "monthly": blended,
    }

    mean_distance = sum(km for _, km in picked) / max(1, len(picked))
    return station, mean_distance, len(picked)


def synthesise_station(
    latitude: float, longitude: float, elevation: float = 0.0
) -> dict[str, Any]:
    """Latitude-driven synthesis, used only when no station is remotely close."""
    abs_lat = abs(latitude)

    sea_level_mean = 27.5 - 0.0065 * abs_lat**2
    mean_temp = sea_level_mean - (elevation / 1000) * 6.5

    amplitude = 0.3 * abs_lat
    peak_month = 4 if abs_lat < 15 else 6 if abs_lat > 40 else 5

    humidity_base = max(40.0, min(85.0, 72 - 0.3 * abs_lat))
    northern = latitude >= 0

    monthly: list[dict[str, Any]] = []
    for month in range(12):
        phase = ((month - peak_month + 12) % 12) * (math.pi / 6)
        avg_temp = mean_temp + amplitude * math.cos(phase)
        diurnal = 8 + abs_lat * 0.06
        shifted = month if northern else (month + 6) % 12
        humid_boost = 12 * math.cos(((shifted - peak_month - 2 + 12) % 12) * (math.pi / 6))
        humidity = max(25.0, min(92.0, humidity_base + humid_boost))

        monthly.append(
            {
                "month": month,
                "avgTemp": avg_temp,
                "maxTemp": avg_temp + diurnal / 2,
                "minTemp": avg_temp - diurnal / 2,
                "humidity": humidity,
                "windSpeed": 2 + abs_lat * 0.05,
                "windDirection": 225.0,
                "solarRadiation": max(1.2, 6.4 - abs_lat * 0.06),
                "rainfall": 60 + humidity * 0.8,
                "sunshineHours": max(2.5, 8.5 - abs_lat * 0.09),
            }
        )

    return {
        "location": {
            "id": f"synth-{latitude:.2f}-{longitude:.2f}",
            "city": f"Synthesised site ({latitude:.1f}°, {longitude:.1f}°)",
            "state": "—",
            "country": "—",
            "latitude": latitude,
            "longitude": longitude,
            "elevation": elevation,
        },
        "climateType": "Synthesised from latitude",
        "climateZone": _classify_zone_fallback(mean_temp, humidity_base),
        "monthly": monthly,
    }


def _classify_zone_fallback(mean_temp: float, humidity: float) -> str:
    if mean_temp < 12:
        return "cold-cloudy" if humidity > 70 else "cold-sunny"
    if mean_temp < 20:
        return "temperate"
    if humidity > 72:
        return "hot-humid"
    if humidity < 45:
        return "hot-dry"
    return "composite"


def resolve_offline_climate(
    latitude: float, longitude: float, elevation: float | None = None
) -> tuple[ClimateData, str, str]:
    """Resolve climate with no network access. Always succeeds."""
    station, mean_distance, used = interpolate_station(latitude, longitude)

    if mean_distance <= 1500:
        adjusted = station if elevation is None else apply_elevation(station, elevation)
        return (
            build_climate_data(adjusted, "simulated"),
            "interpolated",
            f"Interpolated from {used} nearest stations "
            f"(mean distance {round(mean_distance)} km).",
        )

    synthesised = synthesise_station(latitude, longitude, elevation or 0.0)
    return (
        build_climate_data(synthesised, "simulated"),
        "synthesised",
        "No station within 1500 km — synthesised from latitude and elevation.",
    )


def resolve_offline_for_location(location: Location) -> tuple[ClimateData, str, str]:
    station = catalog.get_station(location.id)
    if station is not None:
        return (
            build_climate_data(station, "database"),
            "database",
            f"Station record for {station['location']['city']}, "
            f"{station['location']['country']}.",
        )
    return resolve_offline_climate(location.latitude, location.longitude, location.elevation)


# --------------------------------------------------------------------------- #
# Live provider                                                               #
# --------------------------------------------------------------------------- #


@dataclass
class Resolution:
    data: ClimateData
    provider: str
    note: str
    attribution: str
    fallbacks: list[str]


# --------------------------------------------------------------------------- #
# Open-Meteo archive aggregation                                              #
# --------------------------------------------------------------------------- #

#: The archive window both engines aggregate. Fixed rather than rolling on
#: purpose: a shelter is designed against a climatology, and a climatology that
#: silently shifts every January would make a site's Köppen class — and every
#: design decision downstream of it — change for reasons that have nothing to
#: do with the site. Mirrored by `ARCHIVE_START_YEAR` / `ARCHIVE_END_YEAR` in
#: `climate/providers/openMeteo.ts`.
ARCHIVE_START_YEAR = 2019
ARCHIVE_END_YEAR = 2023
ARCHIVE_YEARS = ARCHIVE_END_YEAR - ARCHIVE_START_YEAR + 1

#: Daily variables requested from the archive. Daily aggregates carry
#: everything the pipeline needs; hourly records would be ~24× the payload to
#: compute the same twelve monthly numbers.
OPEN_METEO_DAILY_VARIABLES = [
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "relative_humidity_2m_mean",
    "wind_speed_10m_mean",
    "wind_direction_10m_dominant",
    "shortwave_radiation_sum",
    "precipitation_sum",
    "sunshine_duration",
]


def aggregate_open_meteo_daily(
    daily: dict[str, Any], years: int = ARCHIVE_YEARS
) -> list[dict[str, Any]]:
    """Reduce a multi-year daily archive payload to 12 monthly normals.

    Pure, so it can be tested without a network — which is the point. The live
    path is the one provider whose output cannot be compared against a captured
    fixture, and it is therefore the one that most needs its arithmetic pinned
    by a test rather than by inspection.

    Two traps this function exists to close:

    * **Rainfall is a total, not a rate.** Averaging the month's accumulated
      precipitation over its days gives a mean daily depth; twelve of those sum
      to roughly a thirtieth of the real annual total. That is enough to
      reclassify a monsoon city as a desert.
    * **Open-Meteo reports wind in km/h by default.** The caller asks for m/s
      (``wind_speed_unit=ms``); nothing here rescales, so a request that omits
      that parameter would inflate every wind figure by 3.6.
    """
    safe_years = years if years > 0 else 1
    dates: list[str] = daily.get("time") or []

    buckets: list[dict[str, list[float]]] = [{} for _ in range(12)]
    for index, date in enumerate(dates):
        month = int(date[5:7]) - 1
        bucket = buckets[month]
        for key, values in daily.items():
            if key == "time":
                continue
            value = values[index]
            if value is None:
                continue
            bucket.setdefault(key, []).append(float(value))

    def aggregate(key: str, fallback: float) -> list[float]:
        """Monthly mean of a daily variable."""
        out: list[float] = []
        for month in range(12):
            values = buckets[month].get(key) or []
            out.append(mean(values) if values else fallback)
        return out

    def aggregate_total(key: str) -> list[float]:
        """Monthly total of a daily accumulation, as a climatological normal.

        Dividing by the number of *years* in the window yields the mean depth
        that falls in that calendar month — the quantity Köppen and the design
        conditions both expect.
        """
        out: list[float] = []
        for month in range(12):
            values = buckets[month].get(key) or []
            out.append(sum(values) / safe_years if values else 0.0)
        return out

    avg_temp = aggregate("temperature_2m_mean", 25.0)
    max_temp = aggregate("temperature_2m_max", 30.0)
    min_temp = aggregate("temperature_2m_min", 20.0)
    humidity = aggregate("relative_humidity_2m_mean", 60.0)
    wind_speed = aggregate("wind_speed_10m_mean", 3.0)
    wind_direction = aggregate("wind_direction_10m_dominant", 225.0)
    # shortwave_radiation_sum arrives in MJ/m²/day; 1 MJ/m² = 0.2778 kWh/m².
    solar = [value * 0.2778 for value in aggregate("shortwave_radiation_sum", 5.0)]
    rainfall = aggregate_total("precipitation_sum")
    # sunshine_duration is a daily duration in seconds; the mean daily value
    # converted to hours is the monthly sunshine figure.
    sunshine = [value / 3600 for value in aggregate("sunshine_duration", 6.0 * 3600)]

    return [
        {
            "month": month,
            "avgTemp": avg_temp[month],
            "maxTemp": max_temp[month],
            "minTemp": min_temp[month],
            "humidity": humidity[month],
            "windSpeed": wind_speed[month],
            "windDirection": wind_direction[month],
            "solarRadiation": solar[month],
            "rainfall": rainfall[month],
            "sunshineHours": sunshine[month],
        }
        for month in range(12)
    ]


async def fetch_open_meteo_climate(
    location: Location, timeout_s: float | None = None
) -> ClimateData:
    """Fetch the Open-Meteo archive and aggregate it to monthly normals.

    The archive API needs no key. Only the variables the pipeline consumes are
    requested, so the response stays small enough to aggregate in one pass.
    """
    settings = get_settings()

    params = {
        "latitude": location.latitude,
        "longitude": location.longitude,
        "start_date": f"{ARCHIVE_START_YEAR}-01-01",
        "end_date": f"{ARCHIVE_END_YEAR}-12-31",
        "daily": ",".join(OPEN_METEO_DAILY_VARIABLES),
        # Open-Meteo defaults wind to km/h. The pipeline works in m/s
        # everywhere, so the unit is stated in the request rather than
        # converted afterwards — a conversion that is easy to forget is a
        # conversion that silently multiplies every wind figure by 3.6.
        "wind_speed_unit": "ms",
        "timezone": "auto",
    }

    timeout = timeout_s or settings.open_meteo_timeout_s
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(settings.open_meteo_base, params=params)
        response.raise_for_status()
        payload = response.json()

    monthly = aggregate_open_meteo_daily(payload["daily"])

    classification = classify_climate(monthly)
    station = {
        "location": location.model_dump(by_alias=True),
        "climateType": f"{classification['label']} ({classification['code']})",
        "climateZone": classification["zone"],
        "monthly": monthly,
    }
    return build_climate_data(station, "api")


# --------------------------------------------------------------------------- #
# Provider chain                                                              #
# --------------------------------------------------------------------------- #


async def resolve_climate(
    location: Location,
    prefer_live: bool = False,
    *,
    live_timeout_s: float | None = None,
) -> Resolution:
    """Resolve climate, preferring richer sources when they are reachable."""
    settings = get_settings()
    fallbacks: list[str] = []

    if prefer_live and settings.enable_live_climate:
        try:
            data = await asyncio.wait_for(
                fetch_open_meteo_climate(location, live_timeout_s),
                timeout=live_timeout_s or settings.open_meteo_timeout_s,
            )
            return Resolution(
                data=data,
                provider="open-meteo",
                note="Live reanalysis aggregated to monthly normals.",
                attribution="Open-Meteo historical weather archive (CC-BY 4.0).",
                fallbacks=fallbacks,
            )
        except Exception as error:  # noqa: BLE001 - any failure falls back
            fallbacks.append(
                f"Live API unavailable ({type(error).__name__}) — used offline data instead."
            )

    data, provider, note = resolve_offline_for_location(location)
    return Resolution(
        data=data,
        provider=provider,
        note=note,
        attribution="Offline climatology database (long-term monthly normals).",
        fallbacks=fallbacks,
    )
