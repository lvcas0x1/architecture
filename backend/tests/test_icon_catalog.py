"""Whether the logical icon keys still match the imported catalog."""

from __future__ import annotations

import json

import pytest

from app.aws.profiles import base as profile_base
from app.config import REPO_ROOT
from app.validation import load_known_icon_keys

OVERRIDES = REPO_ROOT / "config" / "icon-overrides.json"


@pytest.fixture(scope="module")
def known_keys() -> set[str]:
    keys = load_known_icon_keys()
    if not keys:
        pytest.skip("no icon catalog (run npm run icons / icons:placeholder)")
    return keys


def test_profile_icon_keys_exist(known_keys: set[str]) -> None:
    """An icon_key hard-coded in a Profile has to be a key that exists."""
    missing = sorted(
        {
            f"{p.resource_type} -> {p.icon_key}"
            for p in profile_base.all_profiles()
            if p.icon_key not in known_keys
        }
    )
    assert not missing, "icon_key not in the catalog: " + ", ".join(missing)


def test_override_keys_exist(known_keys: set[str]) -> None:
    """The override keys too. A stale one silently stops applying."""
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    missing = sorted(k for k in overrides if not k.startswith("_") and k not in known_keys)
    assert not missing, "override key not in the catalog: " + ", ".join(missing)


def test_placeholder_keys_match_official() -> None:
    """The placeholder keys follow the official spelling."""
    official = REPO_ROOT / "packages" / "editor" / "public" / "icons.json"
    placeholder = REPO_ROOT / "packages" / "editor" / "public" / "icons-placeholder.json"
    if not official.exists() or not placeholder.exists():
        pytest.skip("the official or the placeholder catalog is not generated")

    official_keys = {i["key"] for i in json.loads(official.read_text(encoding="utf-8"))["icons"]}
    placeholder_keys = {
        i["key"] for i in json.loads(placeholder.read_text(encoding="utf-8"))["icons"]
    }
    missing = sorted(placeholder_keys - official_keys)
    assert not missing, "placeholder with no official counterpart: " + ", ".join(missing)


def test_search_order_matches_the_editor() -> None:
    """The server must read the catalog the palette shows."""
    import re

    from app.icons import ICON_CATALOG_PATHS

    source = (REPO_ROOT / "packages" / "editor" / "src" / "lib" / "icons.ts").read_text(
        encoding="utf-8"
    )
    fetched = re.findall(r'url:\s*"/([^"]+)"', source)
    public = REPO_ROOT / "packages" / "editor" / "public"

    assert [path.name for path in ICON_CATALOG_PATHS] == fetched
    assert all(path.parent == public for path in ICON_CATALOG_PATHS)


@pytest.mark.parametrize("invalid", ["{broken", '{"icons": []}'])
def test_invalid_official_catalog_falls_back(tmp_path, invalid):
    from app.icons import load_icon_catalog

    official = tmp_path / "icons.json"
    official.write_text(invalid, encoding="utf-8")
    placeholder = REPO_ROOT / "packages/editor/public/icons-placeholder.json"
    catalog = load_icon_catalog((official, placeholder))
    assert catalog is not None
    assert catalog.icons
