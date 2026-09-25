"""Surrogate-guided optimisation.

WHAT THIS MODULE IS, AND WHAT IT DELIBERATELY IS NOT
The physics lives in TypeScript. It is verified by 70 assertions and a set of PMV
and periodic-response reference checks, and it runs in the browser in about two
milliseconds per candidate. Re-implementing it in Python would create a second
authority on thermal performance that could disagree with the first — which is a
strictly worse outcome than not having a backend at all.

So this module does the one thing a server is genuinely better at: it enumerates
a design neighbourhood and **screens** it with a trained surrogate, in constant
time per candidate, without simulating anything. The result is a ranked
shortlist. The client's physics engine remains the authority on what a design
actually does, and every response says so.

The search is coordinate descent, not a cross product. A full product of every
axis here is several million candidates; sweeping one axis at a time while
holding the others finds the same optimum in a few dozen evaluations, and every
axis can be explained to the user. `space_size` is still reported so the UI can
show how large the space would have been.

PORTS
`build_design_space` mirrors `optimization/designSpace.ts` and
`encode_features` mirrors `ml/features.ts`. Where the TypeScript version takes a
full `ClimateAnalysis` to weight its options, this one takes the seed design
itself — the client already computed that analysis, and sending the seed is
both smaller and more honest than asking the server to re-derive it.
"""

from __future__ import annotations

import time
from math import cos, sin, radians
from typing import Any, Iterable, Sequence

from . import catalog
from .models import BuildingParameters, ClimateData, Location, ObjectiveWeights

# --------------------------------------------------------------------------- #
# Constants mirrored from the TypeScript engine                               #
# --------------------------------------------------------------------------- #

# `optimization/designSpace.ts` SEARCH_AXES, in the same order — the order is the
# order coordinate descent sweeps them, so it encodes which axes matter most.
SEARCH_AXES: tuple[str, ...] = (
    "orientation",
    "shading",
    "windowRatio",
    "insulation",
    "glazing",
    "roof",
    "wallMaterial",
    "roofMaterial",
    "ventilation",
    "pv",
)

# `thermal/materials.ts` — the glazing ladder, cheapest to best.
GLAZING_LADDER: tuple[str, ...] = ("single", "double", "double-lowe", "triple")

# `thermal/constants.ts` INSULATION_LEVELS.
INSULATION_LADDER: tuple[str, ...] = ("none", "low", "medium", "high", "very-high")

# `thermal/constants.ts` VENTILATION_STRATEGIES.
VENTILATION_LADDER: tuple[str, ...] = (
    "sealed-mechanical",
    "single-sided",
    "night-purge",
    "stack-ventilation",
    "mixed-mode",
    "cross-ventilation",
)

WALL_SHORTLIST: tuple[str, ...] = ("brick", "flyash-brick", "aac", "hollow-block", "rammed-earth", "stone", "insulated-aac")
ROOF_SHORTLIST: tuple[str, ...] = ("rcc-slab", "reflective-roof", "insulated-roof", "puf-panel", "mud-phuska")
ROOF_LADDER: tuple[str, ...] = ("flat", "shed", "gable", "hip", "vaulted")
SHADING_LADDER: tuple[str, ...] = ("none", "overhang", "louvre", "external-blind", "deep-verandah", "combined")

# `optimization/objective.ts` reference ranges for normalisation. Fixed ranges,
# not the candidate set's own range: with min/max normalisation, finding one
# excellent candidate silently makes every other design look worse.
COST_REFERENCE = (12_000.0, 48_000.0)
ENERGY_REFERENCE = (0.0, 150.0)
SEVERITY_REFERENCE = 15.0
BUDGET_PENALTY_WEIGHT = 0.6

# `thermal/materials.ts` SURFACE_RESISTANCE.
SURFACE_RESISTANCE = {"wall": 0.17, "roof": 0.14, "window": 0.0}

# `thermal/materials.ts` insulationForLevel — which board goes with each level.
INSULATION_FOR_LEVEL = {
    "very-high": "puf",
    "high": "xps",
    "medium": "eps",
    "low": "coir",
    "none": "none",
}

