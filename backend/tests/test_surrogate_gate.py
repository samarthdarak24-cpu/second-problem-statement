"""Regression tests for the surrogate gate, registry and persistence.

Each test here corresponds to a defect that the earlier suite did not catch. They
are grouped in one file because they share a subject — the contract between a
trained model, the database that records it, and the two endpoints that report
on it — and because that contract is where the bugs were.

WHAT WENT WRONG, AND WHY THESE TESTS EXIST
  1. `SurrogateRow.id` was the sole primary key, but one training run writes one
     row per target under a single shared `model_id`. The second target collided
     on insert and training returned HTTP 500. Nothing exercised multi-target
     persistence, so the suite was green.
  2. `TargetReport.feature_importance` was typed `list[dict[str, float]]`, which
     coerced the feature *name* to a float. Training then failed at response
     serialisation with 126 validation errors. No test had ever trained a model.
  3. `/api/health` computed `surrogate_ready` with `any(...)` over the per-target
     rows, so it reported "ML surrogate" as soon as one target passed — while
     `/api/optimize` was still refusing. The health badge overstated readiness,
     which is the specific dishonesty the service is built to avoid.
  4. `describe_registry()` read metrics keys unconditionally, so a single record
     written under an older contract raised `KeyError` and took down
     `/api/health`. A stale row must be reported as stale, not fatal.

Run:  cd backend && .venv/Scripts/python -m pytest tests/test_surrogate_gate.py
"""

from __future__ import annotations

import uuid

import numpy as np
import pytest

from app import db, ml


def _metrics(target: str, *, passed: bool = True, legacy: bool = False) -> dict:
    """The metrics blob, optionally as an older contract wrote it."""
    metrics = {
        "target": target,
        "rows": 1000,
        "trainRows": 800,
        "testRows": 200,
        "r2": 0.95,
        "rmse": 1.0,
        "mae": 1.0,
        "passedGate": passed,
    }
    if not legacy:
        metrics["spearman"] = 0.95
        metrics["gateMinSpearman"] = 0.9
        metrics["gateMaxMae"] = 100.0
    return metrics


def _payload(model_id: str, target: str, *, passed: bool = True, legacy: bool = False) -> dict:
    """The shape `record_surrogate` accepts."""
    return {
        "modelId": model_id,
        "target": target,
        "metrics": _metrics(target, passed=passed, legacy=legacy),
        "featureImportance": [{"feature": "roof_u_value", "importance": 0.3}],
        "artifactPath": f"/tmp/{target}-{model_id}.json",
        "createdAt": "2026-01-01T00:00:00+00:00",
    }


def _record(model_id: str, target: str, *, passed: bool = True, legacy: bool = False) -> dict:
    """The shape `all_surrogates()` returns — what the registry actually reads."""
    metrics = _metrics(target, passed=passed, legacy=legacy)
    return {
        "modelId": model_id,
        "target": target,
        "createdAt": "2026-01-01T00:00:00+00:00",
        "metrics": metrics,
        "featureImportance": [{"feature": "roof_u_value", "importance": 0.3}],
        "passedGate": passed,
    }


# --------------------------------------------------------------------------- #
# 1 — One model id, one row per target                                        #
# --------------------------------------------------------------------------- #


def test_one_model_id_can_hold_one_booster_per_target() -> None:
    """Every target of a run must persist. This is the composite-key fix.

    The id is deliberately shared: it is the handle that lets a prediction
    resolve all three targets together. If it were unique per row, only one
    target could ever be stored.
    """
    model_id = str(uuid.uuid4())
    try:
        for target in ml.TARGET_NAMES:
            db.record_surrogate(_payload(model_id, target))

        stored = [r for r in db.all_surrogates() if r["modelId"] == model_id]
        assert {r["target"] for r in stored} == set(ml.TARGET_NAMES)
    finally:
        db.delete_surrogate(model_id)


def test_deleting_a_model_removes_every_target() -> None:
    """Forgetting a model must forget all of it, not just its newest target."""
    model_id = str(uuid.uuid4())
    for target in ml.TARGET_NAMES:
        db.record_surrogate(_payload(model_id, target))

    assert db.delete_surrogate(model_id) == len(ml.TARGET_NAMES)
    assert [r for r in db.all_surrogates() if r["modelId"] == model_id] == []


# --------------------------------------------------------------------------- #
# 2 — Feature names survive serialisation                                     #
# --------------------------------------------------------------------------- #


def test_feature_importance_keeps_the_feature_name_as_text() -> None:
    """The response model must not coerce a feature name to a float.

    `TargetReport.feature_importance` was `list[dict[str, float]]`, and a
    homogeneous dictionary type coerces *every* value — so `roof_u_value` was
    parsed as a number and training died at serialisation. This pins the shape.
    """
    from app.models import FeatureImportance, TargetReport

    report = TargetReport.model_validate(
        {
            "target": "energy_use_intensity_kwh_m2_yr",
            "metrics": {
                "target": "energy_use_intensity_kwh_m2_yr",
                "rows": 100,
                "trainRows": 80,
                "testRows": 20,
                "r2": 0.9,
                "rmse": 1.0,
                "mae": 1.0,
                "spearman": 0.9,
                "passedGate": True,
                "gateMinSpearman": 0.9,
                "gateMaxMae": 15.0,
                "featureNames": ["roof_u_value"],
            },
            "featureImportance": [{"feature": "roof_u_value", "importance": 0.3}],
        }
    )

    assert isinstance(report.feature_importance[0], FeatureImportance)
    assert report.feature_importance[0].feature == "roof_u_value"
    assert report.feature_importance[0].importance == pytest.approx(0.3)


