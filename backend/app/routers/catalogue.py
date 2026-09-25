"""Material catalogue and the shared design vocabulary.

Served straight from the exported JSON. There is no logic here on purpose: the
whole point of exporting rather than porting is that the frontend and the backend
cannot disagree about what "high insulation" means, so this router's job is to
hand the exported answer over unchanged.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from .. import catalog
from ..models import MaterialProperties

router = APIRouter(prefix="/api", tags=["catalogue"])


@router.get(
    "/materials",
    response_model=list[MaterialProperties],
    summary="Wall, roof, window and insulation assemblies",
)
def materials(
    category: str | None = Query(
        default=None,
        description="wall | roof | window | insulation | floor",
    )
) -> list[MaterialProperties]:
    records = (
        catalog.materials_by_category(category) if category else list(catalog.all_materials())
    )
    if category and not records:
        raise HTTPException(status_code=404, detail=f"No materials in category '{category}'")
    return [MaterialProperties.model_validate(record) for record in records]


@router.get("/materials/{material_id}", response_model=MaterialProperties)
def material(material_id: str) -> MaterialProperties:
    record = catalog.material_index().get(material_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"No material '{material_id}'")
    return MaterialProperties.model_validate(record)


@router.get("/vocabulary", summary="Enumerated design vocabularies and their constants")
def vocabulary() -> dict[str, Any]:
    """The shared mappings: insulation thickness per level, ACH per strategy,
    roof pitch per form, and the default design programme.

    Returned as-is rather than re-modelled, because its shape is owned by
    `thermal/constants.ts` and re-declaring it here would be one more thing to
    keep in step.
    """
    return catalog.vocabulary()


@router.get("/requirements/default", summary="The documented default design programme")
def default_requirements() -> dict[str, Any]:
    return catalog.default_requirements()