DISCLAIMER = (
    "These are surrogate predictions, not simulations. They come from a gradient-boosted "
    "model trained on the verified TypeScript engine's output, and are used only to rank "
    "candidates for a shortlist. The thermal model in the client remains the authority on "
    "what any design on this list actually does, and every number above carries the "
    "model's held-out error alongside it."
)


# --------------------------------------------------------------------------- #
# Material helpers (ported from thermal/materials.ts)                         #
# --------------------------------------------------------------------------- #


def _material(material_id: str) -> dict[str, Any]:
    """Look up a material, falling back to brick the way `getMaterial` does."""
    found = catalog.material_index().get(material_id)
    if found is not None:
        return found
    return catalog.materials_by_category("wall")[1]


def _insulation_for_level(level: str) -> str:
    return INSULATION_FOR_LEVEL.get(level, "none")


def _effective_u_value(
    material: dict[str, Any], insulation: dict[str, Any], thickness: float
) -> float:
    """Recompute an assembly's U-value with an added insulation layer.

    Mirrors `effectiveUValue`: windows are rated as a whole unit and ignore the
    added layer entirely.
    """
    category = material["category"]
    if category == "window":
        return float(material["uValue"])

    surface = SURFACE_RESISTANCE.get(category, SURFACE_RESISTANCE["wall"])
    r_base = float(material["thickness"]) / float(material["thermalConductivity"])
    conductivity = float(insulation["thermalConductivity"])
    r_insulation = thickness / conductivity if conductivity > 0 and thickness > 0 else 0.0
    return 1.0 / max(0.05, r_base + r_insulation + surface)


def _category_index(category: str, material_id: str) -> int:
    """Index of a material within its own category.

    The exported catalogue concatenates walls, roofs, windows and insulation in
    that order, so the index within a category is the value the encoder needs —
    and it stays stable when a material is appended to any category.
    """
    for index, material in enumerate(catalog.materials_by_category(category)):
        if material["id"] == material_id:
            return index
    return -1


# --------------------------------------------------------------------------- #
# Design space (ported from optimization/designSpace.ts)                      #
# --------------------------------------------------------------------------- #


def _unique(values: Iterable[Any]) -> list[Any]:
    """Order-preserving de-duplication."""
    seen: list[Any] = []
    for value in values:
        if value not in seen:
            seen.append(value)
    return seen


def _neighbourhood(ladder: Sequence[str], current: str, *, radius: int = 1) -> list[str]:
    """`current` plus its neighbours in an ordered ladder, clamped at the ends."""
    if current not in ladder:
        return [current, *ladder[: 2 * radius + 1]]
    index = ladder.index(current)
    low = max(0, index - radius)
    high = min(len(ladder), index + radius + 1)
    return _unique([ladder[index], *ladder[low:high]])


