"""Fetching and refreshing resources."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.aws.arn import InvalidArnError
from app.aws.fetcher import ResourceOwner, UnsupportedResourceError, fetch_resource
from app.deps import ClientsDep, SettingsDep, StoreDep
from app.models import Inventory, NormalizedResource
from app.store import Store

router = APIRouter(tags=["resources"])

#: How many refreshes run at once. Kept modest to avoid throttling.
_MAX_WORKERS = 8


def _owners(store: Store, arns: list[str]) -> dict[str, ResourceOwner]:
    """Read inventory owners once per request for ARNs without account or region."""
    wanted = set(arns)
    return {
        entry.arn: ResourceOwner(account_id=entry.account_id, region=entry.region)
        for entry in store.read_inventory().entries
        if entry.arn in wanted
    }


class RefreshBulkRequest(BaseModel):
    arns: list[str] = Field(min_length=1, max_length=500)


class RefreshBulkResponse(BaseModel):
    resources: list[NormalizedResource]
    errors: dict[str, str] = Field(default_factory=dict)


@router.get("/inventory", response_model=Inventory)
def get_inventory(store: StoreDep) -> Inventory:
    """Return the inventory, deriving it from detail files when absent."""
    return store.read_inventory()


@router.get("/resources/{arn:path}", response_model=NormalizedResource)
def get_resource(arn: str, store: StoreDep) -> NormalizedResource:
    """Return the saved normalized JSON, or 404 when there is none (\"Refresh\" fetches it)."""
    try:
        resource = store.read_resource(arn)
    except InvalidArnError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if resource is None:
        raise HTTPException(
            status_code=404,
            detail=f"Resource has not been fetched yet: {arn} (right-click -> Refresh)",
        )
    return resource


@router.post("/resources/refresh-bulk", response_model=RefreshBulkResponse)
def refresh_bulk(
    payload: RefreshBulkRequest,
    store: StoreDep,
    clients: ClientsDep,
    settings: SettingsDep,
) -> RefreshBulkResponse:
    """Refresh every ARN the diagram references."""
    arns = list(dict.fromkeys(payload.arns))
    owners = _owners(store, arns)
    resources: list[NormalizedResource] = []
    errors: dict[str, str] = {}

    def work(arn: str) -> tuple[str, NormalizedResource | str]:
        try:
            return arn, fetch_resource(arn, clients, settings, owners.get(arn))
        except UnsupportedResourceError as exc:
            return arn, str(exc)

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for arn, result in pool.map(work, arns):
            if isinstance(result, str):
                errors[arn] = result
            else:
                store.write_resource(result)
                resources.append(result)

    return RefreshBulkResponse(resources=resources, errors=errors)


@router.post("/resources/{arn:path}/refresh", response_model=NormalizedResource)
def refresh_resource(
    arn: str,
    store: StoreDep,
    clients: ClientsDep,
    settings: SettingsDep,
) -> NormalizedResource:
    """Fetch and save resource details; retain deleted and failed lifecycle states."""
    try:
        resource = fetch_resource(arn, clients, settings, _owners(store, [arn]).get(arn))
    except UnsupportedResourceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    store.write_resource(resource)
    return resource
