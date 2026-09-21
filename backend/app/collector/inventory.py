"""Collecting the inventory (an index of thousands of resources)."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

from app.aws.profiles import profile_for_arn_key, profile_for_type
from app.aws.session import ClientFactory
from app.config import Settings
from app.models import Inventory, InventoryEntry, Tag

logger = logging.getLogger(__name__)

#: Config's non-aggregate queries default to 25 per page. Set it to cut round trips.
_CONFIG_PAGE_SIZE = 100
_RESOURCE_EXPLORER_PAGE_SIZE = 1000


def _entry_from_parts(
    arn: str,
    account_id: str,
    region: str,
    resource_type: str | None,
    name: str | None,
    tags: list[Tag],
    settings: Settings,
) -> InventoryEntry | None:
    """Index only the ARNs a Profile can handle (listing undrawable ones just confuses)."""
    from app.aws.arn import InvalidArnError, parse_arn

    try:
        parsed = parse_arn(arn)
    except InvalidArnError:
        logger.debug("Excluded because it is not a readable ARN: %s", arn)
        return None

    profile = (
        profile_for_type(resource_type)
        if resource_type and resource_type.startswith("AWS::")
        else None
    ) or profile_for_arn_key(parsed.lookup_key)

    if profile is None:
        return None

    return InventoryEntry(
        arn=arn,
        account_id=account_id or parsed.account_id,
        account_alias=settings.alias_for(account_id or parsed.account_id),
        region=region or parsed.region,
        resource_type=profile.resource_type,
        resource_id=parsed.resource_id,
        service=profile.service,
        name=name,
        tags=tags,
        icon_key=profile.icon_key,
        lifecycle="unknown",
        has_detail=False,
    )


def collect_via_resource_explorer(
    clients: ClientFactory,
    settings: Settings,
    *,
    account_id: str,
    region: str,
    view_arn: str | None = None,
    query: str = "",
) -> Iterator[InventoryEntry]:
    """Build the index from a Resource Explorer multi-account search."""
    client = clients("resource-explorer-2", account_id, region)
    params: dict[str, Any] = {
        "QueryString": query,
        "MaxResults": _RESOURCE_EXPLORER_PAGE_SIZE,
    }
    if view_arn:
        params["ViewArn"] = view_arn

    next_token: str | None = None
    while True:
        if next_token:
            params["NextToken"] = next_token
        response = client.search(**params)

        for item in response.get("Resources") or []:
            tags = _tags_from_properties(item.get("Properties") or [])
            entry = _entry_from_parts(
                arn=item.get("Arn", ""),
                account_id=item.get("OwningAccountId", ""),
                region=item.get("Region", ""),
                # "ec2:instance" form. Same granularity as arn_keys, so a Profile can be found.
                resource_type=item.get("ResourceType"),
                name=None,
                tags=tags,
                settings=settings,
            )
            if entry:
                yield entry

        # One search returns at most the first 1,000. Do not quietly present a
        # truncated result as the whole thing.
        count = response.get("Count") or {}
        if count.get("Complete") is False:
            logger.warning(
                "Resource Explorer results were truncated at the limit (%s). Split the search: %r",
                count.get("TotalResources"),
                query or "(everything)",
            )

        next_token = response.get("NextToken")
        if not next_token:
            break


def _tags_from_properties(properties: list[dict[str, Any]]) -> list[Tag]:
    """Read tags from Resource Explorer Properties.Data."""
    tags: list[Tag] = []
    for prop in properties:
        if prop.get("Name") != "tags":
            continue
        for tag in prop.get("Data") or []:
            key = tag.get("Key")
            if key:
                tags.append(Tag(key=key, value=str(tag.get("Value", ""))))
    return tags


def collect_via_config_aggregator(
    clients: ClientFactory,
    settings: Settings,
    *,
    account_id: str,
    region: str,
    aggregator_name: str,
    resource_types: list[str] | None = None,
) -> Iterator[InventoryEntry]:
    """Build the index from an AWS Config aggregator advanced query."""
    client = clients("config", account_id, region)

    types = resource_types or [p.resource_type for p in _supported_profiles()]
    quoted = ", ".join(f"'{t}'" for t in types)
    expression = (
        "SELECT arn, accountId, awsRegion, resourceType, resourceId, resourceName, tags "
        f"WHERE resourceType IN ({quoted})"
    )

    next_token: str | None = None
    while True:
        params: dict[str, Any] = {
            "Expression": expression,
            "ConfigurationAggregatorName": aggregator_name,
            # Left at the default of 25 this would take many round trips
            "Limit": _CONFIG_PAGE_SIZE,
        }
        if next_token:
            params["NextToken"] = next_token
        response = client.select_aggregate_resource_config(**params)

        for row in response.get("Results") or []:
            record = _loads(row)
            if record is None:
                continue
            tags = [
                Tag(key=tag.get("key", ""), value=str(tag.get("value", "")))
                for tag in record.get("tags") or []
                if tag.get("key")
            ]
            entry = _entry_from_parts(
                arn=record.get("arn", ""),
                account_id=record.get("accountId", ""),
                region=record.get("awsRegion", ""),
                resource_type=record.get("resourceType"),
                name=record.get("resourceName"),
                tags=tags,
                settings=settings,
            )
            if entry:
                yield entry

        next_token = response.get("NextToken")
        if not next_token:
            break


def _loads(row: str | dict[str, Any]) -> dict[str, Any] | None:
    import json

    if isinstance(row, dict):
        return row
    try:
        return json.loads(row)
    except json.JSONDecodeError:
        logger.warning("Could not read the Config result: %.80s", row)
        return None


def _supported_profiles():
    from app.aws.profiles import all_profiles

    return all_profiles()


def build_inventory(
    entries: list[InventoryEntry], source: str, existing: Inventory | None = None
) -> Inventory:
    """Gather the results into an index, carrying over the existing fetched flags."""
    detailed = {e.arn: e for e in existing.entries if e.has_detail} if existing else {}
    merged: dict[str, InventoryEntry] = {}
    for entry in entries:
        previous = detailed.get(entry.arn)
        merged[entry.arn] = (
            entry.model_copy(
                update={
                    "has_detail": True,
                    "lifecycle": previous.lifecycle,
                    "fetched_at": previous.fetched_at,
                }
            )
            if previous
            else entry
        )

    return Inventory(
        generated_at=datetime.now(UTC),
        source=source,  # type: ignore[arg-type]
        entries=sorted(merged.values(), key=lambda e: (e.service, e.name or e.resource_id)),
    )
