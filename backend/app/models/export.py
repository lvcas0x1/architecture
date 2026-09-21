"""Schema for the bundle embedded in a single-file HTML export: the viewer's contract."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from .common import SCHEMA_VERSION, CamelModel
from .diagram import Diagram
from .resource import NormalizedResource


class ExportOptions(CamelModel):
    #: Whether to include the raw Describe response (off by default; it may hold secrets).
    include_raw: bool = False
    #: Whether the parameter popup works. False produces a static, view-only diagram.
    interactive: bool = True
    include_search: bool = True
    #: Mask account ids in the output (for sharing outside the company).
    mask_account_ids: bool = False


class ExportBundle(CamelModel):
    """What goes into the ``<script type=\"application/json\">`` inside the HTML."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    exported_at: datetime
    options: ExportOptions = Field(default_factory=ExportOptions)
    diagram: Diagram
    #: ARN -> normalized resource. Only what the diagram references.
    resources: dict[str, NormalizedResource] = Field(default_factory=dict)
    #: iconKey -> data URI. Only the icons the diagram uses, to keep the file small.
    icons: dict[str, str] = Field(default_factory=dict)