def build_design_space(seed: BuildingParameters, exhaustive: bool = False) -> dict[str, list[Any]]:
    """The neighbourhood coordinate descent is allowed to explore.

    Deliberately narrow. A full cross product of every envelope option is
    millions of thermal simulations, which is both too slow for an interactive
    UI and pointless: most of those combinations are dominated by others.
    """
    orientation = seed.orientation
    window_ratio = min(0.5, max(0.12, seed.window_to_wall_ratio))

    orientations = _unique(
        [round(orientation, 3), round((orientation - 15) % 360, 3), round((orientation + 15) % 360, 3)]
    ) if not exhaustive else [round((orientation + step) % 360, 3) for step in range(0, 360, 15)]

    shading_strategies = (
        list(SHADING_LADDER)
        if exhaustive
        else _unique([seed.shading_type, "overhang", "combined", "deep-verandah"])
    )
    depths = [0, 0.3, 0.45, 0.6, 0.8, 1.0, 1.2] if exhaustive else [0, 0.45, seed.shading_depth, 0.8]
    shading: list[dict[str, Any]] = []
    for strategy in shading_strategies:
        if strategy == "none":
            shading.append({"type": "none", "depth": 0.0})
            continue
        for depth in depths:
            if depth > 0:
                shading.append({"type": strategy, "depth": float(depth)})

    window_ratios = (
        [round(0.10 + 0.04 * step, 3) for step in range(11)]
        if exhaustive
        else [
            round(value, 3)
            for value in (window_ratio - 0.04, window_ratio, window_ratio + 0.04)
            if 0.1 <= value <= 0.5
        ]
    )
    window_ratios = _unique(window_ratios)

    insulation_levels = (
        list(INSULATION_LADDER)
        if exhaustive
        else _neighbourhood(INSULATION_LADDER, seed.insulation_level)
    )

    glazing_ids = (
        list(GLAZING_LADDER)
        if exhaustive
        else _neighbourhood(GLAZING_LADDER, seed.window_material_id)
    )

    roof_types = (
        list(ROOF_LADDER)
        if exhaustive
        else _unique([seed.roof_type, "flat", "gable" if seed.roof_type == "shed" else "shed"])
    )

    wall_material_ids = (
        list(WALL_SHORTLIST)
        if exhaustive
        else _unique([seed.wall_material_id, "brick", "aac", "rammed-earth", "stone"])
    )
    roof_material_ids = (
        list(ROOF_SHORTLIST)
        if exhaustive
        else _unique([seed.roof_material_id, "rcc-slab", "reflective-roof", "insulated-roof"])
    )

    # Ventilation: the strategy fixes the ACH, so they move together.
    ventilation_types = (
        list(VENTILATION_LADDER)
        if exhaustive
        else _unique([seed.ventilation_type, "night-purge", "mixed-mode", "sealed-mechanical"])
    )
    ventilation = [
        {"type": strategy, "ach": catalog.ventilation_ach(strategy)} for strategy in ventilation_types
    ]

    pv_options = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0] if exhaustive else [0.0, 2.0, 4.0]

    return {
        "orientation": orientations,
        "shading": shading,
        "windowRatio": window_ratios,
        "insulation": insulation_levels,
        "glazing": glazing_ids,
        "roof": roof_types,
        "wallMaterial": wall_material_ids,
        "roofMaterial": roof_material_ids,
        "ventilation": ventilation,
        "pv": pv_options,
    }


def design_space_size(space: dict[str, list[Any]]) -> int:
    """Size of the full cross product, for the "space explored" readout."""
    size = 1
    for axis in SEARCH_AXES:
        size *= len(space[axis])
    return size


def _apply_axis(seed: BuildingParameters, axis: str, option: Any) -> BuildingParameters:
    """One candidate: the seed with a single axis moved.

    Each axis touches only its own fields. Coordinate descent assumes the axes are
    orthogonal, so letting the insulation axis also rewrite the wall material
    would mean the sweep could never attribute a change to one decision — and the
    trail it reports to the user would be fiction.
    """
    updated = seed.model_copy(deep=True)
    if axis == "orientation":
        updated.orientation = float(option)
    elif axis == "shading":
        updated.shading_type = option["type"]
        updated.shading_depth = float(option["depth"])
        # A shading projection is physically the same thing as a roof overhang on
        # the shaded facades, so the two are kept consistent rather than fighting.
        if float(option["depth"]) > 0:
            updated.roof_overhang = max(updated.roof_overhang, float(option["depth"]))
    elif axis == "windowRatio":
        updated.window_to_wall_ratio = float(option)
    elif axis == "insulation":
        updated.insulation_level = str(option)
        updated.insulation_thickness = catalog.insulation_thickness(str(option))
    elif axis == "glazing":
        updated.window_material_id = str(option)
    elif axis == "roof":
        updated.roof_type = str(option)
        updated.roof_angle = catalog.roof_pitch(str(option))
    elif axis == "wallMaterial":
        updated.wall_material_id = str(option)
    elif axis == "roofMaterial":
        updated.roof_material_id = str(option)
    elif axis == "ventilation":
        updated.ventilation_type = str(option["type"])
        updated.air_changes_per_hour = float(option["ach"])
    elif axis == "pv":
        updated.solar_pv_kwp = float(option)
    return updated


# --------------------------------------------------------------------------- #
# Feature encoding (ported from ml/features.ts)                               #
# --------------------------------------------------------------------------- #


