"""Tests for the diagram schema validator (the checker for AI output)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import Diagram

EC2_ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc123"
RDS_ARN = "arn:aws:rds:ap-northeast-1:123456789012:db:rds-ap1"

#: A resource only goes inside a container, so tests put it in this box by default.
BOX_ID = "g-box"


def box(nid: str = BOX_ID, **kw):
    return {
        "id": nid,
        "type": "group",
        "position": {"x": 0, "y": 0},
        "data": {"label": "box"},
        **kw,
    }


def shape(nid: str, **kw):
    return {
        "id": nid,
        "type": "shape",
        "position": {"x": 0, "y": 0},
        "data": {"shape": "rect"},
        **kw,
    }


def node(nid: str, ntype: str = "resource", **kw):
    base = {"id": nid, "type": ntype, "position": {"x": 0, "y": 0}}
    if ntype == "resource":
        base["data"] = {"iconKey": "Architecture/Compute/Amazon-EC2"}
        base["parentId"] = BOX_ID
    base.update(kw)
    return base


def edge(eid: str, src: str, tgt: str, **data):
    return {"id": eid, "source": src, "target": tgt, "data": dict(data)}


def test_minimal_diagram_roundtrips():
    doc = Diagram.model_validate(
        {
            "nodes": [box(), node("n1"), node("n2")],
            "edges": [edge("e1", "n1", "n2", arrow="both", line="dashed")],
        }
    )
    dumped = doc.model_dump(mode="json")
    assert dumped["edges"][0]["data"]["arrow"] == "both"
    # Comes out in camelCase (the same shape the editor and the AI use)
    assert "schemaVersion" in dumped
    assert Diagram.model_validate(dumped) == doc


class TestLines:
    """A line always joins connection points on icons, boxes or shapes."""

    def test_text_cannot_be_an_endpoint(self):
        with pytest.raises(ValidationError, match="must be a resource icon, a box or a shape"):
            Diagram.model_validate(
                {
                    "nodes": [
                        box(),
                        node("n1"),
                        node("t1", "text", data={"text": "note"}),
                    ],
                    "edges": [edge("e1", "n1", "t1")],
                }
            )

    @pytest.mark.parametrize(
        ("kind", "data"),
        [
            ("resource", {"iconKey": "Architecture/Compute/Amazon-EC2"}),
            ("group", {"label": "vpc"}),
            ("shape", {"shape": "rect"}),
        ],
    )
    def test_connectable_node_types(self, kind: str, data: dict):
        extra = {"parentId": BOX_ID} if kind == "resource" else {}
        doc = Diagram.model_validate(
            {
                "nodes": [
                    box(),
                    node("n1"),
                    {"id": "x1", "type": kind, "position": {"x": 0, "y": 0}, "data": data, **extra},
                ],
                "edges": [edge("e1", "n1", "x1")],
            }
        )
        assert len(doc.edges) == 1

    def test_free_floating_lines_are_impossible(self):
        """The endpoint-less node type (anchor) was removed from the schema."""
        with pytest.raises(ValidationError):
            Diagram.model_validate({"nodes": [node("a1", "anchor", data={})], "edges": []})

    def test_dangling_edge_endpoint_is_detected(self):
        with pytest.raises(ValidationError, match="target node n9 does not exist"):
            Diagram.model_validate(
                {"nodes": [box(), node("n1")], "edges": [edge("e1", "n1", "n9")]}
            )

    def test_self_loop_is_rejected(self):
        with pytest.raises(ValidationError, match="self-loops"):
            Diagram.model_validate(
                {"nodes": [box(), node("n1")], "edges": [edge("e1", "n1", "n1")]}
            )


class TestPlacement:
    """An AWS resource always sits inside a box or a shape."""

    def test_resource_without_parent_is_rejected(self):
        with pytest.raises(ValidationError, match="must sit inside a box or a shape"):
            Diagram.model_validate({"nodes": [node("n1", parentId=None)], "edges": []})

    @pytest.mark.parametrize(
        ("container", "data"),
        [("group", {"label": "vpc"}), ("shape", {"shape": "rect"})],
    )
    def test_box_and_shape_can_hold_resources(self, container: str, data: dict):
        doc = Diagram.model_validate(
            {
                "nodes": [
                    {"id": "c1", "type": container, "position": {"x": 0, "y": 0}, "data": data},
                    node("n1", parentId="c1"),
                ],
                "edges": [],
            }
        )
        assert len(doc.nodes) == 2

    def test_parent_must_be_a_container(self):
        with pytest.raises(ValidationError, match="only boxes and shapes can be parents"):
            Diagram.model_validate(
                {
                    "nodes": [
                        box(),
                        node("n1"),
                        node("t1", "text", data={"text": "x"}, parentId="n1"),
                    ],
                    "edges": [],
                }
            )

    def test_parent_cycle_is_detected(self):
        with pytest.raises(ValidationError, match="cycle"):
            Diagram.model_validate(
                {
                    "nodes": [
                        node("g1", "group", parentId="g2", data={"label": "a"}),
                        node("g2", "group", parentId="g1", data={"label": "b"}),
                    ],
                    "edges": [],
                }
            )


class TestBorderMount:
    """Straddling a shape's border."""

    def test_accepted_on_a_shape(self):
        doc = Diagram.model_validate(
            {
                "nodes": [
                    shape("s1"),
                    node(
                        "n1",
                        parentId="s1",
                        data={
                            "iconKey": "Architecture/Compute/Amazon-EC2",
                            "mount": "border",
                            "borderSide": "left",
                        },
                    ),
                ],
                "edges": [],
            }
        )
        assert doc.nodes[1].data.mount == "border"
        assert doc.nodes[1].data.border_side == "left"

    def test_a_box_border_works_too(self):
        """An internet gateway on the VPC boundary is a staple of AWS diagrams."""
        diagram = Diagram.model_validate(
            {
                "nodes": [
                    box(),
                    node(
                        "n1",
                        data={
                            "iconKey": "Architecture/Compute/Amazon-EC2",
                            "mount": "border",
                            "borderSide": "left",
                        },
                    ),
                ],
                "edges": [],
            }
        )
        assert diagram.nodes[1].data.mount.value == "border"

    def test_only_containers_have_borders(self):
        with pytest.raises(ValidationError, match="only boxes and shapes"):
            Diagram.model_validate(
                {
                    "nodes": [
                        {
                            "id": "t1",
                            "type": "text",
                            "position": {"x": 0, "y": 0},
                            "data": {"text": "note"},
                        },
                        node(
                            "n1",
                            parentId="t1",
                            data={
                                "iconKey": "Architecture/Compute/Amazon-EC2",
                                "mount": "border",
                                "borderSide": "left",
                            },
                        ),
                    ],
                    "edges": [],
                }
            )

    def test_requires_a_side(self):
        with pytest.raises(ValidationError, match="requires borderSide"):
            Diagram.model_validate(
                {
                    "nodes": [
                        shape("s1"),
                        node(
                            "n1",
                            parentId="s1",
                            data={"iconKey": "Architecture/Compute/Amazon-EC2", "mount": "border"},
                        ),
                    ],
                    "edges": [],
                }
            )

    def test_inside_mount_rejects_a_side(self):
        with pytest.raises(ValidationError, match="cannot have borderSide"):
            Diagram.model_validate(
                {
                    "nodes": [
                        box(),
                        node(
                            "n1",
                            data={
                                "iconKey": "Architecture/Compute/Amazon-EC2",
                                "borderSide": "left",
                            },
                        ),
                    ],
                    "edges": [],
                }
            )

    def test_defaults_to_inside(self):
        doc = Diagram.model_validate({"nodes": [box(), node("n1")], "edges": []})
        assert doc.nodes[1].data.mount == "inside"
        assert doc.nodes[1].data.border_side is None


