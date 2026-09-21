"""Schema for the diagram file ``*.arch.json``."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import Field, model_validator

from .common import SCHEMA_VERSION, CamelModel
from .resource import Arn, IconKey

NODE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_\-:.]{0,127}$"
NodeId = Annotated[str, Field(pattern=NODE_ID_PATTERN)]
COLOR_PATTERN = r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
Color = Annotated[str, Field(pattern=COLOR_PATTERN)]
#: Fill opacity, 10%-90% in steps of 0.1. None means the preset default.
FillOpacity = Annotated[float, Field(ge=0.1, le=0.9)]


class Origin(StrEnum):
    """Element authorship."""

    AI = "ai"
    USER = "user"


class Position(CamelModel):
    x: float
    y: float


class Size(CamelModel):
    width: Annotated[float, Field(gt=0)]
    height: Annotated[float, Field(gt=0)]


ResourceField = Literal["service", "name", "resourceId", "tags"]


class ResourceMount(StrEnum):
    """How a resource icon sits in its container."""

    #: Inside the container (box or shape).
    INSIDE = "inside"
    #: Straddling the container's border, with the icon centred on the line.
    BORDER = "border"


class BorderSide(StrEnum):
    TOP = "top"
    RIGHT = "right"
    BOTTOM = "bottom"
    LEFT = "left"


class ResourceNodeData(CamelModel):
    """An AWS resource icon."""

    icon_key: IconKey
    #: Reference to the normalized resource JSON. None means "icon placed but not linked".
    resource_ref: Arn | None = None
    #: Only when the second label line should be overridden by hand.
    #: Normally None (the resource name is used).
    label_override: str | None = None
    #: Which label lines to show under the icon, and in what order.
    show_fields: list[ResourceField] = Field(
        default_factory=lambda: ["service", "name", "resourceId", "tags"]
    )
    #: How many tags to show. The rest collapse into "+N" and appear on hover.
    max_tags: Annotated[int, Field(ge=0, le=20)] = 3
    #: Inside the container or on its border.
    mount: ResourceMount = ResourceMount.INSIDE
    #: Which side it straddles, when mount=border.
    border_side: BorderSide | None = None
    origin: Origin = Origin.USER


class GroupStyle(StrEnum):
    """Box presets. Border colour, corner label and pale fill follow the AWS diagram conventions."""

    #: The outermost frame. Represents the whole AWS Cloud.
    GLOBAL = "global"
    #: Outside AWS (an on-premises data centre, for example).
    ON_PREMISES = "on-premises"
    ACCOUNT = "account"
    REGION = "region"
    VPC = "vpc"
    AZ = "az"
    SUBNET_PUBLIC = "subnet-public"
    SUBNET_PRIVATE = "subnet-private"
    SECURITY_GROUP = "security-group"
    AUTO_SCALING_GROUP = "auto-scaling-group"
    #: The unconstrained escape hatch. Goes anywhere and holds anything.
    GENERIC = "generic"


#: Display names for boxes. They appear in the diagram, so they match the names of
#: the official AWS group icons. Shared by the picker, errors and new box titles.
GROUP_STYLE_LABELS: dict[GroupStyle, str] = {
    GroupStyle.GLOBAL: "AWS Cloud",
    GroupStyle.ON_PREMISES: "On-premises",
    GroupStyle.ACCOUNT: "AWS Account",
    GroupStyle.REGION: "Region",
    GroupStyle.VPC: "VPC",
    GroupStyle.AZ: "Availability Zone",
    GroupStyle.SUBNET_PUBLIC: "Public subnet",
    GroupStyle.SUBNET_PRIVATE: "Private subnet",
    GroupStyle.SECURITY_GROUP: "Security group",
    GroupStyle.AUTO_SCALING_GROUP: "Auto Scaling group",
    GroupStyle.GENERIC: "Generic group",
}

#: Boxes that may sit directly on the canvas. Everything else stacks inside Global;
#: on-premises is outside AWS, and the generic box is the escape hatch.
TOP_LEVEL_GROUP_STYLES = frozenset({GroupStyle.GLOBAL, GroupStyle.ON_PREMISES, GroupStyle.GENERIC})

_SUBNETS = frozenset({GroupStyle.SUBNET_PUBLIC, GroupStyle.SUBNET_PRIVATE})

#: Allowed parent styles.
GROUP_NESTING: dict[GroupStyle, frozenset[GroupStyle]] = {
    GroupStyle.GLOBAL: frozenset(),
    GroupStyle.ON_PREMISES: frozenset(),
    GroupStyle.ACCOUNT: frozenset({GroupStyle.GLOBAL}),
    GroupStyle.REGION: frozenset({GroupStyle.GLOBAL, GroupStyle.ACCOUNT}),
    GroupStyle.VPC: frozenset({GroupStyle.REGION}),
    GroupStyle.AZ: frozenset({GroupStyle.VPC, GroupStyle.REGION}),
    GroupStyle.SUBNET_PUBLIC: frozenset({GroupStyle.AZ, GroupStyle.VPC}),
    GroupStyle.SUBNET_PRIVATE: frozenset({GroupStyle.AZ, GroupStyle.VPC}),
    GroupStyle.SECURITY_GROUP: _SUBNETS | {GroupStyle.AZ, GroupStyle.VPC},
    GroupStyle.AUTO_SCALING_GROUP: _SUBNETS | {GroupStyle.AZ, GroupStyle.VPC},
    GroupStyle.GENERIC: frozenset(),
}


#: Pairs of box styles that may overlap. Neither a VPC nor an AZ is outside the
#: other - only a subnet belongs to both - so they are drawn as crossing bands.
OVERLAPPABLE_GROUP_STYLES: frozenset[frozenset[GroupStyle]] = frozenset(
    {frozenset({GroupStyle.VPC, GroupStyle.AZ})}
)


def can_overlap_groups(a: GroupStyle, b: GroupStyle) -> bool:
    """Whether two boxes with the same parent may overlap."""
    return frozenset({a, b}) in OVERLAPPABLE_GROUP_STYLES


def can_nest_group(child: GroupStyle, parent: GroupStyle | None) -> bool:
    """Whether ``child`` may sit inside ``parent``. parent=None is the bare canvas."""
    # The generic box is the escape hatch, on either side
    if child is GroupStyle.GENERIC or parent is GroupStyle.GENERIC:
        return True
    if parent is None:
        return child in TOP_LEVEL_GROUP_STYLES
    return parent in GROUP_NESTING[child]


class ResourceScope(StrEnum):
    """The layer an AWS resource belongs to."""

    #: One per account. IAM, Organizations, Route 53 and so on.
    GLOBAL = "global"
    #: Per region. S3, DynamoDB, SQS and so on.
    REGION = "region"
    #: Per VPC. Internet gateways, VPC endpoints and so on.
    VPC = "vpc"
    #: Per AZ. EC2, NAT gateways, RDS instances and so on.
    ZONE = "zone"
    #: Per subnet. Things that are meant to live inside a subnet.
    SUBNET = "subnet"
    #: Unclassified. Goes anywhere.
    ANY = "any"


#: For each scope, the box styles it may be placed in. The condition the scope
#: requires must hold, so further in is allowed (S3 inside a VPC is common).
RESOURCE_SCOPE_CONTAINERS: dict[ResourceScope, frozenset[GroupStyle]] = {
    ResourceScope.GLOBAL: frozenset({GroupStyle.GLOBAL, GroupStyle.ACCOUNT}),
    ResourceScope.REGION: frozenset(
        {GroupStyle.REGION, GroupStyle.VPC, GroupStyle.AZ}
        | _SUBNETS
        | {GroupStyle.SECURITY_GROUP, GroupStyle.AUTO_SCALING_GROUP}
    ),
    ResourceScope.VPC: frozenset(
        {GroupStyle.VPC, GroupStyle.AZ}
        | _SUBNETS
        | {GroupStyle.SECURITY_GROUP, GroupStyle.AUTO_SCALING_GROUP}
    ),
    ResourceScope.ZONE: frozenset(
        {GroupStyle.AZ} | _SUBNETS | {GroupStyle.SECURITY_GROUP, GroupStyle.AUTO_SCALING_GROUP}
    ),
    ResourceScope.SUBNET: frozenset(
        _SUBNETS | {GroupStyle.SECURITY_GROUP, GroupStyle.AUTO_SCALING_GROUP}
    ),
    ResourceScope.ANY: frozenset(GroupStyle),
}


def can_place_resource(scope: ResourceScope, container_style: GroupStyle | None) -> bool:
    """Check allowed containers; None means an unrestricted shape."""
    if scope is ResourceScope.ANY or container_style is None:
        return True
    if container_style is GroupStyle.GENERIC:
        return True
    return container_style in RESOURCE_SCOPE_CONTAINERS[scope]


class GroupNodeData(CamelModel):
    """A box (VPC / AZ / subnet / any frame)."""

    label: str = ""
    #: Colour of the title. None uses the preset colour (purple for a VPC, and so on).
    label_color: Color | None = None
    #: Fill colour. None uses the preset colour.
    fill_color: Color | None = None
    #: Fill opacity. None uses the preset default.
    fill_opacity: FillOpacity | None = None
    style: GroupStyle = GroupStyle.GENERIC
    #: Reference, when the box itself stands for a real resource (a VPC, a subnet).
    resource_ref: Arn | None = None
    icon_key: IconKey | None = None
    collapsed: bool = False
    origin: Origin = Origin.USER


class TextAlign(StrEnum):
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class TextNodeData(CamelModel):
    """A free-floating text box."""

    text: str = ""
    font_size: Annotated[int, Field(ge=6, le=96)] = 14
    bold: bool = False
    italic: bool = False
    color: Color | None = None
    align: TextAlign = TextAlign.LEFT
    origin: Origin = Origin.USER


class ShapeKind(StrEnum):
    RECT = "rect"
    ROUNDED = "rounded"
    ELLIPSE = "ellipse"
    DIAMOND = "diamond"


class ShapeNodeData(CamelModel):
    """A decorative shape (rectangle, square, ellipse, diamond)."""

    shape: ShapeKind = ShapeKind.RECT
    #: Fill colour. None means the default (the same as the generic box preset).
    fill_color: Color | None = None
    #: Fill opacity. None means the default.
    fill_opacity: FillOpacity | None = None
    stroke: Color | None = None
    origin: Origin = Origin.USER


class _NodeBase(CamelModel):
    id: NodeId
    #: May be omitted only when layout.mode="auto" (AI output omits it).
    position: Position | None = None
    size: Size | None = None
    #: Id of the parent group node. Maps to React Flow's parentId + extent:'parent'.
    parent_id: NodeId | None = None
    z_index: int = 0
    locked: bool = False
    hidden: bool = False


class ResourceNode(_NodeBase):
    type: Literal["resource"] = "resource"
    data: ResourceNodeData


class GroupNode(_NodeBase):
    type: Literal["group"] = "group"
    data: GroupNodeData = Field(default_factory=GroupNodeData)


class TextNode(_NodeBase):
    type: Literal["text"] = "text"
    data: TextNodeData = Field(default_factory=TextNodeData)


class ShapeNode(_NodeBase):
    type: Literal["shape"] = "shape"
    data: ShapeNodeData = Field(default_factory=ShapeNodeData)


Node = Annotated[
    ResourceNode | GroupNode | TextNode | ShapeNode,
    Field(discriminator="type"),
]

#: Valid edge endpoint types.
CONNECTABLE_NODE_TYPES = frozenset({"resource", "group", "shape"})

#: Valid parent types.
CONTAINER_NODE_TYPES = frozenset({"group", "shape"})


class LineStyle(StrEnum):
    SOLID = "solid"
    DASHED = "dashed"
    DOTTED = "dotted"


class ArrowStyle(StrEnum):
    NONE = "none"
    START = "start"
    END = "end"
    BOTH = "both"


class EdgeRouter(StrEnum):
    STRAIGHT = "straight"
    SMOOTHSTEP = "smoothstep"
    STEP = "step"
    BEZIER = "bezier"


class EdgeData(CamelModel):
    line: LineStyle = LineStyle.SOLID
    arrow: ArrowStyle = ArrowStyle.END
    router: EdgeRouter = EdgeRouter.SMOOTHSTEP
    label: str | None = None
    color: Color | None = None
    width: Annotated[float, Field(gt=0, le=12)] = 1.5
    #: Which entry in relations this came from (the AI's justification).
    relation_type: str | None = None
    origin: Origin = Origin.USER


class Edge(CamelModel):
    id: NodeId
    source: NodeId
    target: NodeId
    #: React Flow handle id ("top" / "right" / "bottom" / "left").
    source_handle: str | None = None
    target_handle: str | None = None
    data: EdgeData = Field(default_factory=EdgeData)


class LayoutMode(StrEnum):
    #: Coordinates are settled. This is the mode once the user has adjusted them.
    MANUAL = "manual"
    #: ELK lays the diagram out on load. This is what the AI produces.
    AUTO = "auto"


class LayoutOptions(CamelModel):
    mode: LayoutMode = LayoutMode.MANUAL
    #: elkjs algorithm. The default is layered, which handles nested subgraphs.
    algorithm: Literal["layered", "mrtree", "force", "rectpacking"] = "layered"
    direction: Literal["RIGHT", "DOWN", "LEFT", "UP"] = "RIGHT"
    node_spacing: Annotated[float, Field(gt=0)] = 48
    layer_spacing: Annotated[float, Field(gt=0)] = 96
    padding: Annotated[float, Field(ge=0)] = 32


class Viewport(CamelModel):
    x: float = 0
    y: float = 0
    #: Zoom factor. Matches the UI slider: 0.1 at the bottom, 1.0 in the middle, 2.0 at the top.
    zoom: Annotated[float, Field(ge=0.1, le=2.0)] = 1.0


class DiagramMeta(CamelModel):
    title: str = "Untitled architecture"
    description: str | None = None
    generator: Literal["user", "ai", "mixed"] = "user"
    created_at: datetime | None = None
    updated_at: datetime | None = None
    #: Accounts and regions this diagram covers. Carried through save and export;
    #: nothing filters on them yet.
    account_ids: list[str] = Field(default_factory=list)
    regions: list[str] = Field(default_factory=list)


class Diagram(CamelModel):
    """Root of ``workspace/diagrams/*.arch.json``."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    meta: DiagramMeta = Field(default_factory=DiagramMeta)
    viewport: Viewport = Field(default_factory=Viewport)
    layout: LayoutOptions = Field(default_factory=LayoutOptions)
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)

    # -- Consistency checks (the heart of the validator for AI output) ---

    @model_validator(mode="after")
    def _validate_graph(self) -> Diagram:
        errors: list[str] = []
        by_id: dict[str, Node] = {}

        for node in self.nodes:
            if node.id in by_id:
                errors.append(f"Duplicate node id: {node.id}")
            by_id[node.id] = node

        seen_edge_ids: set[str] = set()
        for edge in self.edges:
            if edge.id in seen_edge_ids:
                errors.append(f"Duplicate edge id: {edge.id}")
            seen_edge_ids.add(edge.id)

        # Parent / child
        for node in self.nodes:
            if node.parent_id is None:
                continue
            parent = by_id.get(node.parent_id)
            if parent is None:
                errors.append(f"{node.id}: parent node {node.parent_id} does not exist")
            elif parent.type not in CONTAINER_NODE_TYPES:
                errors.append(
                    f"{node.id}: parent {node.parent_id} has type={parent.type} "
                    "(only boxes and shapes can be parents)"
                )
            elif node.type == "group" and parent.type != "group":
                # Only a box can be the parent of a box. The editor agrees.
                errors.append(
                    f"{node.id}: a box can only sit inside another box "
                    f"(parent {parent.id} is {parent.type})"
                )
            elif parent.id == node.id:
                errors.append(f"{node.id}: node is its own parent")

        # Box nesting rules
        for node in self.nodes:
            if node.type != "group":
                continue
            parent = by_id.get(node.parent_id) if node.parent_id else None
            parent_style = (
                parent.data.style if parent is not None and parent.type == "group" else None
            )
            # A box inside a shape is unconstrained (a shape has no style)
            if parent is not None and parent.type == "shape":
                continue
            if can_nest_group(node.data.style, parent_style):
                continue

            child_label = GROUP_STYLE_LABELS[node.data.style]
            if parent_style is None:
                allowed = ", ".join(
                    GROUP_STYLE_LABELS[s] for s in sorted(GROUP_NESTING[node.data.style])
                )
                errors.append(
                    f"{node.id}: “{child_label}” cannot sit directly on the canvas "
                    f"(put it inside {allowed})"
                )
            else:
                errors.append(
                    f"{node.id}: “{child_label}” cannot go inside "
                    f"“{GROUP_STYLE_LABELS[parent_style]}”"
                )

        # A resource always sits inside a container
        for node in self.nodes:
            if node.type != "resource":
                continue
            if node.parent_id is None:
                errors.append(
                    f"{node.id}: AWS resources must sit inside a box or a shape "
                    "(never directly on the canvas)"
                )
                continue

            parent = by_id.get(node.parent_id)
            if node.data.mount is ResourceMount.BORDER:
                # Border resources require a container parent.
                if parent is not None and parent.type not in CONTAINER_NODE_TYPES:
                    errors.append(
                        f"{node.id}: only boxes and shapes can have a resource on their "
                        f"border (parent {parent.id} is {parent.type})"
                    )
                if node.data.border_side is None:
                    errors.append(f"{node.id}: mount=border requires borderSide")
            elif node.data.border_side is not None:
                errors.append(f"{node.id}: mount=inside cannot have borderSide")

        errors.extend(self._detect_parent_cycles(by_id))

        # Edge endpoints
        for edge in self.edges:
            src, tgt = by_id.get(edge.source), by_id.get(edge.target)
            if src is None:
                errors.append(f"{edge.id}: source node {edge.source} does not exist")
            if tgt is None:
                errors.append(f"{edge.id}: target node {edge.target} does not exist")
            if src is None or tgt is None:
                continue
            if edge.source == edge.target:
                errors.append(f"{edge.id}: self-loops are not allowed")
            # A line always joins connection points. It cannot float free.
            for role, node in (("source", src), ("target", tgt)):
                if node.type not in CONNECTABLE_NODE_TYPES:
                    errors.append(
                        f"{edge.id}: the {role} of a line must be a resource icon, "
                        f"a box or a shape ({node.id} is {node.type})"
                    )

        # manual requires coordinates
        if self.layout.mode is LayoutMode.MANUAL:
            missing = [n.id for n in self.nodes if n.position is None]
            if missing:
                errors.append(
                    "layout.mode=manual requires a position on every node: "
                    f"{missing[:10]}{' …' if len(missing) > 10 else ''}"
                )

        if errors:
            raise ValueError("\n".join(f"- {e}" for e in errors))
        return self

    @staticmethod
    def _detect_parent_cycles(by_id: dict[str, Node]) -> list[str]:
        errors: list[str] = []
        for start in by_id:
            seen: set[str] = set()
            cursor: str | None = start
            while cursor is not None:
                if cursor in seen:
                    errors.append(f"{start}: parent chain forms a cycle")
                    break
                seen.add(cursor)
                node = by_id.get(cursor)
                cursor = node.parent_id if node else None
        return errors

    # -- Reference helpers ----------------------------------------------

    def referenced_arns(self) -> set[str]:
        """Every ARN the diagram references (the scope of a refresh or an HTML export)."""
        arns: set[str] = set()
        for node in self.nodes:
            ref = getattr(node.data, "resource_ref", None)
            if ref:
                arns.add(ref)
        return arns

    def referenced_icon_keys(self) -> set[str]:
        """Icon keys the diagram uses (only these are inlined as data URIs on export)."""
        keys: set[str] = set()
        for node in self.nodes:
            key = getattr(node.data, "icon_key", None)
            if key:
                keys.add(key)
        return keys
