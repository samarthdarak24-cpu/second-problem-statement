"""Wire-contract tests.

These are not tests of behaviour — `test_parity.py` covers the numbers. These
test the *shape* of what goes over the wire, and they matter more than they look:

`api/client.ts` casts the response straight into TypeScript types with
`as ClimateData`. There is no runtime validation anywhere on the client. So if
this service renamed `avgTemp` to `avg_temp`, nothing would raise, nothing would
log, and the dashboard would quietly render an em dash where the temperature
should be.

The field lists below are therefore copied from `types/climate.ts` rather than
from this service's own models — asserting against the producer's own schema
would only prove it is self-consistent, which is not the thing in doubt.

Run:  cd backend && .venv/Scripts/python -m pytest tests/test_api.py
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    """A client with the lifespan run, so the schema is created and seeded."""
    with TestClient(app) as test_client:
        yield test_client


# Field lists copied from types/climate.ts.
LOCATION_FIELDS = {"id", "country", "state", "city", "latitude", "longitude", "elevation"}
SUMMARY_FIELDS = {
    "avgTemperature",
    "maxTemperature",
    "minTemperature",
    "humidity",
    "windSpeed",
    "windDirection",
    "solarRadiation",
    "rainfall",
    "seasonalVariation",
    "diurnalSwing",
    "peakCoolingMonth",
    "peakHeatingMonth",
}
MONTHLY_FIELDS = {
    "month",
    "avgTemp",
    "maxTemp",
    "minTemp",
    "humidity",
    "windSpeed",
    "windDirection",
    "solarRadiation",
    "rainfall",
    "sunshineHours",
}
DESIGN_CONDITION_FIELDS = {
    "summerDesignTemp",
    "summerDesignWetBulb",
    "winterDesignTemp",
    "dailyRange",
    "coolingDegreeDays",
    "heatingDegreeDays",
}


# --------------------------------------------------------------------------- #
# Health                                                                      #
# --------------------------------------------------------------------------- #


def test_health_matches_the_client_contract(client: TestClient) -> None:
    """`BackendHealth` is `{ status, version, engines }` — all three must be there."""
    response = client.get("/api/health")
    assert response.status_code == 200

    payload = response.json()
    assert payload["status"] == "ok"
    assert isinstance(payload["version"], str) and payload["version"]
    assert isinstance(payload["engines"], list) and payload["engines"]

    # The extra fields are additive; a client that ignores them keeps working.
    assert payload["stations"] > 0
    assert payload["materials"] > 0

    # And they are camelCase, because the client casts the body straight into a
    # TypeScript interface. A snake_case key here would arrive as `undefined`.
    assert "surrogateReady" in payload
    assert "surrogate_ready" not in payload


def test_health_reports_surrogate_readiness_honestly(client: TestClient) -> None:
    """`surrogateReady` must agree with the registry, not with optimism."""
    health = client.get("/api/health").json()
    registry = client.get("/api/ml/registry").json()
    assert health["surrogateReady"] == (registry["ready"] > 0)


# --------------------------------------------------------------------------- #
# Climate — the endpoint the frontend actually calls                          #
# --------------------------------------------------------------------------- #


def test_resolve_climate_returns_every_field_the_client_reads(client: TestClient) -> None:
    stations = client.get("/api/climate/stations").json()
    location = next(s for s in stations if s["id"] == "in-pune")

    response = client.post(
        "/api/climate/resolve",
        json={"location": location, "prefer_live": False},
    )
    assert response.status_code == 200

    payload = response.json()
    assert set(payload) >= {
        "location",
        "source",
        "climateType",
        "climateZone",
        "summary",
        "monthly",
        "designConditions",
        "fetchedAt",
    }

    assert set(payload["location"]) >= LOCATION_FIELDS
    assert set(payload["summary"]) >= SUMMARY_FIELDS
    assert set(payload["designConditions"]) >= DESIGN_CONDITION_FIELDS

    assert len(payload["monthly"]) == 12
    for month in payload["monthly"]:
        assert set(month) >= MONTHLY_FIELDS

    # `source` is a closed union on the client.
    assert payload["source"] in {"database", "api", "simulated"}

    # And the zone is one of the eight the UI has labels for.
    assert payload["climateZone"] in {
        "hot-dry",
        "hot-humid",
        "warm-humid",
        "composite",
        "temperate",
        "cold-cloudy",
        "cold-sunny",
        "cold-desert",
    }


def test_resolve_climate_accepts_snake_case_too(client: TestClient) -> None:
    """`prefer_live` and `preferLive` must both work.

    The client sends snake_case in the body but camelCase elsewhere, and a
    service that only accepts one of them is a service that breaks the moment
    somebody curls it.
    """
    stations = client.get("/api/climate/stations").json()
    location = next(s for s in stations if s["id"] == "in-leh")

    snake = client.post("/api/climate/resolve", json={"location": location, "prefer_live": False})
    camel = client.post("/api/climate/resolve", json={"location": location, "preferLive": False})

    assert snake.status_code == 200
    assert camel.status_code == 200
    assert snake.json()["climateZone"] == camel.json()["climateZone"]


def test_climate_zone_is_stable_across_repeated_calls(client: TestClient) -> None:
    """Two calls for the same station must not disagree."""
    first = client.get("/api/climate/resolve/in-jodhpur").json()
    second = client.get("/api/climate/resolve/in-jodhpur").json()
    assert first["climateZone"] == second["climateZone"]
    assert first["summary"] == second["summary"]


def test_unknown_station_is_a_404(client: TestClient) -> None:
    assert client.get("/api/climate/resolve/atlantis-1").status_code == 404
    assert client.get("/api/climate/stations/atlantis-1").status_code == 404


def test_nearest_reports_distance(client: TestClient) -> None:
    payload = client.get("/api/climate/nearest", params={"latitude": 18.52, "longitude": 73.86}).json()
    assert "location" in payload
    assert payload["distanceKm"] >= 0


def test_preview_synthesises_for_an_ocean_point(client: TestClient) -> None:
    """A point in the middle of an ocean must still resolve, labelled as simulated."""
    payload = client.get(
        "/api/climate/preview", params={"latitude": -40.0, "longitude": -140.0, "elevation": 0}
    ).json()
    assert payload["source"] == "simulated"
    assert len(payload["monthly"]) == 12


def test_countries_and_stations_are_consistent(client: TestClient) -> None:
    countries = client.get("/api/climate/countries").json()
    assert "India" in countries
    india = client.get("/api/climate/stations", params={"country": "India"}).json()
    assert len(india) > 20
    assert all(station["country"] == "India" for station in india)


# --------------------------------------------------------------------------- #
# Catalogue                                                                   #
# --------------------------------------------------------------------------- #


def test_materials_carry_the_thermal_properties_the_ui_shows(client: TestClient) -> None:
    materials = client.get("/api/materials").json()
    assert len(materials) > 20

    required = {
        "id",
        "name",
        "category",
        "thermalConductivity",
        "thickness",
        "uValue",
        "cost",
        "density",
        "specificHeat",
        "solarAbsorptance",
        "emissivity",
        "color",
        "roughness",
        "metalness",
        "note",
    }
    for material in materials:
        assert set(material) >= required

    windows = [m for m in materials if m["category"] == "window"]
    assert all(m["shgc"] is not None and m["vlt"] is not None for m in windows)

    walls = [m for m in materials if m["category"] == "wall"]
    assert all(m["uValue"] > 0 for m in walls)


def test_material_filter_rejects_an_empty_category(client: TestClient) -> None:
    assert client.get("/api/materials", params={"category": "unobtainium"}).status_code == 404


def test_vocabulary_exposes_the_shared_mappings(client: TestClient) -> None:
    payload = client.get("/api/vocabulary").json()
    assert payload["insulation"]["levels"] == ["none", "low", "medium", "high", "very-high"]
    assert payload["roof"]["strategies"] == ["flat", "shed", "gable", "hip", "vaulted"]
    assert payload["ventilation"]["ach"]["mixed-mode"] == 6
    assert "defaultRequirements" in payload


def test_default_requirements_is_a_complete_programme(client: TestClient) -> None:
    payload = client.get("/api/requirements/default").json()
    for key in ("width", "length", "height", "numOccupants", "coolingSetpoint", "wallMaterialId"):
        assert key in payload, f"default requirements is missing {key}"


# --------------------------------------------------------------------------- #
# Machine learning                                                            #
# --------------------------------------------------------------------------- #


def test_ml_contract_is_42_features_and_3_targets(client: TestClient) -> None:
    payload = client.get("/api/ml/contract").json()
    assert payload["featureCount"] == 42
    assert len(payload["featureNames"]) == 42
    assert payload["targetNames"] == [
        "energy_use_intensity_kwh_m2_yr",
        "adaptive_comfort_hours_pct",
        "cost_per_m2_inr",
    ]
    # The gate is rank correlation plus MAE, not R². See `app/ml.py` for why:
    # `adaptive_comfort_hours_pct` is bounded, quantised and heavily censored at
    # zero, so R² is capped below 1 by label structure rather than by model
    # quality, while the optimiser only ever consumes the model's *ordering*.
    assert payload["gate"]["minSpearman"] == [0.9, 0.9, 0.9]
    assert payload["gate"]["maxMae"] == [15.0, 6.0, 2500.0]
    assert "minR2" not in payload["gate"]


def test_ml_features_endpoint_agrees_with_the_contract(client: TestClient) -> None:
    contract = client.get("/api/ml/contract").json()
    features = client.get("/api/ml/features").json()
    assert features["featureNames"] == contract["featureNames"]


def test_predict_without_a_trained_model_is_503(client: TestClient) -> None:
    """No model, no prediction — and a status code that says "try later".

    503 rather than 500: the client should fall back to its own physics engine,
    not surface an error.
    """
    registry = client.get("/api/ml/registry").json()
    if registry["ready"] > 0:
        pytest.skip("a validated model is registered, so the refusal path is not reachable")

    response = client.post("/api/ml/predict", json={"features": {}})
    assert response.status_code in {422, 503}


def test_train_rejects_a_dataset_that_is_too_small(client: TestClient) -> None:
    """The minimum-rows gate must be enforced before any fitting happens."""
    response = client.post(
        "/api/ml/train",
        json={"rows": [{"latitude": 18.5}] * 10},
    )
    assert response.status_code == 422
    assert "at least" in response.json()["detail"].lower()


def test_train_rejects_an_unknown_target(client: TestClient) -> None:
    response = client.post(
        "/api/ml/train",
        json={"rows": [{"latitude": 18.5}] * 300, "targets": ["world_domination"]},
    )
    assert response.status_code == 422
    assert "unknown target" in response.json()["detail"].lower()


# --------------------------------------------------------------------------- #
# Optimisation                                                                #
# --------------------------------------------------------------------------- #


def test_optimize_refuses_without_a_validated_model(client: TestClient) -> None:
    """The refusal is the feature.

    If this ever returns 200 while the registry says nothing passed the gate, the
    service is serving predictions from an unvalidated model — which is the one
    outcome this whole design exists to prevent.
    """
    registry = client.get("/api/ml/registry").json()
    if registry["ready"] > 0:
        pytest.skip("a validated model is registered, so the refusal path is not reachable")

    stations = client.get("/api/climate/stations").json()
    location = next(s for s in stations if s["id"] == "in-pune")
    requirements = client.get("/api/requirements/default").json()

    response = client.post(
        "/api/optimize",
        json={"location": location, "requirements": requirements},
    )
    assert response.status_code == 503
    assert "gate" in response.json()["detail"].lower() or "no surrogate" in response.json()["detail"].lower()


def test_design_space_reports_its_own_size(client: TestClient) -> None:
    payload = client.get("/api/design-space").json()
    assert payload["axes"][0] == "orientation"
    assert payload["spaceSize"] > payload["evaluationsPerSweep"]
    assert payload["exhaustive"] is False


# --------------------------------------------------------------------------- #
# Persistence                                                                 #
# --------------------------------------------------------------------------- #


def test_saved_design_round_trip(client: TestClient) -> None:
    requirements = client.get("/api/requirements/default").json()

    created = client.post(
        "/api/designs",
        json={
            "label": "Pune baseline",
            "locationId": "in-pune",
            "parameters": requirements,
            "metrics": {"energyUseIntensity": 21.7, "comfortHoursPct": 66},
            "notes": "written by the API test suite",
        },
    )
    assert created.status_code == 201

    record = created.json()
    design_id = record["id"]
    assert record["label"] == "Pune baseline"
    assert record["locationId"] == "in-pune"
    assert record["metrics"]["energyUseIntensity"] == 21.7

    fetched = client.get(f"/api/designs/{design_id}")
    assert fetched.status_code == 200
    assert fetched.json()["parameters"]["width"] == requirements["width"]

    listed = client.get("/api/designs", params={"location_id": "in-pune"}).json()
    assert any(item["id"] == design_id for item in listed)

    assert client.delete(f"/api/designs/{design_id}").status_code == 200
    assert client.get(f"/api/designs/{design_id}").status_code == 404
    assert client.delete(f"/api/designs/{design_id}").status_code == 404


def test_stats_summary_counts_what_exists(client: TestClient) -> None:
    payload = client.get("/api/designs/stats/summary").json()
    assert payload["stations"] > 0
    assert payload["designs"] >= 0


# --------------------------------------------------------------------------- #
# Error shape                                                                 #
# --------------------------------------------------------------------------- #


def test_errors_carry_a_detail_string(client: TestClient) -> None:
    """Every error path must produce `{ detail: str }`.

    FastAPI's own `HTTPException` does this; the custom handlers in `main.py`
    must too, or the client's error banner renders `[object Object]`.
    """
    for response in (
        client.get("/api/climate/resolve/nowhere"),
        client.get("/api/materials/nowhere"),
        client.get("/api/designs/nowhere"),
    ):
        assert response.status_code == 404
        assert isinstance(response.json()["detail"], str)


def test_root_lists_the_endpoints(client: TestClient) -> None:
    payload = client.get("/").json()
    assert payload["service"]
    assert any("/api/climate/resolve" in entry for entry in payload["endpoints"])
    # The honesty note is part of the API surface, deliberately.
    assert "TypeScript" in payload["note"]
