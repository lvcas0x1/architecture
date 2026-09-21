#!/usr/bin/env python3
"""Write the JSON Schemas out from the Pydantic models, the single source of truth."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import get_args

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from pydantic import BaseModel, TypeAdapter  # noqa: E402

from app.models import (  # noqa: E402
    Diagram,
    ExportBundle,
    IconCatalog,
    IconScopes,
    Inventory,
    NormalizedResource,
)
from app.models.project import Project, ResourceGraph  # noqa: E402


class _AllModels(BaseModel):
    """Share model definitions for TypeScript and input-schema generation."""

    diagram: Diagram
    resource: NormalizedResource
    inventory: Inventory
    icon_catalog: IconCatalog
    icon_scopes: IconScopes
    export_bundle: ExportBundle
    project: Project
    resource_graph: ResourceGraph


OUT_DIR = REPO_ROOT / "packages" / "schema" / "generated"

TARGETS = {
    "diagram.schema.json": Diagram,
    "resource.schema.json": NormalizedResource,
    "inventory.schema.json": Inventory,
    "icon-catalog.schema.json": IconCatalog,
    "icon-scopes.schema.json": IconScopes,
    "export-bundle.schema.json": ExportBundle,
    "project.schema.json": Project,
    "resource-graph.schema.json": ResourceGraph,
}

BASE_URI = "https://architecture.local/schema"


def strip_property_titles(node: object) -> None:
    """Strip the per-field ``title``, which makes json-schema-to-typescript emit
    aliases like ``Zindex1``. The titles on $defs are kept, so interface names stay.
    """
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            for field_schema in props.values():
                if not isinstance(field_schema, dict):
                    continue
                field_schema.pop("title", None)
                for member in field_schema.get("anyOf") or []:
                    if isinstance(member, dict):
                        member.pop("title", None)
                items = field_schema.get("items")
                if isinstance(items, dict):
                    items.pop("title", None)
        for value in node.values():
            strip_property_titles(value)
    elif isinstance(node, list):
        for item in node:
            strip_property_titles(item)


def export_rules(out_dir: Path) -> Path:
    """Write the placement rules out as JSON."""
    from app.models.diagram import (
        CONNECTABLE_NODE_TYPES,
        CONTAINER_NODE_TYPES,
        GROUP_NESTING,
        GROUP_STYLE_LABELS,
        OVERLAPPABLE_GROUP_STYLES,
        RESOURCE_SCOPE_CONTAINERS,
        TOP_LEVEL_GROUP_STYLES,
    )
    from app.models.resource import (
        ACCOUNT_ID_PATTERN,
        ARN_PATTERN,
        ICON_KEY_PATTERN,
        RELATION_TYPE_PATTERN,
    )

    rules = {
        # The editor checks a file it reads against the same patterns the server uses
        "patterns": {
            "arn": ARN_PATTERN,
            "iconKey": ICON_KEY_PATTERN,
            "relationType": RELATION_TYPE_PATTERN,
            "accountId": ACCOUNT_ID_PATTERN,
        },
        "connectableNodeTypes": sorted(CONNECTABLE_NODE_TYPES),
        "containerNodeTypes": sorted(CONTAINER_NODE_TYPES),
        "topLevelGroupStyles": sorted(TOP_LEVEL_GROUP_STYLES),
        "groupStyleLabels": {k.value: v for k, v in GROUP_STYLE_LABELS.items()},
        "overlappableGroupStyles": sorted(
            sorted(style.value for style in pair) for pair in OVERLAPPABLE_GROUP_STYLES
        ),
        "groupNesting": {
            style.value: sorted(parent.value for parent in parents)
            for style, parents in GROUP_NESTING.items()
        },
        "resourceScopeContainers": {
            scope.value: sorted(style.value for style in styles)
            for scope, styles in RESOURCE_SCOPE_CONTAINERS.items()
        },
    }

    path = out_dir / "rules.json"
    path.write_text(json.dumps(rules, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def export_ai_input_schema(out_dir: Path) -> Path:
    """Export the AI input schema with defaulted fields optional."""
    schema = Diagram.model_json_schema(by_alias=True, mode="validation")
    strip_property_titles(schema)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = f"{BASE_URI}/diagram-ai.schema.json"
    schema["description"] = (
        "Input schema for the AI. Fields with defaults (position / size / "
        "locked / hidden / zIndex and so on) may be omitted."
    )

    path = out_dir / "diagram-ai.schema.json"
    path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def export_input_schema(out_dir: Path) -> Path:
    """Browser validation, including the actual Pydantic default factories."""
    schema = _AllModels.model_json_schema(by_alias=True, mode="validation")
    models: dict[str, type[BaseModel]] = {}

    def discover(annotation: object) -> None:
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            if annotation.__name__ in models:
                return
            models[annotation.__name__] = annotation
            for field in annotation.model_fields.values():
                discover(field.annotation)
        for arg in get_args(annotation):
            discover(arg)

    discover(_AllModels)
    for name, model in models.items():
        definition = schema if model is _AllModels else schema["$defs"][name]
        for name, field in model.model_fields.items():
            if field.is_required():
                continue
            key = field.alias or name
            default = field.get_default(call_default_factory=True)
            definition["properties"][key]["default"] = TypeAdapter(field.annotation).dump_python(
                default, mode="json", by_alias=True
            )
    strip_property_titles(schema)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    path = out_dir / "input.schema.json"
    path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, model in {**TARGETS, "_all.schema.json": _AllModels}.items():
        schema = model.model_json_schema(by_alias=True, mode="serialization")
        strip_property_titles(schema)
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
        schema["$id"] = f"{BASE_URI}/{filename}"
        schema.setdefault("title", model.__name__)
        path = OUT_DIR / filename
        path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  {path.relative_to(REPO_ROOT)}")
    export_input_schema(OUT_DIR)
    ai_path = export_ai_input_schema(OUT_DIR)
    print(f"  {ai_path.relative_to(REPO_ROOT)}")

    rules_path = export_rules(OUT_DIR)
    print(f"  {rules_path.relative_to(REPO_ROOT)}")
    print(f"Wrote {len(TARGETS)} JSON Schemas plus the rules table.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
