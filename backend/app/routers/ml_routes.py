"""Surrogate training, registry and inference.

This is the one capability that genuinely belongs on a server. Training is
CPU-bound and the artefact is too large to ship to a browser, so a trained model
is a thing the frontend can *ask about* but not hold.

The endpoints deliberately do not decide whether a model is good enough. They
report `passedGate` alongside the metrics, and `POST /api/ml/predict` refuses to
serve from a model that failed — the refusal is the point, because a model that
has not been validated against held-out physics is confidently wrong.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import db, ml
from ..models import (
    PredictRequest,
    PredictResponse,
    TrainResponse,
    TrainingRequest,
)

router = APIRouter(prefix="/api/ml", tags=["machine learning"])


@router.get("/contract", summary="Feature and target contract for dataset generation")
def contract() -> dict[str, Any]:
    """What a training set must contain.

    Exposed so `scripts/export-dataset.ts` can generate a dataset without
    hard-coding the column list, and so a mismatch is caught before training
    rather than after.
    """
    return ml.feature_contract()


@router.get("/registry", summary="Trained models and their held-out metrics")
def registry() -> dict[str, Any]:
    return ml.describe_registry()


@router.post("/train", response_model=TrainResponse, summary="Train the surrogate")
def train(payload: TrainingRequest) -> TrainResponse:
    """Fit one booster per target and record the result.

    The dataset arrives in the request body. That is deliberate: the physics
    engine that labels the rows lives in TypeScript, so the backend never has to
    re-implement it, and the training data is reproducible from the frontend's
    own verified code.
    """
    rows = [dict(row) for row in payload.rows]
    targets = tuple(payload.targets) if payload.targets else ml.TARGET_NAMES

    result = ml.train_surrogate(
        rows,
        targets=targets,
        test_fraction=payload.test_fraction,
        n_estimators=payload.n_estimators,
        max_depth=payload.max_depth,
        learning_rate=payload.learning_rate,
        seed=payload.seed,
    )

    # Record every target, passed or failed. A failed validation is a result
    # worth keeping: it is what stops the next caller from trusting the model.
    for entry in result["targets"]:
        db.record_surrogate(
            {
                "modelId": result["modelId"],
                "target": entry["target"],
                "createdAt": result["createdAt"],
                "artifactPath": entry["artifactPath"],
                "metrics": entry["metrics"],
                "featureImportance": entry["featureImportance"],
            }
        )

    return TrainResponse.model_validate(result)


@router.post("/predict", response_model=PredictResponse, summary="Predict from a trained model")
def predict(payload: PredictRequest) -> PredictResponse:
    result = ml.predict(payload.features, model_id=payload.model_id)
    return PredictResponse.model_validate(result)


@router.get("/features", summary="Ordered feature names")
def features() -> dict[str, Any]:
    return {"featureNames": ml.feature_names(), "count": len(ml.feature_names())}


@router.delete("/registry/{model_id}", summary="Forget a model")
def forget(model_id: str) -> dict[str, Any]:
    """Remove a model's records so it can no longer be loaded.

    Refuses while it is the newest model, so a stray delete cannot silently
    demote the service to the rule-based engine mid-demo. The artefact files are
    left on disk; this only removes the records that make them loadable.
    """
    records = [r for r in db.all_surrogates() if r["modelId"] == model_id]
    if not records:
        raise HTTPException(status_code=404, detail=f"No model '{model_id}'")

    newest = db.all_surrogates()[0]["modelId"]
    if model_id == newest:
        raise HTTPException(
            status_code=409,
            detail=(
                "Refusing to forget the newest model. Train a replacement first, or "
                "remove the artefact from the models directory directly."
            ),
        )

    removed = db.delete_surrogate(model_id)
    return {
        "forgotten": model_id,
        "targets": [r["target"] for r in records],
        "recordsRemoved": removed,
    }
