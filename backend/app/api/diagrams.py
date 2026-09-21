"""Saving, loading and checking diagrams."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from app.deps import StoreDep
from app.models import Diagram
from app.store import DiagramNotFoundError, InvalidDiagramIdError
from app.validation import validate_diagram

router = APIRouter(prefix="/diagrams", tags=["diagrams"])


class DiagramSummary(BaseModel):
    id: str
    title: str
    updated_at: str = Field(alias="updatedAt")


class ValidationReport(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


@router.get("", response_model=list[DiagramSummary])
def list_diagrams(store: StoreDep) -> list[DiagramSummary]:
    return [DiagramSummary.model_validate(item) for item in store.list_diagrams()]


@router.get("/{diagram_id}", response_model=Diagram)
def get_diagram(diagram_id: str, store: StoreDep) -> Diagram:
    try:
        return store.read_diagram(diagram_id)
    except InvalidDiagramIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DiagramNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=f"The diagram is not valid: {exc.error_count()} problem(s)"
        ) from exc


@router.put("/{diagram_id}", response_model=Diagram)
def put_diagram(diagram_id: str, diagram: Diagram, store: StoreDep) -> Diagram:
    try:
        store.write_diagram(diagram_id, diagram)
    except InvalidDiagramIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return diagram


@router.delete("/{diagram_id}", status_code=204)
def delete_diagram(diagram_id: str, store: StoreDep) -> None:
    try:
        store.delete_diagram(diagram_id)
    except InvalidDiagramIdError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DiagramNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/validate", response_model=ValidationReport)
def validate(diagram: Diagram, store: StoreDep) -> ValidationReport:
    """Check AI output. FastAPI has already validated the schema, so this looks
    at whether references exist (ARN / iconKey) and at problems with the shape."""
    report = validate_diagram(diagram, store)
    return ValidationReport(**report)