def test_auto_layout_allows_missing_positions():
    """An AI's first output has no coordinates. ELK fills them in later."""
    doc = Diagram.model_validate(
        {
            "layout": {"mode": "auto"},
            "nodes": [
                {"id": BOX_ID, "type": "group", "data": {"label": "vpc", "origin": "ai"}},
                {
                    "id": "n1",
                    "type": "resource",
                    "parentId": BOX_ID,
                    "data": {
                        "iconKey": "Architecture/Compute/Amazon-EC2",
                        "resourceRef": EC2_ARN,
                        "origin": "ai",
                    },
                },
                {
                    "id": "n2",
                    "type": "resource",
                    "parentId": BOX_ID,
                    "data": {
                        "iconKey": "Architecture/Databases/Amazon-RDS",
                        "resourceRef": RDS_ARN,
                        "origin": "ai",
                    },
                },
            ],
            "edges": [edge("e1", "n1", "n2", relationType="connects-to")],
        }
    )
    assert all(n.position is None for n in doc.nodes)
    assert doc.referenced_arns() == {EC2_ARN, RDS_ARN}


def test_manual_layout_requires_positions():
    with pytest.raises(ValidationError, match="requires a position"):
        Diagram.model_validate(
            {
                "layout": {"mode": "manual"},
                "nodes": [
                    {
                        "id": BOX_ID,
                        "type": "group",
                        "position": {"x": 0, "y": 0},
                        "data": {"label": "b"},
                    },
                    {
                        "id": "n1",
                        "type": "resource",
                        "parentId": BOX_ID,
                        "data": {"iconKey": "Architecture/Compute/Amazon-EC2"},
                    },
                ],
                "edges": [],
            }
        )


