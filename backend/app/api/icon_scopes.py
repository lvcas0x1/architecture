"""Reading and writing icon attributes (placement layers)."""

from __future__ import annotations

from fastapi import APIRouter

from app.deps import StoreDep
from app.models import IconScopes

router = APIRouter(tags=["icons"])


@router.get("/icon-scopes", response_model=IconScopes)
def get_icon_scopes(store: StoreDep) -> IconScopes:
    return store.read_icon_scopes()


@router.put("/icon-scopes", response_model=IconScopes)
def put_icon_scopes(scopes: IconScopes, store: StoreDep) -> IconScopes:
    """Replace the whole set: the editor always holds all of it, and last write wins."""
    store.write_icon_scopes(scopes)
    return store.read_icon_scopes()
