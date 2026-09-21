"""Guarantee the samples in workspace/ keep up with the schema."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.models import Diagram, NormalizedResource

WORKSPACE = Path(__file__).resolve().parents[2] / "workspace"
DIAGRAMS = sorted(WORKSPACE.glob("diagrams/*.arch.json"))
RESOURCES = sorted(WORKSPACE.glob("inventory/resources/*.json"))


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.name)
def test_sample_diagram_is_valid(path: Path):
    diagram = Diagram.model_validate_json(path.read_text(encoding="utf-8"))
    assert diagram.nodes, "nodes is empty"
    # Re-serializing gives the same content back (a camelCase round trip)
    assert Diagram.model_validate(diagram.model_dump(mode="json")) == diagram


@pytest.mark.parametrize("path", RESOURCES, ids=lambda p: p.name)
def test_sample_resource_is_valid(path: Path):
    resource = NormalizedResource.model_validate_json(path.read_text(encoding="utf-8"))
    assert resource.sections, "sections is empty"
    assert NormalizedResource.model_validate(resource.model_dump(mode="json")) == resource


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.name)
def test_every_line_connects_two_nodes(path: Path):
    """A line always joins icons, boxes or shapes (no line floats free)."""
    from app.models.diagram import CONNECTABLE_NODE_TYPES

    diagram = Diagram.model_validate_json(path.read_text(encoding="utf-8"))
    by_id = {node.id: node for node in diagram.nodes}

    for edge in diagram.edges:
        for endpoint in (edge.source, edge.target):
            node = by_id.get(endpoint)
            assert node is not None, f"{edge.id}: {endpoint} does not exist"
            assert node.type in CONNECTABLE_NODE_TYPES, (
                f"{edge.id}: {endpoint} is a {node.type} and cannot be an endpoint"
            )


def test_fixture_files_are_formatted():
    """The samples stay formatted with two-space indent, so diffs read well."""
    for path in DIAGRAMS + RESOURCES:
        text = path.read_text(encoding="utf-8")
        expected = json.dumps(json.loads(text), indent=2, ensure_ascii=False) + "\n"
        assert text == expected, f"{path.name} is not formatted"
