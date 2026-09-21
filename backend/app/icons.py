"""Where the icon catalog is read from."""

from __future__ import annotations

import logging
from pathlib import Path

from app.config import REPO_ROOT
from app.models import IconCatalog

#: The official import writes the first; `npm run icons:placeholder` the second.
ICON_CATALOG_PATHS: tuple[Path, ...] = (
    REPO_ROOT / "packages" / "editor" / "public" / "icons.json",
    REPO_ROOT / "packages" / "editor" / "public" / "icons-placeholder.json",
)


def load_icon_catalog(paths: tuple[Path, ...] = ICON_CATALOG_PATHS) -> IconCatalog | None:
    for path in paths:
        if not path.exists():
            continue
        try:
            catalog = IconCatalog.model_validate_json(path.read_text(encoding="utf-8"))
            if catalog.icons:
                return catalog
        except (OSError, ValueError):
            logging.getLogger(__name__).warning("Skipped invalid icon catalog: %s", path)
    return None
