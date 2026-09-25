"""Parity between the Python backend and the verified TypeScript engine.

WHY THIS FILE EXISTS
`backend/app/climate.py` is a *port* of `climate/deriveClimate.ts` and
`climate/classify.ts`. A port is a copy, and copies drift. Worse, this particular
copy is of a physics pipeline, so drift does not look like a bug — it looks like
a slightly different number, and the dashboard would render it with the same
confidence as the right one.

The guard is a fixture file: `scripts/export-dataset.ts` captures the TypeScript
engine's output for all 33 stations, and this module asserts the Python port
reproduces every field. That covers all eight climate zones, because a single
convenient station would only ever test one code path through the classifier.

WHAT A SHAPE CHECK WOULD MISS
A response-model test can prove the JSON has a `solarRadiation` key. It cannot
prove the value is in kWh/m²/day rather than MJ/m²/day, or that the wet-bulb is
on the right side of the dry-bulb. Only comparing against captured numbers can.

Run:  cd backend && .venv/Scripts/python -m pytest
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from app import catalog, ml, units
from app import climate as engine
from app.config import DATA_DIR
from app.models import Location

# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #

FIXTURE_PATH = DATA_DIR / "climate-fixtures.json"
CONTRACT_PATH = DATA_DIR / "feature-contract.json"
TRAINING_PATH = DATA_DIR / "training-set.json"

pytestmark = pytest.mark.skipif(
    not FIXTURE_PATH.exists(),
    reason="Run `npx tsx scripts/export-dataset.ts` in the project root first.",
)


def _load(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


CLIMATE_FIXTURES: list[dict[str, Any]] = _load(FIXTURE_PATH)["fixtures"]
FIXTURE_IDS = [fixture["stationId"] for fixture in CLIMATE_FIXTURES]

# The engine is deterministic double-precision arithmetic on both sides, so the
# tolerance is only there to absorb the difference between `Math.atan2` and
# `math.atan2` in the last bit. Anything looser would hide a real disagreement.
REL = 1e-9
ABS = 1e-9


def close(actual: float, expected: float) -> bool:
    return math.isclose(actual, expected, rel_tol=REL, abs_tol=ABS)


# --------------------------------------------------------------------------- #
# Contract guards                                                             #
# --------------------------------------------------------------------------- #


def test_feature_contract_matches_typescript() -> None:
    """The Python copy of FEATURE_NAMES must equal the exported TypeScript list.

    A reordered column is the one failure mode that produces plausible-looking
    wrong numbers, so it gets its own test rather than relying on the runtime
    guard in `ml.assert_contract()`.
    """
    payload = _load(CONTRACT_PATH)
    assert list(ml.FEATURE_NAMES) == payload["featureNames"], (
        "backend/app/ml.py FEATURE_NAMES has drifted from ml/features.ts"
    )
    assert list(ml.TARGET_NAMES) == payload["targetNames"]


def test_ml_contract_self_check_passes() -> None:
    """`assert_contract()` must not raise against the exported file."""
    ml.assert_contract()


def test_feature_vector_width_is_42() -> None:
    assert len(ml.FEATURE_NAMES) == 42
    assert len(ml.TARGET_NAMES) == 3


def test_training_set_columns_match_contract() -> None:
    payload = _load(TRAINING_PATH)
    expected = set(payload["featureNames"]) | set(payload["targetNames"])
    assert set(payload["rows"][0].keys()) == expected
    assert len(payload["rows"]) >= 200, "the gate needs at least 200 rows"


# --------------------------------------------------------------------------- #
# Catalogue parity                                                            #
# --------------------------------------------------------------------------- #


def test_station_catalogue_matches_export() -> None:
    payload = _load(DATA_DIR / "stations.json")
    assert len(catalog.all_stations()) == payload["stationCount"]
    assert {s["location"]["id"] for s in catalog.all_stations()} == {
        s["location"]["id"] for s in payload["stations"]
    }


def test_material_catalogue_matches_export() -> None:
    payload = _load(DATA_DIR / "materials.json")
    assert len(catalog.all_materials()) == len(payload["materials"])
    for expected in payload["materials"]:
        actual = catalog.material_index()[expected["id"]]
        assert actual["name"] == expected["name"]
        assert close(actual["uValue"], expected["uValue"])


def test_material_indices_are_stable_within_category() -> None:
    """The encoder indexes materials within their category, so the order matters.

    Asserting the *order* rather than just membership: the surrogate's column
    `wall_material_index` is meaningless if the catalogue is reordered, and the
    model would keep predicting — just wrongly.
    """
    walls = [m["id"] for m in catalog.materials_by_category("wall")]
    assert walls[:3] == ["rcc", "brick", "flyash-brick"]
    windows = [m["id"] for m in catalog.materials_by_category("window")]
    assert windows == ["single", "double", "double-lowe", "triple"]


def test_insulation_thickness_matches_vocabulary() -> None:
    expected = catalog.vocabulary()["insulation"]["thicknessM"]
    for level, thickness in expected.items():
        assert close(catalog.insulation_thickness(level), thickness)


def test_ventilation_ach_matches_vocabulary() -> None:
    expected = catalog.vocabulary()["ventilation"]["ach"]
    for strategy, ach in expected.items():
        assert close(catalog.ventilation_ach(strategy), ach)


def test_roof_pitch_matches_vocabulary() -> None:
    expected = catalog.vocabulary()["roof"]["pitchDeg"]
    for form, pitch in expected.items():
        assert close(catalog.roof_pitch(form), pitch)


# --------------------------------------------------------------------------- #
# Climate engine parity                                                       #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("fixture", CLIMATE_FIXTURES, ids=FIXTURE_IDS)
def test_climate_classification_matches(fixture: dict[str, Any]) -> None:
    location = Location.model_validate(fixture["location"])
    data, _provider, _note = engine.resolve_offline_for_location(location)
    assert data.climate_zone == fixture["climateZone"], f"{fixture['stationId']} zone"
    assert data.climate_type == fixture["climateType"], f"{fixture['stationId']} classification"


@pytest.mark.parametrize("fixture", CLIMATE_FIXTURES, ids=FIXTURE_IDS)
def test_climate_summary_matches(fixture: dict[str, Any]) -> None:
    location = Location.model_validate(fixture["location"])
    data, _provider, _note = engine.resolve_offline_for_location(location)
    actual = data.summary.model_dump(by_alias=True)

    for key, expected in fixture["summary"].items():
        assert close(actual[key], expected), f"{fixture['stationId']}.summary.{key}"


@pytest.mark.parametrize("fixture", CLIMATE_FIXTURES, ids=FIXTURE_IDS)
def test_design_conditions_match(fixture: dict[str, Any]) -> None:
    location = Location.model_validate(fixture["location"])
    data, _provider, _note = engine.resolve_offline_for_location(location)
    actual = data.design_conditions.model_dump(by_alias=True)

    for key, expected in fixture["designConditions"].items():
        assert close(actual[key], expected), f"{fixture['stationId']}.designConditions.{key}"


@pytest.mark.parametrize("fixture", CLIMATE_FIXTURES, ids=FIXTURE_IDS)
def test_monthly_normals_match(fixture: dict[str, Any]) -> None:
    """Every month, every field — 108 comparisons per station.

    This is the test that would catch a unit error. A summary can look plausible
    with the wrong units; twelve months of a station's real normals cannot.
    """
    location = Location.model_validate(fixture["location"])
    data, _provider, _note = engine.resolve_offline_for_location(location)

    assert len(data.monthly) == 12
    for expected_month, actual_month in zip(fixture["monthly"], data.monthly):
        actual = actual_month.model_dump(by_alias=True)
        for key, expected in expected_month.items():
            if key == "month":
                assert actual[key] == expected
                continue
            assert close(actual[key], expected), (
                f"{fixture['stationId']} month {expected_month['month']} {key}"
            )


@pytest.mark.parametrize("fixture", CLIMATE_FIXTURES[:8], ids=FIXTURE_IDS[:8])
def test_peak_months_agree(fixture: dict[str, Any]) -> None:
    """Warmest and coldest month indices, which drive the whole comfort story."""
    location = Location.model_validate(fixture["location"])
    data, _provider, _note = engine.resolve_offline_for_location(location)
    assert data.summary.peak_cooling_month == fixture["summary"]["peakCoolingMonth"]
    assert data.summary.peak_heating_month == fixture["summary"]["peakHeatingMonth"]


# --------------------------------------------------------------------------- #
# Climate classification parity                                               #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("fixture", CLIMATE_FIXTURES, ids=FIXTURE_IDS)
def test_classifier_matches_typescript(fixture: dict[str, Any]) -> None:
    """The Köppen heuristic must reproduce the TypeScript output exactly.

    This compares the *derived* classification, not the stored design zone. The
    two are different quantities: `climateZone` is the catalogue's hand-checked
    answer to "what does this climate ask of a building?", while the classifier
    answers "what does the rainfall and temperature regime look like?". The port
    computes the latter, so the latter is what must match.
    """
    expected = fixture["derivedClassification"]
    actual = engine.classify_climate(fixture["monthly"])

    assert actual["zone"] == expected["zone"], f"{fixture['stationId']} zone"
    assert actual["code"] == expected["code"], f"{fixture['stationId']} code"
    assert actual["label"] == expected["label"], f"{fixture['stationId']} label"

    for key in (
        "annualMeanTemp",
        "annualPrecip",
        "coldestMonthTemp",
        "warmestMonthTemp",
        "annualHumidity",
        "annualSolar",
        "monsoonConcentration",
    ):
        assert close(actual[key], expected[key]), f"{fixture['stationId']}.{key}"


def test_no_station_is_classified_across_the_hot_cold_divide() -> None:
    """The invariant that would have caught the aridity-threshold bug.

    The previous threshold was `12·T` instead of Köppen's `20·T + 280`, so
    Jodhpur — 27 °C annual mean, 330 mm of rain — failed the aridity test by four
    millimetres and was classified as a subtropical *highland*. A classifier that
    can call a desert cold is broken in a way no shape check would notice.
    """
    cold_zones = {"cold-cloudy", "cold-sunny", "cold-desert"}
    hot_zones = {"hot-dry", "hot-humid", "warm-humid"}

    violations: list[str] = []
    for fixture in CLIMATE_FIXTURES:
        derived = engine.classify_climate(fixture["monthly"])
        mean_temp = derived["annualMeanTemp"]
        if mean_temp >= 20 and derived["zone"] in cold_zones:
            violations.append(f"{fixture['stationId']} (mean {mean_temp:.1f} °C) → {derived['zone']}")
        if mean_temp <= 10 and derived["zone"] in hot_zones:
            violations.append(f"{fixture['stationId']} (mean {mean_temp:.1f} °C) → {derived['zone']}")

    assert not violations, "hot/cold misclassification: " + "; ".join(violations)


def test_aridity_threshold_is_koppen_not_a_fraction_of_temperature() -> None:
    """A monsoonal desert must be arid, and the desert/steppe split must bite.

    Checked directly on Jodhpur's normals rather than through the fixture, so the
    test states the physical claim rather than restating the implementation.
    """
    jodhpur = next(f for f in CLIMATE_FIXTURES if f["stationId"] == "in-jodhpur")
    derived = engine.classify_climate(jodhpur["monthly"])

    assert derived["annualMeanTemp"] > 25, "Jodhpur should be hot"
    assert derived["annualPrecip"] < 500, "Jodhpur should be dry"
    assert derived["zone"] == "hot-dry"
    assert derived["code"] in {"BWh", "BSh"}, "Jodhpur is a B climate"


def test_classifier_handles_a_short_month_list() -> None:
    """A malformed input must degrade to the documented fallback, not raise."""
    fallback = engine.classify_climate([])
    assert fallback["code"] == "H"
    assert fallback["zone"] == "temperate"


# --------------------------------------------------------------------------- #
# Interpolation and synthesis                                                 #
# --------------------------------------------------------------------------- #


def test_interpolated_climate_is_internally_consistent() -> None:
    """A synthesised climate must still classify and derive cleanly.

    The numbers cannot be compared against TypeScript without a second fixture
    file, but the invariants can: twelve months, a real zone, and a summary that
    actually matches its own monthly data.
    """
    data, provider, _note = engine.resolve_offline_climate(latitude=22.0, longitude=78.0, elevation=400)
    assert provider in {"interpolated", "synthesised"}
    assert len(data.monthly) == 12
    assert data.climate_zone in {
        "hot-dry",
        "hot-humid",
        "warm-humid",
        "composite",
        "temperate",
        "cold-cloudy",
        "cold-sunny",
        "cold-desert",
    }

    recomputed = engine.derive_summary([m.model_dump(by_alias=True) for m in data.monthly])
    for key, value in recomputed.items():
        assert close(getattr(data.summary, _snake(key)), value), f"summary.{key}"


def _snake(name: str) -> str:
    """camelCase to snake_case, for reaching pydantic attributes by wire name."""
    out = []
    for char in name:
        if char.isupper():
            out.append("_")
            out.append(char.lower())
        else:
            out.append(char)
    return "".join(out)


def test_haversine_matches_reference_distances() -> None:
    """Known great-circle distances, to catch a unit or Earth-radius error.

    Computed from the catalogue's own coordinates, so the expected values are the
    correct ones for *this* data rather than a figure remembered from elsewhere.
    The point of the test is that the two numbers are independently checkable:
    Pune→Leh crosses fifteen degrees of latitude and comes out at ~1,777 km;
    Pune→Chennai is ~914 km. A radius or radian/degree slip would move both by a
    factor, not by a rounding step.
    """
    pune = catalog.get_station("in-pune")
    assert pune is not None
    leh = catalog.get_station("in-leh")
    assert leh is not None
    chennai = catalog.get_station("in-chennai")
    assert chennai is not None

    p, l, c = pune["location"], leh["location"], chennai["location"]

    pune_leh = catalog.haversine_km(p["latitude"], p["longitude"], l["latitude"], l["longitude"])
    pune_chennai = catalog.haversine_km(p["latitude"], p["longitude"], c["latitude"], c["longitude"])

    assert pune_leh == pytest.approx(1776.7, abs=2.0), f"Pune–Leh {pune_leh:.1f} km"
    assert pune_chennai == pytest.approx(914.2, abs=2.0), f"Pune–Chennai {pune_chennai:.1f} km"

    # And the invariant that matters more than either number: symmetry.
    assert catalog.haversine_km(l["latitude"], l["longitude"], p["latitude"], p["longitude"]) == pytest.approx(
        pune_leh, abs=1e-9
    )


def test_nearest_station_finds_itself() -> None:
    """A station must be its own nearest neighbour, at zero distance."""
    for station in catalog.all_stations()[:10]:
        location = station["location"]
        found, distance = catalog.nearest_station(location["latitude"], location["longitude"])
        assert found["location"]["id"] == location["id"]
        assert distance < 1e-6


# --------------------------------------------------------------------------- #
# Unit helpers                                                                #
# --------------------------------------------------------------------------- #


def test_wet_bulb_is_below_dry_bulb_and_equals_it_at_saturation() -> None:
    """The two physical invariants of a wet-bulb temperature.

    A sign error here would still produce a plausible-looking number in the
    design-conditions table, which is exactly why the invariant is asserted.
    """
    assert units.wet_bulb(35.0, 100.0) == pytest.approx(35.0, abs=0.2)
    assert units.wet_bulb(35.0, 20.0) < 35.0
    assert units.wet_bulb(20.0, 60.0) < 20.0

    # Monotonic in humidity.
    assert units.wet_bulb(30.0, 20.0) < units.wet_bulb(30.0, 60.0) < units.wet_bulb(30.0, 90.0)


def test_pressure_decreases_with_elevation() -> None:
    assert units.pressure_at_elevation(0) == pytest.approx(units.STANDARD_PRESSURE, rel=1e-9)
    assert units.pressure_at_elevation(3500) < units.pressure_at_elevation(0)


def test_normalize_deg_wraps_into_range() -> None:
    assert units.normalize_deg(-90) == pytest.approx(270.0)
    assert units.normalize_deg(450) == pytest.approx(90.0)
    assert units.normalize_deg(360) == pytest.approx(0.0)
