"""Diagram checks, shared by the CLI (scripts/validate_diagram.py) and the API."""

from __future__ import annotations

from pathlib import Path

from app.icons import ICON_CATALOG_PATHS, load_icon_catalog
from app.models import Diagram, GroupStyle, ResourceScope
from app.models.diagram import GROUP_STYLE_LABELS, can_place_resource
from app.store import Store


def load_known_icon_keys(paths: tuple[Path, ...] = ICON_CATALOG_PATHS) -> set[str] | None:
    """None when there is no catalog at all (the check is skipped)."""
    catalog = load_icon_catalog(paths)
    return None if catalog is None else {icon.key for icon in catalog.icons}


def load_icon_scopes(store: Store | None = None) -> dict[str, ResourceScope]:
    """Icon key -> attribute. All user-set, so without a store nothing is restricted."""
    catalog = load_icon_catalog()
    if store is None or catalog is None:
        return {}
    return store.read_icon_scopes().effective(catalog)


def validate_diagram(
    diagram: Diagram,
    store: Store | None = None,
    *,
    known_arns: set[str] | None = None,
    known_icon_keys: set[str] | None = None,
    icon_scopes: dict[str, ResourceScope] | None = None,
    check_arns: bool = True,
) -> dict[str, object]:
    """Returns errors (must be fixed) and warnings (better fixed)."""
    errors: list[str] = []
    warnings: list[str] = []

    if check_arns and known_arns is None and store is not None:
        known_arns = {entry.arn for entry in store.read_inventory().entries}
    if known_icon_keys is None:
        known_icon_keys = load_known_icon_keys()
    if icon_scopes is None:
        icon_scopes = load_icon_scopes(store)

    # None means "nothing to check against (not generated)".
    # An empty set means "zero entries", so it is checked.
    if check_arns and known_arns is not None:
        for arn in sorted(diagram.referenced_arns() - known_arns):
            errors.append(f"ARN is not in the inventory: {arn}")

    if known_icon_keys is not None:
        for key in sorted(diagram.referenced_icon_keys() - known_icon_keys):
            errors.append(f"Icon key is not in the catalog: {key}")

    # Resources outside a container (the schema rejects these too; this spells out why)
    containers = {node.id for node in diagram.nodes if node.type in ("group", "shape")}
    stray = [
        node.id
        for node in diagram.nodes
        if node.type == "resource" and node.parent_id not in containers
    ]
    if stray:
        errors.append(
            f"{len(stray)} resource(s) sit outside any box or shape: {', '.join(stray[:10])}"
        )

    # Resources in a place that does not match the icon attribute.
    # Attributes can change later, so a saved diagram can stop matching.
    by_id = {node.id: node for node in diagram.nodes}
    for node in diagram.nodes:
        if node.type != "resource":
            continue
        scope = icon_scopes.get(node.data.icon_key, ResourceScope.ANY)
        if scope is ResourceScope.ANY:
            continue
        parent = by_id.get(node.parent_id or "")
        if parent is None or parent.type != "group":
            continue
        style = GroupStyle(parent.data.style)
        if not can_place_resource(scope, style):
            errors.append(
                f"Placement does not match the icon attribute ({scope.value}): "
                f"{node.id} is inside “{GROUP_STYLE_LABELS[style]}”"
            )

    unlinked = [
        node.id
        for node in diagram.nodes
        if node.type == "resource" and node.data.resource_ref is None
    ]
    if unlinked:
        warnings.append(
            f"{len(unlinked)} resource node(s) have no JSON linked: {', '.join(unlinked[:10])}"
        )

    connected = {edge.source for edge in diagram.edges} | {edge.target for edge in diagram.edges}
    # Sitting outside a box is already an error from the model, so only "no line" is left
    isolated = [
        node.id for node in diagram.nodes if node.type == "resource" and node.id not in connected
    ]
    if isolated:
        warnings.append(f"{len(isolated)} node(s) have no connections: {', '.join(isolated[:10])}")

    # Empty boxes (an AI created one and forgot to fill it)
    has_children = {node.parent_id for node in diagram.nodes if node.parent_id}
    empty_groups = [
        node.id for node in diagram.nodes if node.type == "group" and node.id not in has_children
    ]
    if empty_groups:
        warnings.append(f"{len(empty_groups)} box(es) are empty: {', '.join(empty_groups[:10])}")

    # Several nodes pointing at one resource is sometimes deliberate, but usually a duplicate
    seen: dict[str, list[str]] = {}
    for node in diagram.nodes:
        ref = getattr(node.data, "resource_ref", None)
        if ref:
            seen.setdefault(ref, []).append(node.id)
    for arn, ids in sorted(seen.items()):
        if len(ids) > 1:
            warnings.append(f"{len(ids)} nodes reference the same resource: {arn}")

    return {"ok": not errors, "errors": errors, "warnings": warnings}
