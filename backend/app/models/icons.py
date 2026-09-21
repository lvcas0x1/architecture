"""Schema for the icon catalog."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import Field, field_validator

from .common import SCHEMA_VERSION, CamelModel
from .diagram import ResourceScope
from .resource import IconKey


class IconGroup(StrEnum):
    """Official AWS icon families."""

    #: Arch_* - service icons (the main content of the left palette).
    ARCHITECTURE = "Architecture"
    #: Res_* - resource icons (finer grained, such as an EC2 instance).
    RESOURCE = "Resource"
    #: Arch-Category_* - category icons.
    CATEGORY = "Category"
    #: Group boxes (the VPC / AZ / subnet frames).
    GROUP = "Group"


class IconEntry(CamelModel):
    """One icon in the left palette."""

    key: IconKey
    group: IconGroup
    #: Accordion heading in the palette. For example "Compute".
    category: str
    #: Display name. For example "Amazon EC2".
    label: str
    #: Static path. For example "/icons/Architecture/Compute/Amazon-EC2.svg".
    path: str
    #: Search aliases. For example ["ec2", "instance", "virtual server"].
    aliases: list[str] = Field(default_factory=list)
    #: The CloudFormation resource types this icon stands for, where known.
    #: Used to pick an icon automatically from a Profile's resource type.
    resource_types: list[str] = Field(default_factory=list)


class IconCatalog(CamelModel):
    """``packages/editor/public/icons.json``."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    generated_at: datetime
    #: Release of the AWS icon package that was imported (taken from the folder name).
    package_release: str | None = None
    icons: list[IconEntry] = Field(default_factory=list)

    def by_key(self) -> dict[str, IconEntry]:
        return {icon.key: icon for icon in self.icons}

    def categories(self) -> list[str]:
        seen: dict[str, None] = {}
        for icon in self.icons:
            seen.setdefault(icon.category, None)
        return list(seen)


class IconScopes(CamelModel):
    """Attributes (placement layers) for icons, in ``workspace/icon-scopes.json``."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    updated_at: datetime | None = None
    #: Icon key -> attribute. An icon that is not listed has no attribute (it goes anywhere).
    scopes: dict[IconKey, ResourceScope] = Field(default_factory=dict)

    @field_validator("scopes")
    @classmethod
    def _drop_any(cls, scopes: dict[str, ResourceScope]) -> dict[str, ResourceScope]:
        """``any`` means "no attribute", so it is not stored: the file lists only
        the icons that were given one.
        """
        return {key: scope for key, scope in scopes.items() if scope is not ResourceScope.ANY}

    def effective(self, catalog: IconCatalog) -> dict[str, ResourceScope]:
        """Return scopes for keys present in the catalog."""
        known = {icon.key for icon in catalog.icons}
        return {key: scope for key, scope in self.scopes.items() if key in known}
