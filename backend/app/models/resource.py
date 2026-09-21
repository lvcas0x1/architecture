"""Schema for the normalized resource JSON."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator

from .common import SCHEMA_VERSION, CamelModel, Tag

# ARN format. The shortest valid AWS ARN has six or more separators.
ARN_PATTERN = r"^arn:[a-z0-9\-]*:[a-z0-9\-]*:[a-z0-9\-]*:[0-9]{0,12}:.+$"
ACCOUNT_ID_PATTERN = r"^[0-9]{12}$"
Arn = Annotated[
    str,
    Field(pattern=ARN_PATTERN, description="Resource ARN (the key a diagram references)"),
]

# Logical keys survive size/theme changes; service renames require key updates.
ICON_KEY_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9\-]*(/[A-Za-z0-9][A-Za-z0-9\-\.]*)+$"
IconKey = Annotated[
    str,
    Field(pattern=ICON_KEY_PATTERN, examples=["Architecture/Compute/Amazon-EC2"]),
]

RELATION_TYPE_PATTERN = r"^[a-z][a-z0-9\-]*$"


class Lifecycle(StrEnum):
    """Whether the resource still exists. Updated by ``Refresh``."""

    ACTIVE = "active"
    #: Describe returned a NotFound-style error, so the resource is gone.
    #: The editor greys the icon out and shows a "Deleted" badge.
    DELETED = "deleted"
    #: Could not be fetched (no permission, throttling); kept separate from deleted.
    ERROR = "error"
    #: Never fetched.
    UNKNOWN = "unknown"


class RowKind(StrEnum):
    TEXT = "text"
    CODE = "code"
    BADGE = "badge"
    LINK = "link"
    LIST = "list"


class BadgeTone(StrEnum):
    OK = "ok"
    WARN = "warn"
    ERROR = "error"
    MUTED = "muted"


class Row(CamelModel):
    """One row in the parameter popup's table."""

    label: str
    value: str | list[str] | None = None
    kind: RowKind = RowKind.TEXT
    #: Colour, when kind=BADGE.
    tone: BadgeTone | None = None
    #: Where the link goes, when kind=LINK (an AWS console URL, say).
    href: str | None = None
    #: Reference to another resource. Becomes a jump link when that node is in the diagram.
    ref: Arn | None = None


class Section(CamelModel):
    """A category in the parameter popup. Array order is display order."""

    title: str
    rows: list[Row] = Field(default_factory=list)
    collapsed: bool = False


class Relation(CamelModel):
    """A relationship to another resource. The material an AI uses to draw edges."""

    #: kebab-case. For example in-vpc / in-subnet / security-group / attached-to /
    #: targets / routes-to / assumes-role / reads-from / writes-to
    type: Annotated[str, Field(pattern=RELATION_TYPE_PATTERN)]
    target_arn: Arn
    label: str | None = None


class NormalizedResource(CamelModel):
    """One normalized resource (``workspace/inventory/resources/*.json``)."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION

    # --- Identity ---
    arn: Arn
    account_id: Annotated[str, Field(pattern=ACCOUNT_ID_PATTERN)]
    account_alias: str | None = None
    region: Annotated[str, Field(min_length=1)]
    #: CloudFormation resource type. The dispatch key for Profiles.
    resource_type: Annotated[str, Field(pattern=r"^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$")]
    #: The id AWS assigned. Third label line under the icon.
    resource_id: str

    # --- The four label lines under the icon ---
    #: First line under the icon. For example "EC2".
    service: str
    #: Second line. The name the user gave it when building (a Name tag, say).
    name: str | None = None
    tags: list[Tag] = Field(default_factory=list)
    icon_key: IconKey

    # --- Freshness and state ---
    lifecycle: Lifecycle = Lifecycle.UNKNOWN
    fetched_at: datetime
    #: When lifecycle=DELETED was detected.
    deleted_at: datetime | None = None
    #: Why, when lifecycle=ERROR.
    last_error: str | None = None

    # --- The body ---
    sections: list[Section] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)
    #: Raw Describe response (collapsed in the popup).
    raw: dict[str, Any] | None = None

    @field_validator("tags")
    @classmethod
    def _unique_tag_keys(cls, tags: list[Tag]) -> list[Tag]:
        keys = [t.key for t in tags]
        if len(keys) != len(set(keys)):
            dupes = sorted({k for k in keys if keys.count(k) > 1})
            raise ValueError(f"Duplicate tag keys: {dupes}")
        return tags

    @property
    def is_stale(self) -> bool:
        return self.lifecycle in (Lifecycle.DELETED, Lifecycle.ERROR, Lifecycle.UNKNOWN)


class InventoryEntry(CamelModel):
    """One entry in ``workspace/inventory/index.json``."""

    arn: Arn
    account_id: str
    account_alias: str | None = None
    region: str
    resource_type: str
    resource_id: str
    service: str
    name: str | None = None
    tags: list[Tag] = Field(default_factory=list)
    icon_key: IconKey
    lifecycle: Lifecycle = Lifecycle.UNKNOWN
    fetched_at: datetime | None = None
    #: Whether the detail JSON has been fetched. "Refresh" fetches the missing ones
    #: ("Configure" only links the ARN; it does not fetch).
    has_detail: bool = False


class Inventory(CamelModel):
    """The whole inventory index file."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    generated_at: datetime
    #: Where it came from. resource-explorer / config-aggregator / describe
    source: Literal["resource-explorer", "config-aggregator", "describe", "mixed"]
    entries: list[InventoryEntry] = Field(default_factory=list)
