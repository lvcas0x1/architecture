from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import AwareDatetime, Field, model_validator

from .common import CamelModel
from .diagram import Diagram
from .resource import Arn, NormalizedResource


class Evidence(CamelModel):
    source: Literal["config", "resource-explorer", "describe", "human", "inferred"]
    observed_at: AwareDatetime
    locator: str


class GraphResource(CamelModel):
    arn: Arn
    account_id: str
    region: str
    resource_type: str
    resource_id: str
    name: str = ""
    icon_key: str = "Resource/General-Icons/Generic-Application"
    availability_zones: list[str] = Field(default_factory=list)
    vpc_ids: list[str] = Field(default_factory=list)
    subnet_ids: list[str] = Field(default_factory=list)
    tags: dict[str, str] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    subnet_visibility: Literal["public", "private", "unknown"] = "unknown"
    evidence: list[Evidence] = Field(default_factory=list)
    detail: NormalizedResource | None = None


class GraphRelation(CamelModel):
    source_arn: Arn
    target_arn: Arn
    type: str
    category: Literal["containment", "association", "permission", "traffic", "inferred"]
    evidence: list[Evidence] = Field(default_factory=list)


class Coverage(CamelModel):
    source: str
    profile: str
    account_id: str = ""
    region: str = ""
    status: Literal["complete", "partial", "error", "unsupported"]
    message: str = ""
    count: int = 0


class ResourceGraph(CamelModel):
    format: Literal["architecture-inventory"] = "architecture-inventory"
    version: Literal[1] = 1
    collected_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    resources: list[GraphResource] = Field(default_factory=list)
    relations: list[GraphRelation] = Field(default_factory=list)
    coverage: list[Coverage] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_resources(self):
        if len({r.arn for r in self.resources}) != len(self.resources):
            raise ValueError("Duplicate resource ARN")
        return self


class HumanAuthority(CamelModel):
    baseline: Diagram
    protected: dict[str, list[str]] = Field(default_factory=dict)
    deleted_nodes: list[str] = Field(default_factory=list)
    deleted_edges: list[str] = Field(default_factory=list)
    deleted_refs: list[str] = Field(default_factory=list)
    deleted_connections: list[str] = Field(default_factory=list)


class Project(CamelModel):
    format: Literal["architecture-project"] = "architecture-project"
    version: Literal[1] = 1
    revision: int = Field(default=0, ge=0)
    graph: ResourceGraph = Field(default_factory=ResourceGraph)
    diagram: Diagram
    authority: HumanAuthority
    view: Literal["overview", "network", "application", "security"] = "overview"
    selected_arns: list[str] = Field(default_factory=list)


class Finding(CamelModel):
    code: str
    severity: Literal["error", "warning"]
    node_id: str | None = None
    message: str
    expected: Any = None


class QualityReport(CamelModel):
    ok: bool
    findings: list[Finding]
    metrics: dict[str, float | int]
