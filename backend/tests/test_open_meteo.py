"""Live Open-Meteo aggregation — the arithmetic the fixtures cannot reach.

WHY THIS FILE EXISTS
`test_parity.py` compares the Python port against values captured from the
TypeScript engine. That covers the offline provider chain completely, because
both engines can be run against the same station records.

It cannot cover the live archive: the response is whatever Open-Meteo returns
today, so there is nothing to capture. That left the one provider whose numbers
are *measured* rather than modelled as the only one with no test at all — and it
shipped two bugs that nothing else could have caught.

THE TWO BUGS
1. Monthly rainfall was the **mean daily** depth rather than the monthly total.
   Dividing a month's accumulated precipitation by its number of days, then
   summing twelve of those, gives roughly a thirtieth of the real annual total.
   Pune's 1155 mm/yr read as 37.8 mm/yr, which is below the Köppen arid
   threshold — so the dashboard classified a monsoon city as a **hot desert
   (BWh)** and drew it with full confidence.
2. Open-Meteo answers in **km/h** unless the request says otherwise, and the
   request did not. A 2.9 m/s site was reported as 10.4 m/s, which is a
   near-gale, and the ventilation strategy downstream is sized off that number.

Both are now pinned here, against hand-checkable synthetic payloads.

Run:  cd backend && .venv/Scripts/python -m pytest
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app import climate as engine
from app.models import Location

# --------------------------------------------------------------------------- #
# Synthetic payload                                                           #
# --------------------------------------------------------------------------- #

YEARS = 3


def _daily_payload() -> dict[str, Any]:
    """A three-year archive whose arithmetic is checkable by hand.

    January receives 2.0 mm every day and July 10.0 mm every day, across three
    complete years. The January normal is therefore 2.0 × 31 = 62 mm and the
    July normal 10.0 × 31 = 310 mm, for an annual total of 372 mm. The buggy
    "mean daily" reading gives 2.0 and 10.0 — an annual total of 12 mm.
    """
    time: list[str] = []
    rain: list[float] = []
    for year in range(2019, 2019 + YEARS):
        for month in range(1, 13):
            if month == 2:
                days = 28
            elif month in (1, 3, 5, 7, 8, 10, 12):
                days = 31
            else:
                days = 30
            for day in range(1, days + 1):
                time.append(f"{year}-{month:02d}-{day:02d}")
                rain.append(10.0 if month == 7 else 2.0 if month == 1 else 0.0)

    count = len(time)
    return {
        "time": time,
        "temperature_2m_mean": [25.0] * count,
        "temperature_2m_max": [33.0] * count,
        "temperature_2m_min": [17.0] * count,
        "relative_humidity_2m_mean": [60.0] * count,
        # Already m/s — the request asks for that unit explicitly, and nothing
        # in the aggregation may rescale it.
        "wind_speed_10m_mean": [4.0] * count,
        "wind_direction_10m_dominant": [225.0] * count,
        "shortwave_radiation_sum": [18.0] * count,
        "precipitation_sum": rain,
        "sunshine_duration": [21600.0] * count,
    }


def _aggregate(payload: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return engine.aggregate_open_meteo_daily(payload or _daily_payload(), years=YEARS)


# --------------------------------------------------------------------------- #
# The window                                                                  #
# --------------------------------------------------------------------------- #


def test_archive_window_is_the_documented_fixed_window() -> None:
    """A design climatology must not shift when the calendar turns over.

    Both engines read this constant, so a change here is a change to what the
    landing page and the dashboard both call "the site's climate".
    """
    assert engine.ARCHIVE_START_YEAR == 2019
    assert engine.ARCHIVE_END_YEAR == 2023
    assert engine.ARCHIVE_YEARS == 5


def test_daily_variables_cover_every_field_the_pipeline_consumes() -> None:
    """A missing variable would silently fall back to a made-up constant."""
    for required in (
        "temperature_2m_mean",
        "temperature_2m_max",
        "temperature_2m_min",
        "relative_humidity_2m_mean",
        "wind_speed_10m_mean",
        "wind_direction_10m_dominant",
        "shortwave_radiation_sum",
        "precipitation_sum",
        "sunshine_duration",
    ):
        assert required in engine.OPEN_METEO_DAILY_VARIABLES


# --------------------------------------------------------------------------- #
# Rainfall — bug 1                                                            #
# --------------------------------------------------------------------------- #


def test_monthly_rainfall_is_a_total_not_a_mean_daily_depth() -> None:
    """The regression that classified a monsoon city as a desert."""
    monthly = _aggregate()

    assert monthly[0]["rainfall"] == pytest.approx(62.0, rel=1e-9)
    assert monthly[6]["rainfall"] == pytest.approx(310.0, rel=1e-9)
    assert monthly[3]["rainfall"] == pytest.approx(0.0, abs=1e-9)

    annual = sum(m["rainfall"] for m in monthly)
    assert annual == pytest.approx(372.0, rel=1e-9)

    # The failure mode this guards is smaller by roughly the length of a month,
    # so the two readings are never close enough to be confused.
    assert annual > 20 * (2.0 + 10.0)


def test_uniform_daily_rainfall_accumulates_across_the_month() -> None:
    """1 mm every day must give 30 or 31 mm a month — never 1 mm."""
    payload = _daily_payload()
    payload["precipitation_sum"] = [1.0] * len(payload["time"])

    monthly = _aggregate(payload)

    for month in monthly:
        assert month["rainfall"] > 27.0
    # 365 days a year at 1 mm/day, normalised over the window.
    assert sum(m["rainfall"] for m in monthly) == pytest.approx(365.0, rel=1e-9)


def test_annual_rainfall_is_normalised_by_the_length_of_the_window() -> None:
    """Five years of data must not read as five years of rain."""
    payload = _daily_payload()
    payload["precipitation_sum"] = [1.0] * len(payload["time"])

    three = engine.aggregate_open_meteo_daily(payload, years=3)
    five = engine.aggregate_open_meteo_daily(payload, years=5)

    assert sum(m["rainfall"] for m in three) == pytest.approx(365.0, rel=1e-9)
    assert sum(m["rainfall"] for m in five) == pytest.approx(365.0 * 3 / 5, rel=1e-9)


# --------------------------------------------------------------------------- #
# Wind — bug 2                                                                #
# --------------------------------------------------------------------------- #


def test_aggregation_does_not_rescale_wind() -> None:
    """Wind arrives in m/s because the request says so, and stays in m/s."""
    for month in _aggregate():
        assert month["windSpeed"] == pytest.approx(4.0, rel=1e-9)


# --------------------------------------------------------------------------- #
# Unit conversions                                                            #
# --------------------------------------------------------------------------- #


def test_radiation_and_sunshine_are_converted_to_the_pipeline_units() -> None:
    monthly = _aggregate()
    # 18 MJ/m²/day × 0.2778 = 5.0 kWh/m²/day.
    assert monthly[0]["solarRadiation"] == pytest.approx(5.0, abs=0.01)
    # 21600 s/day = 6 h/day.
    assert monthly[0]["sunshineHours"] == pytest.approx(6.0, rel=1e-9)


def test_temperatures_and_humidity_pass_through_unchanged() -> None:
    monthly = _aggregate()
    for month in monthly:
        assert month["avgTemp"] == pytest.approx(25.0, rel=1e-9)
        assert month["maxTemp"] == pytest.approx(33.0, rel=1e-9)
        assert month["minTemp"] == pytest.approx(17.0, rel=1e-9)
        assert month["humidity"] == pytest.approx(60.0, rel=1e-9)


# --------------------------------------------------------------------------- #
# Robustness                                                                  #
# --------------------------------------------------------------------------- #


def test_null_days_are_skipped_rather_than_counted_as_zero() -> None:
    """A gap in the archive must not become a reading of zero."""
    payload = _daily_payload()
    payload["precipitation_sum"] = [
        None if index % 3 == 0 else value
        for index, value in enumerate(payload["precipitation_sum"])
    ]
    payload["temperature_2m_mean"] = [None] * len(payload["time"])

    monthly = _aggregate(payload)

    # Two thirds of January's 2 mm days survive: 62 × 2/3.
    assert monthly[0]["rainfall"] == pytest.approx(62.0 * 2 / 3, rel=1e-6)
    # A month with no usable temperature falls back rather than reading as 0 °C.
    assert monthly[0]["avgTemp"] == pytest.approx(25.0)


def test_every_month_is_present_even_when_the_archive_is_empty() -> None:
    monthly = engine.aggregate_open_meteo_daily({"time": []}, years=5)
    assert len(monthly) == 12
    assert [m["month"] for m in monthly] == list(range(12))


# --------------------------------------------------------------------------- #
# The outgoing request                                                        #
# --------------------------------------------------------------------------- #


class _FakeArchiveResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeArchiveClient:
    """Captures the outgoing request so its parameters can be asserted."""

    captured: dict[str, Any] = {}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        return None

    async def __aenter__(self) -> "_FakeArchiveClient":
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def get(self, url: str, params: dict[str, Any] | None = None) -> Any:
        type(self).captured = {"url": url, "params": params or {}}
        return _FakeArchiveResponse({"daily": _daily_payload()})


def test_archive_request_states_the_wind_unit_and_the_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The unit belongs in the request, not in a conversion nobody remembers.

    Open-Meteo answers in km/h unless told otherwise. Omitting this parameter
    multiplies every wind speed by 3.6 — which is how the dashboard came to
    report a 2.9 m/s site as a 10.4 m/s one.
    """
    monkeypatch.setattr(engine.httpx, "AsyncClient", _FakeArchiveClient)

    location = Location(
        id="in-pune",
        city="Pune",
        state="Maharashtra",
        country="India",
        latitude=18.52,
        longitude=73.86,
        elevation=560,
    )
    data = asyncio.run(engine.fetch_open_meteo_climate(location))

    params = _FakeArchiveClient.captured["params"]
    assert params["wind_speed_unit"] == "ms"
    assert params["start_date"] == f"{engine.ARCHIVE_START_YEAR}-01-01"
    assert params["end_date"] == f"{engine.ARCHIVE_END_YEAR}-12-31"
    for variable in engine.OPEN_METEO_DAILY_VARIABLES:
        assert variable in params["daily"]

    assert data.source == "api"
    # The payload spans YEARS years but the function normalises by the
    # documented window, so the two only agree when they are the same length.
    expected_annual = 372.0 * YEARS / engine.ARCHIVE_YEARS
    assert data.summary.rainfall == pytest.approx(expected_annual, rel=1e-9)
    assert data.summary.wind_speed == pytest.approx(4.0, rel=1e-9)
