"""Serving the icon catalog."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.icons import load_icon_catalog
from app.models import IconCatalog

router = APIRouter(tags=["icons"])


@router.get("/icons", response_model=IconCatalog)
def get_icons() -> IconCatalog:
    """The official icon catalog, or the placeholder set when it is not imported."""
    catalog = load_icon_catalog()
    if catalog is not None:
        return catalog
    raise HTTPException(
        status_code=404,
        detail="No icon catalog found. Run `npm run icons` or `npm run icons:placeholder`.",
    )
