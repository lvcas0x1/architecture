"""The FastAPI application."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import diagrams, export, icon_scopes, icons, resources
from app.config import REPO_ROOT, get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

EDITOR_DIST = REPO_ROOT / "packages" / "editor" / "dist"


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Architecture API",
        version="0.1.0",
        description="Saves diagrams, normalizes Describe output, and exports HTML.",
    )

    # Only in development: allow calls from the Vite dev server
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    app.include_router(icons.router, prefix="/api")
    app.include_router(icon_scopes.router, prefix="/api")
    app.include_router(resources.router, prefix="/api")
    app.include_router(diagrams.router, prefix="/api")
    app.include_router(export.router, prefix="/api")

    @app.get("/api/health")
    def health() -> dict[str, object]:
        from app.aws.profiles import supported_resource_types

        return {
            "status": "ok",
            "workspace": str(settings.workspace),
            "accounts": sorted(settings.accounts),
            "supportedResourceTypes": supported_resource_types(),
        }

    if EDITOR_DIST.exists():
        app.mount("/", StaticFiles(directory=EDITOR_DIST, html=True), name="editor")

    return app


app = create_app()
