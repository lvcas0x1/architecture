from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field

from app.models import Diagram
from app.models.common import CamelModel
from app.models.project import Project, ResourceGraph
from app.project import accept_human, ai_context, assess, new_project, regenerate

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("/open", response_model=Project)
def open_project(project: Project):
    return project


class ImportRequest(CamelModel):
    graph: ResourceGraph
    view: Literal["overview", "network", "application", "security"] = "overview"
    selected_arns: list[str] = Field(default_factory=list)


class EditRequest(CamelModel):
    project: Project
    diagram: Diagram


class RegenerateRequest(CamelModel):
    project: Project
    graph: ResourceGraph | None = None
    proposal: Diagram | None = None


@router.post("/import", response_model=Project)
def import_inventory(request: ImportRequest):
    try:
        return new_project(request.graph, request.view, request.selected_arns or None)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/human", response_model=Project)
def human_edit(request: EditRequest):
    return accept_human(request.project, request.diagram)


@router.post("/regenerate", response_model=Project)
def regenerate_project(request: RegenerateRequest):
    try:
        result = regenerate(request.project, request.graph, request.proposal)
        report = assess(result)
        if not report.ok:
            raise HTTPException(422, report.model_dump(mode="json"))
        return result
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/validate")
def validate_project(project: Project):
    return assess(project)


@router.post("/context")
def context(project: Project):
    return ai_context(project)