def test_bad_arn_is_rejected():
    with pytest.raises(ValidationError):
        Diagram.model_validate(
            {
                "nodes": [
                    box(),
                    node(
                        "n1",
                        data={
                            "iconKey": "Architecture/Compute/Amazon-EC2",
                            "resourceRef": "i-0abc123",
                        },
                    ),
                ],
                "edges": [],
            }
        )


def test_zoom_bounds_match_ui_slider():
    Diagram.model_validate({"viewport": {"zoom": 0.1}})
    Diagram.model_validate({"viewport": {"zoom": 2.0}})
    with pytest.raises(ValidationError):
        Diagram.model_validate({"viewport": {"zoom": 2.5}})


def test_unknown_field_is_rejected():
    """Catch an AI that invented a key."""
    with pytest.raises(ValidationError):
        Diagram.model_validate({"nodes": [box(), node("n1", colour="red")], "edges": []})


def test_duplicate_ids_are_rejected():
    with pytest.raises(ValidationError, match="Duplicate node id"):
        Diagram.model_validate({"nodes": [box(), node("n1"), node("n1")], "edges": []})


def test_referenced_icon_keys_for_export():
    doc = Diagram.model_validate(
        {
            "nodes": [
                box(),
                node("n1"),
                # Inside a generic box the style rules do not apply
                node(
                    "g1",
                    "group",
                    parentId=BOX_ID,
                    data={"label": "vpc", "style": "vpc", "iconKey": "Group/VPC"},
                ),
            ],
            "edges": [],
        }
    )
    assert doc.referenced_icon_keys() == {"Architecture/Compute/Amazon-EC2", "Group/VPC"}


class TestGroupNesting:
    """Each box style has its own allowed parents."""

    def styled(self, nid: str, style: str, parent: str | None = None):
        node = {
            "id": nid,
            "type": "group",
            "position": {"x": 0, "y": 0},
            "data": {"label": nid, "style": style},
        }
        if parent:
            node["parentId"] = parent
        return node

    def build(self, *nodes):
        return Diagram.model_validate({"nodes": list(nodes), "edges": []})

    def test_full_hierarchy_is_accepted(self):
        doc = self.build(
            self.styled("g", "global"),
            self.styled("a", "account", "g"),
            self.styled("r", "region", "a"),
            self.styled("v", "vpc", "r"),
            self.styled("z", "az", "v"),
            self.styled("s", "subnet-private", "z"),
            self.styled("sg", "security-group", "s"),
        )
        assert len(doc.nodes) == 7

    @pytest.mark.parametrize(
        "style", ["account", "region", "vpc", "az", "subnet-public", "security-group"]
    )
    def test_only_global_and_on_premises_and_generic_at_top(self, style: str):
        with pytest.raises(ValidationError, match="cannot sit directly on the canvas"):
            self.build(self.styled("x", style))

    @pytest.mark.parametrize("style", ["global", "on-premises", "generic"])
    def test_top_level_styles(self, style: str):
        assert len(self.build(self.styled("x", style)).nodes) == 1

    def test_region_cannot_go_inside_vpc(self):
        with pytest.raises(ValidationError, match="cannot go inside"):
            self.build(
                self.styled("g", "global"),
                self.styled("r", "region", "g"),
                self.styled("v", "vpc", "r"),
                self.styled("r2", "region", "v"),
            )

    def test_global_cannot_be_nested(self):
        with pytest.raises(ValidationError, match="cannot go inside"):
            self.build(
                self.styled("g", "global"),
                self.styled("g2", "global", "g"),
            )

    def test_generic_is_an_escape_hatch(self):
        doc = self.build(
            self.styled("x", "generic"),
            # Inside a generic box a level can be skipped
            self.styled("s", "subnet-private", "x"),
        )
        assert len(doc.nodes) == 2

    def test_common_shorthand_is_allowed(self):
        """Skipping the AZ and putting a subnet straight in a VPC is common in practice."""
        doc = self.build(
            self.styled("g", "global"),
            self.styled("r", "region", "g"),
            self.styled("v", "vpc", "r"),
            self.styled("s", "subnet-public", "v"),
        )
        assert len(doc.nodes) == 4

    def test_error_message_names_the_allowed_parents(self):
        with pytest.raises(ValidationError) as excinfo:
            self.build(self.styled("v", "vpc"))
        message = str(excinfo.value)
        # Style names are the official AWS group names
        assert "VPC" in message
        assert "Region" in message
        assert "cannot sit directly on the canvas" in message
