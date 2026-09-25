"""Request and response schemas.

These mirror the TypeScript types in `types/` field for field, and the JSON is
camelCase on the wire because the frontend's `api/client.ts` casts the response
straight into those types. `populate_by_name` is enabled so the service also
accepts snake_case, which makes it pleasant to poke at with curl.

Keeping this file honest matters more than it looks: the client does an
unchecked `as ClimateData` cast, so a renamed field here would not raise an
error anywhere — it would silently arrive as `undefined` and the dashboard would
render an em dash. `tests/test_parity.py` guards the shape for that reason.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model that speaks camelCase on the wire."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


# --------------------------------------------------------------------------- #
# Location and climate                                                        #
# --------------------------------------------------------------------------- #


class Location(CamelModel):
    id: str
    country: str
    state: str
    city: str
    latitude: float
    longitude: float
    elevation: float


class MonthlyClimate(CamelModel):
    month: int = Field(ge=0, le=11)
    avg_temp: float
    max_temp: float
    min_temp: float
    humidity: float
    wind_speed: float
    wind_direction: float
    solar_radiation: float
    rainfall: float
    sunshine_hours: float


class ClimateSummary(CamelModel):
    avg_temperature: float
    max_temperature: float
    min_temperature: float
    humidity: float
    wind_speed: float
    wind_direction: float
    solar_radiation: float
    rainfall: float
    seasonal_variation: float
    diurnal_swing: float
    peak_cooling_month: int
    peak_heating_month: int


class DesignConditions(CamelModel):
    summer_design_temp: float
    summer_design_wet_bulb: float
    winter_design_temp: float
    daily_range: float
    cooling_degree_days: float
    heating_degree_days: float


ClimateSource = Literal["database", "api", "simulated"]

ClimateZone = Literal[
    "hot-dry",
    "hot-humid",
    "warm-humid",
    "composite",
    "temperate",
    "cold-cloudy",
    "cold-sunny",
    "cold-desert",
]


class ClimateData(CamelModel):
    location: Location
    source: ClimateSource
    climate_type: str
    climate_zone: ClimateZone
    summary: ClimateSummary
    monthly: list[MonthlyClimate]
    design_conditions: DesignConditions
    fetched_at: str


class ClimateStationRecord(CamelModel):
    location: Location
    climate_type: str
    climate_zone: ClimateZone
    monthly: list[MonthlyClimate]


class ResolveClimateRequest(CamelModel):
    location: Location
    prefer_live: bool = False


# --------------------------------------------------------------------------- #
# Materials                                                                   #
# --------------------------------------------------------------------------- #


class MaterialProperties(CamelModel):
    id: str
    name: str
    category: Literal["wall", "roof", "window", "insulation", "floor"]
    thermal_conductivity: float
    thickness: float
    u_value: float
    cost: float
    density: float
    specific_heat: float
    solar_absorptance: float
    emissivity: float
    shgc: float | None = None
    vlt: float | None = None
    air_permeability: float | None = None
    embodied_carbon: float | None = None
    color: str
    roughness: float
    metalness: float
    note: str


# --------------------------------------------------------------------------- #
# Design programme                                                            #
# --------------------------------------------------------------------------- #


class FacadeWeights(CamelModel):
    north: float = 1.0
    east: float = 1.0
    south: float = 1.0
    west: float = 1.0


class BuildingParameters(CamelModel):
    """The full design programme.

    Every field has a default so this can also serve as the partial-requirements
    model: the frontend posts `Partial<BuildingParameters>` and the service fills
    the gaps from the documented default programme.
    """

    width: float = 6.0
    length: float = 4.5
    height: float = 2.8
    wall_thickness: float = 0.23

    num_occupants: int = 4
    num_rooms: int = 1
    budget: float = 600_000

    orientation: float = 0.0

    window_to_wall_ratio: float = 0.3
    facade_weights: FacadeWeights = Field(default_factory=FacadeWeights)
    wall_material_id: str = "brick"
    roof_material_id: str = "rcc-slab"
    window_material_id: str = "single"
    insulation_level: str = "none"
    insulation_thickness: float = 0.0

    roof_type: str = "flat"
    roof_angle: float = 0.0
    roof_overhang: float = 0.3

    shading_type: str = "none"
    shading_depth: float = 0.0
    ventilation_type: str = "mixed-mode"
    air_changes_per_hour: float = 3.0

    cooling_setpoint: float = 26.0
    heating_setpoint: float = 18.0
    cooling_cop: float = 3.2
    heating_efficiency: float = 0.9
    solar_pv_kwp: float = 0.0


class ObjectiveWeights(CamelModel):
    discomfort: float = 0.45
    energy: float = 0.35
    cost: float = 0.20


# --------------------------------------------------------------------------- #
# Machine learning                                                            #
# --------------------------------------------------------------------------- #


class TrainingRequest(CamelModel):
    """Request to (re)train the surrogate.

    The dataset is generated by the verified TypeScript engine and posted in, so
    the backend never has to re-implement the physics it is trying to learn.
    """

    rows: list[dict[str, float]]
    targets: list[str] = Field(default_factory=list)
    test_fraction: float = Field(default=0.2, gt=0, lt=0.5)
    n_estimators: int = Field(default=400, ge=50, le=2000)
    max_depth: int = Field(default=6, ge=2, le=14)
    learning_rate: float = Field(default=0.05, gt=0, le=0.5)
    seed: int = 42


class ModelMetrics(CamelModel):
    """Held-out performance for one target.

    `r2` is reported but is not the gate. The gate is `spearman` (does the model
    order designs the way the engine does?) plus `mae` (are the numbers close
    enough to quote?). See `ml.py` for why R² is the wrong instrument for a
    bounded, censored target like `adaptive_comfort_hours_pct`.
    """

    target: str
    rows: int
    train_rows: int
    test_rows: int
    r2: float
    rmse: float
    mae: float
    spearman: float
    passed_gate: bool
    gate_min_spearman: float
    gate_max_mae: float
    feature_names: list[str]


class FeatureImportance(CamelModel):
    """One feature's share of the model's split gain.

    This is a named model rather than `dict[str, float]` because the entry is
    heterogeneous — a string and a number — and a homogeneous dictionary type
    would try to coerce the feature *name* to a float.
    """

    feature: str
    importance: float


class TargetReport(CamelModel):
    target: str
    metrics: ModelMetrics
    # The top features, so the panel can show *why* the model behaves as it does
    # rather than presenting a black box as an authority.
    feature_importance: list[FeatureImportance]


class TrainResponse(CamelModel):
    model_id: str
    created_at: str
    targets: list[TargetReport]
    passed_gate: bool
    explanation: str


class PredictRequest(CamelModel):
    features: dict[str, float]
    model_id: str | None = None


class PredictResponse(CamelModel):
    model_id: str
    predictions: dict[str, float]
    # Held-out MAE per target, so a caller can show an honest error bar rather
    # than presenting a point estimate as a fact.
    error_bars: dict[str, float]
    used_features: list[str]
    missing_features: list[str]


# --------------------------------------------------------------------------- #
# Surrogate-guided optimisation                                               #
# --------------------------------------------------------------------------- #


class ScreenRequest(CamelModel):
    """Ask the surrogate to screen a design neighbourhood.

    Note what is *not* here: no climate payload, no thermal simulation request.
    This endpoint ranks candidates using a model trained on the physics engine's
    output. It is a screening tool, not a second implementation of the physics.
    """

    location: Location
    requirements: BuildingParameters
    weights: ObjectiveWeights = Field(default_factory=ObjectiveWeights)
    climate: ClimateData | None = None
    # The climate summary supplies the site features. When omitted, the location
    # is resolved from the offline catalogue so the endpoint is usable alone.
    limit: int = Field(default=12, ge=1, le=100)
    exhaustive: bool = False
    model_id: str | None = None


class ScreenCandidate(CamelModel):
    id: str
    label: str
    parameters: BuildingParameters
    predictions: dict[str, float]
    error_bars: dict[str, float]
    """Weighted penalty from the surrogate's three predictions, lower is better."""
    objective: float
    """0–100, higher is better. Same inversion the client applies to its own score."""
    score: int


class ScreenResponse(CamelModel):
    engine: str
    method: str
    model_id: str
    candidates_evaluated: int
    space_size: int
    duration_ms: float
    leaderboard: list[ScreenCandidate]
    disclaimer: str


# --------------------------------------------------------------------------- #
# Persistence                                                                 #
# --------------------------------------------------------------------------- #


class SavedDesign(CamelModel):
    id: str
    label: str
    location_id: str
    parameters: BuildingParameters
    metrics: dict[str, float] = Field(default_factory=dict)
    notes: str | None = None
    created_at: str


class SaveDesignRequest(CamelModel):
    label: str
    location_id: str
    parameters: BuildingParameters
    metrics: dict[str, float] = Field(default_factory=dict)
    notes: str | None = None


# --------------------------------------------------------------------------- #
# Service metadata                                                            #
# --------------------------------------------------------------------------- #


class HealthResponse(CamelModel):
    status: str
    version: str
    engines: list[str]
    database: str
    stations: int
    materials: int
    surrogate_ready: bool


class ErrorResponse(CamelModel):
    detail: str
    context: dict[str, Any] | None = None
