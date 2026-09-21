"""Writing a diagram out as a single HTML file."""

from __future__ import annotations

import html
import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.config import REPO_ROOT
from app.icons import load_icon_catalog
from app.models import (
    Diagram,
    ExportBundle,
    ExportOptions,
    NormalizedResource,
)
from app.store import Store

logger = logging.getLogger(__name__)

VIEWER_DIST = REPO_ROOT / "packages" / "viewer" / "dist"
VIEWER_JS = VIEWER_DIST / "viewer.js"
VIEWER_CSS = VIEWER_DIST / "viewer.css"
EDITOR_PUBLIC = REPO_ROOT / "packages" / "editor" / "public"

#: Characters that need escaping inside a data URI. SVG is usually smaller
#: URL-encoded than base64-encoded, so that is what is used.
_DATA_URI_SAFE = "-_.!~*'()@$,;:/?=+&[] "


class ViewerNotBuiltError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "The viewer has not been built. Run `npm run build --workspace @architecture/viewer`."
        )


def icon_file_for(served_path: str) -> Path | None:
    """Resolve a catalog path (/icons/...) to a real file."""
    if not served_path.startswith("/"):
        return None
    candidate = (EDITOR_PUBLIC / served_path.lstrip("/")).resolve()
    # Never leave the directory that is served
    if not candidate.is_relative_to(EDITOR_PUBLIC.resolve()):
        return None
    return candidate if candidate.is_file() else None


def svg_to_data_uri(svg: str) -> str:
    """Turn an SVG into a data URI."""
    compact = " ".join(svg.split())
    return f"data:image/svg+xml;charset=utf-8,{quote(compact, safe=_DATA_URI_SAFE)}"


def collect_icons(diagram: Diagram) -> dict[str, str]:
    """Inline only the icons the diagram uses (keeps the file small)."""
    catalog = load_icon_catalog()
    if catalog is None:
        logger.warning("No icon catalog, so the export has no icons.")
        return {}

    by_key = catalog.by_key()
    icons: dict[str, str] = {}
    for key in sorted(diagram.referenced_icon_keys()):
        entry = by_key.get(key)
        if entry is None:
            logger.warning("Icon is not in the catalog: %s", key)
            continue
        path = icon_file_for(entry.path)
        if path is None:
            logger.warning("Icon file not found: %s", entry.path)
            continue
        icons[key] = svg_to_data_uri(path.read_text(encoding="utf-8"))
    return icons


#: Digit boundaries also match account IDs next to underscores.
_ACCOUNT_ID_RE = re.compile(r"(?<![0-9])[0-9]{12}(?![0-9])")


class AccountMasker:
    """Assign distinct, stable account masks within each export."""

    def __init__(self) -> None:
        self._by_account: dict[str, str] = {}
        self._taken: set[str] = set()

    def for_account(self, account_id: str) -> str:
        known = self._by_account.get(account_id)
        if known is not None:
            return known

        prefix = account_id[:4]
        candidate = f"{prefix}{'*' * 8}"
        counter = 2
        while candidate in self._taken:
            tail = str(counter)
            candidate = f"{prefix}{'*' * (8 - len(tail))}{tail}"
            counter += 1
        self._by_account[account_id] = candidate
        self._taken.add(candidate)
        return candidate

    def text(self, value: str) -> str:
        return _ACCOUNT_ID_RE.sub(lambda m: self.for_account(m.group()), value)

    def deep(self, value: Any) -> Any:
        """Mask strings, 12-digit numbers, and ARN dictionary keys."""
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, bool):
            return value
        if isinstance(value, int) and len(str(abs(value))) == 12:
            # A raw Describe response can carry an owner id as a number
            return self.text(str(value))
        if isinstance(value, list):
            return [self.deep(item) for item in value]
        if isinstance(value, dict):
            return {self.deep(key): self.deep(item) for key, item in value.items()}
        return value


def mask_account_id(value: str) -> str:
    """Turn ``123456789012`` into ``1234********``."""
    return AccountMasker().text(value)


def build_bundle(
    diagram: Diagram,
    store: Store,
    options: ExportOptions | None = None,
    extra_resources: dict[str, NormalizedResource] | None = None,
) -> ExportBundle:
    """Build an export bundle; local extra_resources override stored details."""
    opts = options or ExportOptions()
    provided = extra_resources or {}

    resources = {}
    for arn in sorted(diagram.referenced_arns()):
        resource = provided.get(arn) or store.read_resource(arn)
        if resource is None:
            logger.info("Not fetched, so not included: %s", arn)
            continue
        # The raw response can hold secrets, so include it only when asked
        resources[arn] = resource if opts.include_raw else resource.model_copy(update={"raw": None})

    return ExportBundle(
        exported_at=datetime.now(UTC),
        options=opts,
        diagram=diagram,
        resources=resources,
        icons=collect_icons(diagram),
    )


def bundle_payload(bundle: ExportBundle) -> str:
    """Serialize and mask export data after model validation."""
    if not bundle.options.mask_account_ids:
        return bundle.model_dump_json(by_alias=True, exclude_none=False)

    # Icons are data URIs: huge, and they contain no ids. Left alone.
    icons = bundle.icons
    payload = bundle.model_dump(mode="json", by_alias=True, exclude={"icons"})
    masked = AccountMasker().deep(payload)
    return json.dumps({**masked, "icons": icons}, ensure_ascii=False)


def _embed_json(payload: str) -> str:
    """Keep ``</script>`` from breaking the document."""
    return payload.replace("</", "<\\/")


_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="architecture-diagram">
<title>{title}</title>
<style>
{css}
</style>
</head>
<body>
<div id="arch-root"></div>
<script type="application/json" id="arch-bundle">{bundle}</script>
<script>
{js}
</script>
</body>
</html>
"""


def render_html(bundle: ExportBundle) -> str:
    """Return a single HTML file with the viewer and the data inlined."""
    if not VIEWER_JS.exists() or not VIEWER_CSS.exists():
        raise ViewerNotBuiltError

    return _TEMPLATE.format(
        title=html.escape(bundle.diagram.meta.title or "Architecture diagram"),
        css=VIEWER_CSS.read_text(encoding="utf-8"),
        js=VIEWER_JS.read_text(encoding="utf-8"),
        bundle=_embed_json(bundle_payload(bundle)),
    )


def export_diagram(
    diagram: Diagram,
    store: Store,
    options: ExportOptions | None = None,
    extra_resources: dict[str, NormalizedResource] | None = None,
) -> str:
    return render_html(build_bundle(diagram, store, options, extra_resources))


def export_to_file(
    diagram: Diagram,
    store: Store,
    destination: Path,
    options: ExportOptions | None = None,
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(export_diagram(diagram, store, options), encoding="utf-8")
    return destination
