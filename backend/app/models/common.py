"""Shared base class and alias settings: camelCase in JSON, snake_case in Python."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

SCHEMA_VERSION = "1.0"


class CamelModel(BaseModel):
    """camelCase in JSON, snake_case in Python."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
        str_strip_whitespace=True,
        # Serialization includes defaults, so output types require those fields.
        json_schema_serialization_defaults_required=True,
    )


class Tag(CamelModel):
    """An AWS resource tag."""

    key: str
    value: str = ""