def encode_features(
    parameters: BuildingParameters, climate: ClimateData
) -> dict[str, float]:
    """Encode one design into the surrogate's named input vector.

    Returns a named record rather than a bare list because the model is served
    over HTTP: a named record is self-checking against `FEATURE_NAMES`, whereas
    a positional list would let a reordering pass unnoticed.
    """
    summary = climate.summary
    location = climate.location

    wall = _material(parameters.wall_material_id)
    roof = _material(parameters.roof_material_id)
    window = _material(parameters.window_material_id)
    insulation = _material(_insulation_for_level(parameters.insulation_level))
    thickness = parameters.insulation_thickness

    floor_area = max(1e-6, parameters.width * parameters.length)
    volume = floor_area * parameters.height
    aspect_ratio = parameters.length / max(1e-6, parameters.width)
    azimuth = radians(parameters.orientation)

    return {
        "latitude": location.latitude,
        "elevation_m": location.elevation,
        "annual_mean_temp_c": summary.avg_temperature,
        "max_temp_c": summary.max_temperature,
        "min_temp_c": summary.min_temperature,
        "diurnal_swing_k": summary.diurnal_swing,
        "relative_humidity_pct": summary.humidity,
        "wind_speed_ms": summary.wind_speed,
        "daily_solar_kwh_m2": summary.solar_radiation,
        "rainfall_mm": summary.rainfall,
        "floor_area_m2": floor_area,
        "volume_m3": volume,
        "aspect_ratio": aspect_ratio,
        "height_m": parameters.height,
        "wall_thickness_m": parameters.wall_thickness,
        "occupants": float(parameters.num_occupants),
        "occupant_density_per_m2": parameters.num_occupants / floor_area,
        "orientation_sin": sin(azimuth),
        "orientation_cos": cos(azimuth),
        "window_to_wall_ratio": parameters.window_to_wall_ratio,
        "insulation_thickness_m": thickness,
        "insulation_level_index": _index_of(INSULATION_LADDER, parameters.insulation_level),
        "wall_material_index": _category_index("wall", parameters.wall_material_id),
        "roof_material_index": _category_index("roof", parameters.roof_material_id),
        "window_material_index": _category_index("window", parameters.window_material_id),
        "wall_u_value": _effective_u_value(wall, insulation, thickness),
        "roof_u_value": _effective_u_value(roof, insulation, thickness),
        "window_u_value": _effective_u_value(window, insulation, thickness),
        "window_shgc": float(window.get("shgc") or 0.8),
        "wall_areal_heat_capacity": (
            float(wall["density"]) * float(wall["specificHeat"]) * float(wall["thickness"])
        ),
        "roof_type_index": _index_of(ROOF_LADDER, parameters.roof_type),
        "roof_angle_deg": parameters.roof_angle,
        "roof_overhang_m": parameters.roof_overhang,
        "shading_type_index": _index_of(SHADING_LADDER, parameters.shading_type),
        "shading_depth_m": parameters.shading_depth,
        "ventilation_type_index": _index_of(VENTILATION_LADDER, parameters.ventilation_type),
        "air_changes_per_hour": parameters.air_changes_per_hour,
        "cooling_setpoint_c": parameters.cooling_setpoint,
        "heating_setpoint_c": parameters.heating_setpoint,
        "cooling_cop": parameters.cooling_cop,
        "heating_efficiency": parameters.heating_efficiency,
        "solar_pv_kwp": parameters.solar_pv_kwp,
    }


def _index_of(ladder: Sequence[str], value: str) -> float:
    """Positional index, or -1 when absent — matching `indexOf` in TypeScript."""
    return float(ladder.index(value)) if value in ladder else -1.0


# --------------------------------------------------------------------------- #
# Scoring                                                                     #
# --------------------------------------------------------------------------- #


def _normalise(value: float, best: float, worst: float) -> float:
    """Normalise onto 0–1 where lower is always better."""
    if worst == best:
        return 0.0
    return min(1.0, max(0.0, (value - best) / (worst - best)))


