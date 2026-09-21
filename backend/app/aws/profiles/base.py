"""Base class and registry for the per-service normalization profiles."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any, ClassVar, Protocol

from app.models import NormalizedResource, Section, Tag


class BotoClient(Protocol):
    """The smallest boto3 client interface (so tests can swap it)."""

    def __getattr__(self, name: str) -> Any: ...


@dataclass(frozen=True, slots=True)
class ResourceContext:
    """The context needed for normalization, all recoverable from the ARN."""

    arn: str
    account_id: str
    account_alias: str | None
    region: str
    resource_id: str
    fetched_at: datetime
    #: ``aws`` / ``aws-cn`` / ``aws-us-gov``. Used to build ARNs of related resources.
    partition: str = "aws"

    def arn_for(self, service: str, resource: str) -> str:
        """Build a related ARN with the same partition, account, and region."""
        return f"arn:{self.partition}:{service}:{self.region}:{self.account_id}:{resource}"


class ResourceNotFoundError(Exception):
    """Describe ran but the resource was not there (so it is deleted)."""


class Profile(ABC):
    """Describe and normalization for one resource type."""

    #: Resource type in CloudFormation form.
    resource_type: ClassVar[str]
    #: Service name shown on the first label line.
    service: ClassVar[str]
    #: Default icon key (the logical key).
    icon_key: ClassVar[str]
    #: boto3 client name.
    boto_service: ClassVar[str]
    #: Lookup keys from an ARN: (service, resource_prefix). More than one is fine.
    arn_keys: ClassVar[tuple[tuple[str, str], ...]]
    #: These error codes mean "deleted".
    not_found_codes: ClassVar[tuple[str, ...]] = ()

    @abstractmethod
    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        """Fetch raw details; raise ResourceNotFoundError for missing resources."""

    @abstractmethod
    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        """Turn raw data into the normalized JSON the editor displays."""

    # -- Small helpers for normalization ---------------------------------

    @staticmethod
    def tags_from(raw: dict[str, Any], key: str = "Tags") -> list[Tag]:
        """Pull out tags in ``[{\"Key\": ..., \"Value\": ...}]`` form."""
        tags: list[Tag] = []
        seen: set[str] = set()
        for entry in raw.get(key) or []:
            name = entry.get("Key") or entry.get("key")
            if not name or name in seen:
                continue
            seen.add(name)
            tags.append(Tag(key=name, value=entry.get("Value") or entry.get("value") or ""))
        return tags

    @staticmethod
    def name_from_tags(tags: list[Tag], fallback: str | None = None) -> str | None:
        for tag in tags:
            if tag.key == "Name" and tag.value:
                return tag.value
        return fallback

    @staticmethod
    def build(
        ctx: ResourceContext,
        *,
        resource_type: str,
        service: str,
        icon_key: str,
        name: str | None,
        tags: list[Tag],
        sections: list[Section],
        relations: list[Any] | None = None,
        #: Override the region with what Describe returned, when the ARN has none (S3).
        region: str | None = None,
    ) -> NormalizedResource:
        return NormalizedResource(
            arn=ctx.arn,
            account_id=ctx.account_id,
            account_alias=ctx.account_alias,
            region=region or ctx.region,
            resource_type=resource_type,
            resource_id=ctx.resource_id,
            service=service,
            name=name,
            tags=tags,
            icon_key=icon_key,
            lifecycle="active",
            fetched_at=ctx.fetched_at,
            sections=sections,
            relations=relations or [],
        )


_REGISTRY: dict[str, Profile] = {}
_BY_ARN_KEY: dict[tuple[str, str], Profile] = {}


def register(cls: type[Profile]) -> type[Profile]:
    """Decorator that registers a Profile."""
    instance = cls()
    if cls.resource_type in _REGISTRY:
        raise ValueError(f"Duplicate resource_type: {cls.resource_type}")
    _REGISTRY[cls.resource_type] = instance
    for key in cls.arn_keys:
        if key in _BY_ARN_KEY:
            raise ValueError(f"Duplicate ARN key: {key}")
        _BY_ARN_KEY[key] = instance
    return cls


def profile_for_type(resource_type: str) -> Profile | None:
    return _REGISTRY.get(resource_type)


def profile_for_arn_key(key: tuple[str, str]) -> Profile | None:
    return _BY_ARN_KEY.get(key)


def all_profiles() -> list[Profile]:
    return list(_REGISTRY.values())


def supported_resource_types() -> list[str]:
    return sorted(_REGISTRY)
