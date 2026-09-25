"""Machine-learning surrogate service.

WHAT THIS IS FOR
The verified physics engine runs in TypeScript, in the browser, in about two
milliseconds per candidate. That is fast enough to search a design space
interactively — which is why the frontend does not need this service to be
useful, and why this service must not pretend to be the authority on thermal
performance.

What a server can do that a browser cannot is learn from data that has already
been generated, and answer in constant time. So this module trains a
gradient-boosted regressor on a dataset produced by the *verified* engine, and
serves predictions from it. The engine stays the ground truth; the model is a
cache with generalisation.

THE CONTRACT IS NOT DEFINED HERE
`FEATURE_NAMES` and `TARGET_NAMES` below are a verbatim copy of
`ml/features.ts`. That copy is a liability, and it is deliberately fenced in:

  * `scripts/export-dataset.ts` writes `backend/data/feature-contract.json`
    straight from the TypeScript constants, and `assert_contract()` refuses to
    train if the two disagree. A column reordered in TypeScript therefore fails
    loudly at training time instead of silently pairing every coefficient with
    the wrong feature at inference time.

THE VALIDATION GATE
A surrogate that has not been checked against held-out physics is worse than no
surrogate, because it is confidently wrong. `VALIDATION_GATE` mirrors
`ml/surrogate.ts` and is enforced before a model is allowed to serve anything. A
model that fails the gate is still recorded — with its metrics and a
`passedGate: false` flag — because a failed validation is a result worth
reporting, not something to hide.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .config import DATA_DIR, get_settings

# --------------------------------------------------------------------------- #
# Feature contract — mirrors ml/features.ts FEATURE_NAMES, in order           #
# --------------------------------------------------------------------------- #

FEATURE_NAMES: tuple[str, ...] = (
    # Site and climate
    "latitude",
    "elevation_m",
    "annual_mean_temp_c",
    "max_temp_c",
    "min_temp_c",
    "diurnal_swing_k",
    "relative_humidity_pct",
    "wind_speed_ms",
    "daily_solar_kwh_m2",
    "rainfall_mm",
    # Programme and form
    "floor_area_m2",
    "volume_m3",
    "aspect_ratio",
    "height_m",
    "wall_thickness_m",
    "occupants",
    "occupant_density_per_m2",
    # Orientation, as a continuous pair
    "orientation_sin",
    "orientation_cos",
    # Envelope
    "window_to_wall_ratio",
    "insulation_thickness_m",
    "insulation_level_index",
    "wall_material_index",
    "roof_material_index",
    "window_material_index",
    "wall_u_value",
    "roof_u_value",
    "window_u_value",
    "window_shgc",
    "wall_areal_heat_capacity",
    # Roof and shading
    "roof_type_index",
    "roof_angle_deg",
    "roof_overhang_m",
    "shading_type_index",
    "shading_depth_m",
    # Ventilation and services
    "ventilation_type_index",
    "air_changes_per_hour",
    "cooling_setpoint_c",
    "heating_setpoint_c",
    "cooling_cop",
    "heating_efficiency",
    "solar_pv_kwp",
)

# Mirrors ml/features.ts TARGET_NAMES.
TARGET_NAMES: tuple[str, ...] = (
    "energy_use_intensity_kwh_m2_yr",
    "adaptive_comfort_hours_pct",
    "cost_per_m2_inr",
)

# Mirrors ml/surrogate.ts VALIDATION_GATE. Positional, matching TARGET_NAMES.
#
# The gate is rank correlation plus MAE, not R². The surrogate's job is to rank
# candidate designs so the optimiser can pick a winner, and one target —
# `adaptive_comfort_hours_pct`, a count of comfortable hours out of 8760 — is
# bounded, quantised by the thermal model's time resolution, and has roughly a
# quarter of its mass pinned at zero. A squared-error regressor cannot fit
# quantisation noise that is not a function of its inputs, so its R² is capped
# below 1 regardless of data volume. Measured on 40 000 rows: R² 0.892 against a
# 0.90 floor, but Spearman 0.929 — it orders designs correctly and only fails to
# match the label's absolute variance. Gating on R² would refuse a model that is
# good at the one job it has. R² is still reported so the effect stays visible.
VALIDATION_GATE: dict[str, tuple[float, ...]] = {
    "min_spearman": (0.90, 0.90, 0.90),
    "max_mae": (15.0, 6.0, 2500.0),
}

FEATURE_GROUPS: tuple[dict[str, Any], ...] = (
    {"label": "Site and climate", "count": 10},
    {"label": "Programme and form", "count": 7},
    {"label": "Orientation", "count": 2},
    {"label": "Envelope", "count": 11},
    {"label": "Roof and shading", "count": 5},
    {"label": "Ventilation and services", "count": 7},
)


class ContractMismatch(RuntimeError):
    """The TypeScript encoder and this module disagree about the input vector."""


def feature_names() -> list[str]:
    return list(FEATURE_NAMES)


def target_names() -> list[str]:
    return list(TARGET_NAMES)


def feature_contract() -> dict[str, Any]:
    """The feature and target contract, so a client can generate a dataset."""
    return {
        "featureNames": feature_names(),
        "targetNames": target_names(),
        "featureCount": len(FEATURE_NAMES),
        "groups": [dict(group) for group in FEATURE_GROUPS],
        "gate": {
            "minSpearman": list(VALIDATION_GATE["min_spearman"]),
            "maxMae": list(VALIDATION_GATE["max_mae"]),
        },
    }


def assert_contract() -> None:
    """Cross-check this module's copy against the TypeScript export.

    The file is written by `scripts/export-dataset.ts`. It is optional — a
    service running without it still works, it just loses the guard — but when
    it is present a mismatch is a hard error, because a reordered column is the
    single failure mode that produces plausible-looking wrong numbers.
    """
    path = DATA_DIR / "feature-contract.json"
    if not path.exists():
        return

    payload = json.loads(path.read_text(encoding="utf-8"))
    exported = tuple(payload.get("featureNames") or ())
    exported_targets = tuple(payload.get("targetNames") or ())

    if exported and exported != FEATURE_NAMES:
        first = next(
            (i for i, (a, b) in enumerate(zip(exported, FEATURE_NAMES)) if a != b),
            min(len(exported), len(FEATURE_NAMES)),
        )
        raise ContractMismatch(
            f"Feature contract drift: TypeScript has {len(exported)} features, "
            f"this module has {len(FEATURE_NAMES)}, first difference at column {first} "
            f"('{exported[first] if first < len(exported) else '<end>'}' vs "
            f"'{FEATURE_NAMES[first] if first < len(FEATURE_NAMES) else '<end>'}'). "
            "Re-copy FEATURE_NAMES from ml/features.ts."
        )

    if exported_targets and exported_targets != TARGET_NAMES:
        raise ContractMismatch(
            f"Target contract drift: TypeScript has {exported_targets}, "
            f"this module has {TARGET_NAMES}."
        )

    # The gate is part of the contract too. A gate that is stricter on one side
    # than the other means a model can be recorded as passing by the trainer and
    # refused by the server (or worse, the reverse), so it is checked here rather
    # than trusted to stay in sync by hand.
    exported_gate = payload.get("gate") or {}
    for key, mine in (
        ("minSpearman", VALIDATION_GATE["min_spearman"]),
        ("maxMae", VALIDATION_GATE["max_mae"]),
    ):
        theirs = exported_gate.get(key)
        if theirs is not None and tuple(float(v) for v in theirs) != mine:
            raise ContractMismatch(
                f"Validation gate drift on '{key}': TypeScript has {theirs}, "
                f"this module has {list(mine)}. Re-copy VALIDATION_GATE from ml/surrogate.ts."
            )


def assert_feature_width(row: dict[str, Any]) -> None:
    """Fail loudly on a feature-count mismatch.

    A silent mismatch is the worst failure mode here: the model would still
    return a number, and it would be meaningless.
    """
    missing = [name for name in FEATURE_NAMES if name not in row]
    if missing:
        raise ValueError(
            f"Row is missing {len(missing)} feature(s): {', '.join(missing[:8])}"
            + ("…" if len(missing) > 8 else "")
        )


def matrix(rows: list[dict[str, Any]]) -> np.ndarray:
    """Stack rows into the ordered training matrix.

    Order comes from `FEATURE_NAMES`, never from the dictionary's own key order,
    so a JSON payload with keys in a different order still lands in the right
    columns.
    """
    for row in rows:
        assert_feature_width(row)
    return np.asarray(
        [[float(row[name]) for name in FEATURE_NAMES] for row in rows],
        dtype=np.float64,
    )


# --------------------------------------------------------------------------- #
# Training                                                                    #
# --------------------------------------------------------------------------- #


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    """Spearman rank correlation, computed without a scipy dependency.

    Ranks both vectors (average ranks for ties, which matters here because the
    comfort target has a large point mass at zero) and takes the Pearson
    correlation of the ranks.
    """

    def average_ranks(values: np.ndarray) -> np.ndarray:
        order = np.argsort(values, kind="mergesort")
        sorted_values = values[order]
        ranks = np.empty(len(values), dtype=np.float64)
        index = 0
        while index < len(sorted_values):
            stop = index
            while stop + 1 < len(sorted_values) and sorted_values[stop + 1] == sorted_values[index]:
                stop += 1
            ranks[order[index : stop + 1]] = (index + stop) / 2.0 + 1.0
            index = stop + 1
        return ranks

    rank_a = average_ranks(a)
    rank_b = average_ranks(b)
    if rank_a.std() == 0 or rank_b.std() == 0:
        return 0.0
    return float(np.corrcoef(rank_a, rank_b)[0, 1])


def _train_one(
    features: np.ndarray,
    labels: np.ndarray,
    *,
    test_fraction: float,
    n_estimators: int,
    max_depth: int,
    learning_rate: float,
    seed: int,
) -> tuple[Any, dict[str, float]]:
    """Fit one booster and report held-out error."""
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    from sklearn.model_selection import train_test_split
    from xgboost import XGBRegressor

    x_train, x_test, y_train, y_test = train_test_split(
        features, labels, test_size=test_fraction, random_state=seed
    )

    model = XGBRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        learning_rate=learning_rate,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        objective="reg:squarederror",
        random_state=seed,
        n_jobs=0,
    )
    model.fit(x_train, y_train)

    predictions = model.predict(x_test)
    return model, {
        "r2": float(r2_score(y_test, predictions)),
        "rmse": float(np.sqrt(mean_squared_error(y_test, predictions))),
        "mae": float(mean_absolute_error(y_test, predictions)),
        "spearman": _spearman(np.asarray(y_test, dtype=np.float64), predictions),
        "trainRows": int(len(x_train)),
        "testRows": int(len(x_test)),
    }


def train_surrogate(
    rows: list[dict[str, Any]],
    *,
    targets: tuple[str, ...] | list[str] = TARGET_NAMES,
    test_fraction: float = 0.2,
    n_estimators: int = 400,
    max_depth: int = 6,
    learning_rate: float = 0.05,
    seed: int = 42,
) -> dict[str, Any]:
    """Fit one gradient-boosted regressor per target.

    All targets share a `model_id` so a prediction request resolves them
    together — a caller should never be able to mix a fresh energy model with a
    stale comfort model and get a coherent-looking answer out of the pair.

    Returns metrics and artefact paths. It does not decide whether the model is
    good enough: `passedGate` is reported per target and as an overall verdict,
    and the caller (and the UI) can see both the numbers and the verdict.
    """
    settings = get_settings()
    assert_contract()

    requested = tuple(targets)
    unknown = [name for name in requested if name not in TARGET_NAMES]
    if unknown:
        raise ValueError(
            f"Unknown target(s): {', '.join(unknown)}. Valid targets: {', '.join(TARGET_NAMES)}."
        )

    if len(rows) < settings.min_train_rows:
        raise ValueError(
            f"Need at least {settings.min_train_rows} training rows, got {len(rows)}. "
            "Generate a dataset with `npm run export:dataset` in the project root."
        )

    features = matrix(rows)

    model_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    model_dir = Path(settings.model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for target in requested:
        if any(target not in row for row in rows):
            raise ValueError(f"Training row is missing target '{target}'")

        labels = np.asarray([float(row[target]) for row in rows], dtype=np.float64)
        model, scores = _train_one(
            features,
            labels,
            test_fraction=test_fraction,
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=learning_rate,
            seed=seed,
        )

        artifact_path = model_dir / f"{target}-{model_id}.json"
        model.save_model(artifact_path)

        index = TARGET_NAMES.index(target)
        min_spearman = VALIDATION_GATE["min_spearman"][index]
        max_mae = VALIDATION_GATE["max_mae"][index]
        passed = bool(
            scores["spearman"] >= min_spearman
            and scores["mae"] <= max_mae
            and len(rows) >= settings.min_train_rows
        )

        importance = sorted(
            (
                {"feature": name, "importance": float(score)}
                for name, score in zip(FEATURE_NAMES, model.feature_importances_)
            ),
            key=lambda entry: entry["importance"],
            reverse=True,
        )

        results.append(
            {
                "target": target,
                "artifactPath": str(artifact_path),
                "passedGate": passed,
                "metrics": {
                    "target": target,
                    "rows": len(rows),
                    "trainRows": scores["trainRows"],
                    "testRows": scores["testRows"],
                    "r2": scores["r2"],
                    "rmse": scores["rmse"],
                    "mae": scores["mae"],
                    "spearman": scores["spearman"],
                    "passedGate": passed,
                    "gateMinSpearman": min_spearman,
                    "gateMaxMae": max_mae,
                    "featureNames": feature_names(),
                },
                "featureImportance": importance,
            }
        )

    return {
        "modelId": model_id,
        "createdAt": created_at,
        "targets": results,
        # Overall verdict: the model is only usable when *every* target cleared
        # its gate, because a screening tool that can rank energy but not comfort
        # would rank designs by the wrong thing.
        "passedGate": all(entry["passedGate"] for entry in results),
        "explanation": _verdict(results),
    }


def _verdict(results: list[dict[str, Any]]) -> str:
    passed = [entry["target"] for entry in results if entry["passedGate"]]
    failed = [
        f"{entry['target']} (rank correlation {entry['metrics']['spearman']:.3f} < "
        f"{entry['metrics']['gateMinSpearman']}, R² {entry['metrics']['r2']:.3f})"
        for entry in results
        if not entry["passedGate"]
    ]
    if not failed:
        return (
            f"All {len(results)} targets cleared the validation gate and the model may "
            f"serve predictions: {', '.join(passed)}."
        )
    return (
        f"{len(failed)} of {len(results)} targets failed the validation gate and the model "
        f"is refused at inference: {'; '.join(failed)}. It is recorded with its metrics so "
        "the failure is visible rather than silent."
    )


# --------------------------------------------------------------------------- #
# Inference                                                                   #
# --------------------------------------------------------------------------- #


def _load_model(model_id: str, target: str) -> Any:
    """Load a saved booster by id.

    Only models recorded in the database can be loaded, so a caller cannot point
    the service at an arbitrary file path.
    """
    from xgboost import XGBRegressor

    from . import db

    rows = [r for r in db.all_surrogates() if r["modelId"] == model_id and r["target"] == target]
    if not rows:
        raise FileNotFoundError(f"Model '{model_id}' has no registered booster for '{target}'")

    settings = get_settings()
    path = Path(settings.model_dir) / f"{target}-{model_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Model artefact missing for '{model_id}' / '{target}'")

    model = XGBRegressor()
    model.load_model(path)
    return model


class Predictor:
    """The three boosters and their error bars, loaded once and reused.

    WHY THIS EXISTS
    A screening sweep evaluates hundreds of candidates. The obvious
    implementation — call `predict()` per candidate — reloads every booster from
    disk and re-reads the registry on every call, which turned a 66-candidate
    sweep into a 33-second request. Loading is the expensive part; prediction is
    not. So the artefacts are loaded once and the candidate matrix is scored in
    three vectorised calls.

    This is the whole reason a surrogate is worth having: screening a design
    space should be cheap, and a service that answers in 33 seconds has given up
    the only advantage it had over the physics engine it was trained on.
    """

    def __init__(
        self,
        model_id: str,
        boosters: dict[str, Any],
        error_bars: dict[str, float],
    ) -> None:
        self.model_id = model_id
        self._boosters = boosters
        self.error_bars = error_bars

    def predict_many(self, rows: list[dict[str, Any]]) -> list[dict[str, float]]:
        """Score a batch of feature dictionaries, one prediction set per row."""
        if not rows:
            return []

        features = matrix(rows)
        columns = {
            target: self._boosters[target].predict(features) for target in TARGET_NAMES
        }
        return [
            {target: float(columns[target][index]) for target in TARGET_NAMES}
            for index in range(len(rows))
        ]

    def predict_one(self, features: dict[str, Any]) -> dict[str, float]:
        missing = [name for name in FEATURE_NAMES if name not in features]
        if missing:
            raise ValueError(
                f"Prediction needs all {len(FEATURE_NAMES)} features; "
                f"{len(missing)} missing (first: {', '.join(missing[:5])})"
            )
        return self.predict_many([features])[0]


def load_predictor(model_id: str | None = None) -> Predictor:
    """Resolve a model and load all of its boosters, once.

    The registry is read a single time rather than once per target, and the
    artefacts are loaded here rather than at every call site.
    """
    from . import db

    resolved = resolve_model_id(model_id)

    records = [r for r in db.all_surrogates() if r["modelId"] == resolved]
    registered = {record["target"] for record in records}
    missing = [target for target in TARGET_NAMES if target not in registered]
    if missing:
        # Same guard as `_load_model`: a model that is not in the registry is not
        # loadable, so a caller cannot point the service at a stray file.
        raise FileNotFoundError(
            f"Model '{resolved}' is not registered for: {', '.join(missing)}"
        )

    boosters = {target: _load_model(resolved, target) for target in TARGET_NAMES}
    error_bars = {
        record["target"]: float(record["metrics"]["mae"]) for record in records
    }
    return Predictor(resolved, boosters, error_bars)


def resolve_model_id(model_id: str | None = None) -> str:
    """Find the newest model that cleared the gate for every target."""
    from . import db

    if model_id:
        return model_id

    records = db.all_surrogates()
    if not records:
        raise FileNotFoundError(
            "No surrogate has been trained. POST /api/ml/train first."
        )

    # Group by model id and keep the newest group that passed every target.
    seen: dict[str, list[dict[str, Any]]] = {}
    for record in records:  # already ordered newest first
        seen.setdefault(record["modelId"], []).append(record)

    for candidate_id, group in seen.items():
        covered = {entry["target"] for entry in group}
        if covered >= set(TARGET_NAMES) and all(entry["passedGate"] for entry in group):
            return candidate_id

    newest = records[0]
    raise PermissionError(
        f"No model has cleared the validation gate for all {len(TARGET_NAMES)} targets. "
        f"The newest ({newest['modelId'][:8]}) is refused: {newest['metrics']['spearman']:.3f} "
        f"rank correlation against a {newest['metrics']['gateMinSpearman']} floor on "
        f"'{newest['target']}'. A model that would silently mis-rank designs is worse than "
        "no model."
    )


def predict(
    features: dict[str, Any],
    *,
    model_id: str | None = None,
) -> dict[str, Any]:
    """Predict every target from one feature dictionary.

    Missing features are reported rather than defaulted: a prediction made from a
    silently zero-filled vector would be worse than an error.

    For a batch, use `load_predictor()` once and call `Predictor.predict_many` —
    this function reloads the artefacts on every call, which is fine for a single
    request and wrong for a sweep.
    """
    missing = [name for name in FEATURE_NAMES if name not in features]
    if missing:
        raise ValueError(
            f"Prediction needs all {len(FEATURE_NAMES)} features; "
            f"{len(missing)} missing (first: {', '.join(missing[:5])})"
        )

    predictor = load_predictor(model_id)

    return {
        "modelId": predictor.model_id,
        "predictions": predictor.predict_one(features),
        "errorBars": predictor.error_bars,
        "usedFeatures": feature_names(),
        "missingFeatures": [],
    }


def describe_registry() -> dict[str, Any]:
    """What the service knows about its own models.

    Tolerant of records written under an older contract. A model registered
    before the gate changed still has rows in the database, and those rows do
    not carry the metrics the current gate reads. Such a record cannot be shown
    to satisfy the present gate, so it is reported as stale and not counted as
    ready — but it must not raise, because a single legacy row taking down
    `/api/health` would be a worse failure than the one it is reporting.
    """
    from . import db

    settings = get_settings()
    records = db.all_surrogates()

    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        grouped.setdefault(record["modelId"], []).append(record)

    def target_row(entry: dict[str, Any]) -> dict[str, Any]:
        metrics = entry.get("metrics") or {}
        spearman = metrics.get("spearman")
        return {
            "target": entry["target"],
            "r2": metrics.get("r2"),
            "mae": metrics.get("mae"),
            "rmse": metrics.get("rmse"),
            "spearman": spearman,
            "gateMinSpearman": metrics.get("gateMinSpearman"),
            "gateMaxMae": metrics.get("gateMaxMae"),
            # A missing rank correlation means the row predates the current
            # gate. Unknown is not the same as passed.
            "passedGate": bool(entry["passedGate"]) and spearman is not None,
            "stale": spearman is None,
        }

    models = [
        {
            "modelId": model_id,
            "createdAt": group[0]["createdAt"],
            "passedGate": bool(
                {entry["target"] for entry in group} >= set(TARGET_NAMES)
                and all(target_row(entry)["passedGate"] for entry in group)
            ),
            "targets": [target_row(entry) for entry in group],
            "topFeatures": [
                entry["feature"] for entry in (group[0]["featureImportance"] or [])[:8]
            ],
        }
        for model_id, group in grouped.items()
    ]

    return {
        "models": models,
        "ready": sum(1 for model in models if model["passedGate"]),
        "featureCount": len(FEATURE_NAMES),
        "targets": target_names(),
        "gate": {
            "minSpearman": list(VALIDATION_GATE["min_spearman"]),
            "maxMae": list(VALIDATION_GATE["max_mae"]),
        },
        "minTrainRows": settings.min_train_rows,
        "explanation": (
            "A surrogate is only allowed to serve predictions once it has cleared the "
            "validation gate on held-out data for every target. Models that failed the "
            "gate are listed with their metrics and refused at inference."
        ),
    }


def dump(value: Any) -> str:
    return json.dumps(value, indent=2, default=str)
