"""Guarantee the tests never touch the real workspace."""

from __future__ import annotations

from pathlib import Path

from app.config import REPO_ROOT, get_settings
from app.store import Store

REAL_WORKSPACE = REPO_ROOT / "workspace"


def test_settings_fixture_points_outside_the_repository(settings):
    assert not settings.workspace.is_relative_to(REAL_WORKSPACE)
    assert settings.workspace.exists()


def test_get_settings_follows_the_fixture(settings):
    # Even called through a reference bound at import time, the settings match
    assert get_settings().workspace == settings.workspace


def test_writes_land_in_the_temporary_workspace(settings, tmp_path: Path):
    from app.models import Diagram

    store = Store(get_settings())
    store.write_diagram("t", Diagram.model_validate({"meta": {"title": "t"}}))

    written = list(tmp_path.rglob("t.arch.json"))
    assert written, "nothing was written under tmp_path"
    assert not (REAL_WORKSPACE / "diagrams" / "t.arch.json").exists()


def test_account_alias_comes_from_the_fixture_config(settings):
    assert settings.alias_for("123456789012") == "prod"
    assert settings.alias_for("999999999999") is None