# --------------------------------------------------------------------------- #
# 3 — Readiness requires every target, not any one                            #
# --------------------------------------------------------------------------- #


def test_readiness_requires_every_target_to_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    """One passing target is not a usable model.

    The screening tool ranks designs by a weighted combination of all three
    predictions, so a model that can rank energy but not comfort would rank
    designs by the wrong thing. `any(...)` reported that model as ready.
    """
    model_id = str(uuid.uuid4())
    # Energy and cost pass; comfort fails.
    records = [
        _record(model_id, "energy_use_intensity_kwh_m2_yr", passed=True),
        _record(model_id, "adaptive_comfort_hours_pct", passed=False),
        _record(model_id, "cost_per_m2_inr", passed=True),
    ]
    monkeypatch.setattr(db, "all_surrogates", lambda: records)

    registry = ml.describe_registry()
    assert registry["ready"] == 0
    assert registry["models"][0]["passedGate"] is False

    # And the refusal is a refusal, not a crash.
    with pytest.raises(PermissionError):
        ml.resolve_model_id()


def test_readiness_is_true_only_when_all_targets_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    model_id = str(uuid.uuid4())
    records = [_record(model_id, target, passed=True) for target in ml.TARGET_NAMES]
    monkeypatch.setattr(db, "all_surrogates", lambda: records)

    assert ml.describe_registry()["ready"] == 1
    assert ml.resolve_model_id() == model_id


# --------------------------------------------------------------------------- #
# 4 — A record from an older contract is stale, not fatal                     #
# --------------------------------------------------------------------------- #


def test_registry_reports_a_legacy_record_as_stale(monkeypatch: pytest.MonkeyPatch) -> None:
    """A row written before the gate changed must not take down `/api/health`.

    It also must not be counted as ready: a record that does not carry the
    metrics the current gate reads cannot be shown to satisfy it. Unknown is not
    the same as passed.
    """
    model_id = str(uuid.uuid4())
    records = [_record(model_id, target, legacy=True) for target in ml.TARGET_NAMES]
    monkeypatch.setattr(db, "all_surrogates", lambda: records)

    registry = ml.describe_registry()

    assert registry["ready"] == 0
    assert all(row["stale"] for row in registry["models"][0]["targets"])
    assert all(row["passedGate"] is False for row in registry["models"][0]["targets"])


# --------------------------------------------------------------------------- #
# 5 — Rank correlation                                                         #
# --------------------------------------------------------------------------- #


def test_spearman_matches_its_definition() -> None:
    """Perfect agreement is 1, perfect reversal is -1, a constant is 0."""
    perfect = np.arange(50, dtype=float)
    assert ml._spearman(perfect, perfect) == pytest.approx(1.0)
    assert ml._spearman(perfect, -perfect) == pytest.approx(-1.0)
    # A constant prediction carries no ordering information, so the correlation
    # is undefined; the function must return 0 rather than nan.
    assert ml._spearman(perfect, np.zeros(50)) == pytest.approx(0.0)


def test_spearman_averages_ranks_for_ties() -> None:
    """Ties in the truth are one averaged rank, not an arbitrary order.

    This matters for the real data: about a quarter of the comfort labels are
    exactly zero, so tie handling is not a corner case here — it is the common
    case.
    """
    truth = np.array([0.0, 0.0, 0.0, 1.0, 2.0])

    # Same ordering and same tie structure is a perfect match.
    assert ml._spearman(truth, np.array([0.0, 0.0, 0.0, 1.0, 2.0])) == pytest.approx(1.0)
    # A monotone rescale of that structure is still perfect: the three zeros are
    # indistinguishable, so their common value does not matter.
    assert ml._spearman(truth, np.array([5.0, 5.0, 5.0, 9.0, 20.0])) == pytest.approx(1.0)

    # Splitting a block the truth treats as tied *is* a disagreement, and must
    # score below 1 — the model is claiming an ordering the label does not have.
    assert ml._spearman(truth, np.array([0.0, 1.0, 2.0, 3.0, 4.0])) < 1.0


def test_spearman_is_invariant_to_a_monotone_rescale() -> None:
    """Rank correlation must not care about units or monotone distortion.

    This is the property that makes it the right gate for a bounded, censored
    target: the model is judged on the order it produces, not on whether its
    numbers land on the label's scale.
    """
    truth = np.linspace(0.0, 100.0, 200)
    distorted = np.sign(truth - 50) * np.sqrt(np.abs(truth - 50)) * 1000 + 7
    assert ml._spearman(truth, distorted) == pytest.approx(1.0)