def score_predictions(
    predictions: dict[str, float],
    weights: ObjectiveWeights,
    parameters: BuildingParameters,
) -> tuple[float, int]:
    """Turn three predicted metrics into one penalty and one 0–100 score.

    The discomfort term uses the passive component only. The physics engine's
    own `discomfortScore` blends comfort hours with how far past the adaptive
    band the worst season goes; the surrogate predicts only the hours, so
    inventing a severity term here would be fabricating a number the model never
    produced. The client's engine remains the authority on the blended figure.
    """
    comfort_pct = predictions["adaptive_comfort_hours_pct"]
    energy = predictions["energy_use_intensity_kwh_m2_yr"]
    cost_per_m2 = predictions["cost_per_m2_inr"]

    discomfort = min(1.0, max(0.0, 1.0 - comfort_pct / 100.0))
    energy_penalty = _normalise(energy, *ENERGY_REFERENCE)
    cost_penalty = _normalise(cost_per_m2, *COST_REFERENCE)

    total_weight = max(1e-6, weights.discomfort + weights.energy + weights.cost)
    weighted = (
        weights.discomfort * discomfort
        + weights.energy * energy_penalty
        + weights.cost * cost_penalty
    ) / total_weight

    floor_area = max(1e-6, parameters.width * parameters.length)
    predicted_cost = cost_per_m2 * floor_area
    budget_penalty = (
        max(0.0, predicted_cost - parameters.budget) / max(1.0, parameters.budget)
        if parameters.budget > 0
        else 0.0
    )

    objective = weighted + BUDGET_PENALTY_WEIGHT * budget_penalty
    score = round(max(0.0, min(1.0, 1.0 - objective)) * 100)
    return objective, score


def describe_design(parameters: BuildingParameters) -> str:
    """One-line description of a complete design.

    Exposed for callers that want a human label — the axis label on a
    leaderboard row says which *move* reached a design, which is informative
    about the search but not about the design. The client has its own
    `describeDesign` for the UI; this exists so a curl response is readable.
    """
    parts = [
        f"WWR {round(parameters.window_to_wall_ratio * 100)} %",
        "no shading"
        if parameters.shading_type == "none"
        else f"{parameters.shading_type} {parameters.shading_depth:.2f} m",
        "no insulation"
        if parameters.insulation_level == "none"
        else f"{parameters.insulation_level} insulation",
        parameters.wall_material_id,
        parameters.roof_type,
        f"{parameters.window_material_id} glazing",
        f"{parameters.ventilation_type} {parameters.air_changes_per_hour:g} ACH",
    ]
    if parameters.solar_pv_kwp > 0:
        parts.append(f"PV {parameters.solar_pv_kwp:g} kWp")
    return " · ".join(parts)


# --------------------------------------------------------------------------- #
# The search                                                                  #
# --------------------------------------------------------------------------- #


def _sweep(
    space: dict[str, list[Any]],
    seed: BuildingParameters,
    evaluate_many,
    axes: Sequence[str],
) -> tuple[BuildingParameters, float, int, bool]:
    """One coordinate-descent pass: move each axis to its best option in turn.

    Returns the improved design, its objective, how many candidates were
    evaluated, and whether the pass improved on its own starting point.

    Candidates are scored one axis at a time rather than one at a time. That is
    not premature optimisation: a gradient-boosted predict has substantial
    per-call overhead, so scoring 66 candidates individually costs seconds while
    scoring them as ~11 batches costs milliseconds. The evaluations are still
    collected individually by `evaluate_many`, which the caller owns — that is
    what makes the leaderboard a record of what was actually tried rather than a
    reconstruction after the fact.
    """
    best_parameters = seed
    ((best_objective, _),) = evaluate_many([(seed, "seed (as supplied)")])
    evaluations = 1
    improved = False

    for axis in axes:
        candidates = [
            (
                _apply_axis(best_parameters, axis, option),
                f"{axis} → {option['type'] if isinstance(option, dict) else option}",
            )
            for option in space[axis]
        ]
        scored = evaluate_many(candidates)
        evaluations += len(candidates)

        axis_best = best_parameters
        axis_objective = best_objective

        for (candidate, _label), (objective, _score) in zip(candidates, scored):
            # Strictly better, with a tolerance so floating-point noise cannot
            # make the search oscillate between two equivalent designs.
            if objective < axis_objective - 1e-9:
                axis_best, axis_objective = candidate, objective

        if axis_best is not best_parameters:
            best_parameters, best_objective = axis_best, axis_objective
            improved = True

    return best_parameters, best_objective, evaluations, improved


