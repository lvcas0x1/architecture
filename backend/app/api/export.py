"""Single-file HTML export."""

from __future__ import annotations

import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, ValidationError

from app.deps import SettingsDep, StoreDep
from app.export.html import ViewerNotBuiltError, build_bundle, export_diagram
from app.models import Diagram, ExportOptions, NormalizedResource
from app.store import DiagramNotFoundError, InvalidDiagramIdError

router = APIRouter(tags=["export"])


class ExportRequest(BaseModel):
    diagram: Diagram
    options: ExportOptions = Field(default_factory=ExportOptions)
    #: True also saves a copy under workspace/exports.
    save: bool = False
    #: Details the editor holds (loaded straight from a file).
    #: These win over what is on disk, so the screen and the export agree.
    resources: dict[str, NormalizedResource] = Field(default_factory=dict)


class ExportSummary(BaseModel):
    """For the pre-export check (shows what will be included)."""

    resource_count: int = Field(alias="resourceCount")
    icon_count: int = Field(alias="iconCount")
    missing_resources: list[str] = Field(alias="missingResources")
    #: Icons that are in the catalog but whose SVG was missing, so they were left out.
    missing_icons: list[str] = Field(alias="missingIcons", default_factory=list)
    #: Rough size of the embedded data. The viewer itself (JS / CSS) is not counted.
    bytes_estimate: int = Field(alias="bytesEstimate")


def _safe_filename(title: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]', "-", title).strip() or "diagram"
    return f"{cleaned[:80]}.html"


def _content_disposition(filename: str) -> str:
    """Encode filenames with RFC 5987 and an ASCII fallback."""
    ascii_fallback = re.sub(r"[^A-Za-z0-9._-]", "_", filename) or "diagram.html"
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


@router.post("/export/html", response_class=HTMLResponse)
def export_html(payload: ExportRequest, store: StoreDep, settings: SettingsDep) -> HTMLResponse:
    """Return the diagram as a single HTML file."""
    try:
        document = export_diagram(payload.diagram, store, payload.options, payload.resources)
    except ViewerNotBuiltError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if payload.save:
        destination = settings.exports_dir / _safe_filename(payload.diagram.meta.title)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(document, encoding="utf-8")

    filename = _safe_filename(payload.diagram.meta.title)
    return HTMLResponse(
        content=document,
        # Download it rather than opening it in the browser
        headers={"Content-Disposition": _content_disposition(filename)},
    )


@router.post("/export/summary", response_model=ExportSummary)
def export_summary(payload: ExportRequest, store: StoreDep) -> ExportSummary:
    """Show what will be included before exporting."""
    bundle = build_bundle(payload.diagram, store, payload.options, payload.resources)
    referenced = payload.diagram.referenced_arns()
    missing = sorted(referenced - set(bundle.resources))

    return ExportSummary(
        resourceCount=len(bundle.resources),
        iconCount=len(bundle.icons),
        missingResources=missing,
        missingIcons=sorted(payload.diagram.referenced_icon_keys() - set(bundle.icons)),
        bytesEstimate=len(bundle.model_dump_json(by_alias=True).encode("utf-8")),
    )


@router.post("/diagrams/{diagram_id}/export/html", response_class=HTMLResponse)
def export_saved_diagram(
    diagram_id: str,
    store: StoreDep,
    settings: SettingsDep,
    options: ExportOptions | None = None,
) -> HTMLResponse:
    """Export a saved diagram as HTML."""
    try:
        diagram = store.read_diagram(diagram_id)
    except InvalidDiagramIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DiagramNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="The saved diagram is not valid") from exc

    return export_html(
        ExportRequest(diagram=diagram, options=options or ExportOptions(), save=True),
        store,
        settings,
    )