def screen_designs(
    location: Location,
    requirements: BuildingParameters,
    weights: ObjectiveWeights,
    climate: ClimateData,
    *,
    limit: int = 12,
    exhaustive: bool = False,
    sweeps: int = 2,
) -> dict[str, Any]:
    """Enumerate a neighbourhood and rank it with the surrogate.

    The leaderboard is a record of the candidates the surrogate actually
    evaluated — not a reconstruction from the search trail. That distinction
    matters: a trail says "the search moved orientation to 180°", which by the
    end of the sweep describes a design that has also changed its shading,
    glazing and insulation. The candidate list says what was tried, and each row
    is the design that was tried.
    """
    from . import ml

    started = time.perf_counter()

    # Load the boosters once. Screening is the reason the surrogate exists, and
    # reloading three artefacts per candidate turns a sub-second sweep into a
    # 30-second request — which would forfeit the only advantage the model has
    # over the physics engine it was trained on.
    predictor = ml.load_predictor()
    model_id = predictor.model_id

    # Held-out error bars are a property of the model, not of any one candidate,
    # so they are read once. They still travel with every row, because a point
    # estimate without its error is the thing that makes a surrogate dangerous.
    error_bars = predictor.error_bars

    evaluated: list[dict[str, Any]] = []

    def evaluate_many(
        candidates: list[tuple[BuildingParameters, str]],
    ) -> list[tuple[float, int]]:
        """Score a batch of candidates in one pass over the model."""
        predictions = predictor.predict_many(
            [encode_features(parameters, climate) for parameters, _ in candidates]
        )

        scored: list[tuple[float, int]] = []
        for (parameters, label), predicted in zip(candidates, predictions):
            objective, score = score_predictions(predicted, weights, parameters)
            evaluated.append(
                {
                    "label": label,
                    "parameters": parameters,
                    "predictions": predicted,
                    "objective": objective,
                    "score": score,
                }
            )
            scored.append((objective, score))
        return scored

    space = build_design_space(requirements, exhaustive)
    space_size = design_space_size(space)

    # Coordinate descent from the seed. Two passes by default: the first finds
    # each axis's best value against the original design, the second re-checks
    # them now that the others have moved — the standard guard against a greedy
    # single pass locking in an early choice.
    current = requirements
    evaluations = 0

    for _ in range(max(1, sweeps)):
        current, _objective, count, improved = _sweep(
            space, current, evaluate_many, SEARCH_AXES
        )
        evaluations += count
        # A pass that improved nothing means the previous pass found a local
        # optimum, so another pass would only re-evaluate the same candidates.
        if not improved:
            break

    # Rank what was actually tried, best first, de-duplicated by design. The same
    # design can be reached by more than one route — a wider window and a weaker
    # overhang can land on identical parameters — and listing it twice would make
    # the shortlist look longer than it is.
    ranked = sorted(evaluated, key=lambda entry: entry["objective"])
    seen: set[str] = set()
    leaderboard: list[dict[str, Any]] = []

    for entry in ranked:
        signature = entry["parameters"].model_dump_json()
        if signature in seen:
            continue
        seen.add(signature)
        # The winner is labelled by what it *is*; every other row is labelled by
        # the move that reached it. A leaderboard where the top row says
        # "shading → overhang" tells you which move won, not what was built.
        label = (
            describe_design(entry["parameters"])
            if not leaderboard
            else entry["label"]
        )
        leaderboard.append(
            {
                "id": f"screen-{len(leaderboard) + 1}",
                "label": label,
                "parameters": entry["parameters"],
                "predictions": entry["predictions"],
                "errorBars": error_bars,
                "objective": entry["objective"],
                "score": entry["score"],
            }
        )
        if len(leaderboard) >= limit:
            break

    duration_ms = (time.perf_counter() - started) * 1000

    return {
        "engine": "ml-surrogate",
        "method": "coordinate-descent",
        "modelId": model_id,
        "candidatesEvaluated": evaluations,
        "spaceSize": space_size,
        "durationMs": round(duration_ms, 2),
        "leaderboard": leaderboard,
        "disclaimer": DISCLAIMER,
    }
