"""Shared test setup."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from botocore.exceptions import ClientError

from app.aws.profiles import ResourceContext
from app.config import Settings


class FakeClient:
    """A fake boto3 client that answers (or raises) per method name."""

    def __init__(self, responses: dict[str, Any]) -> None:
        self._responses = responses
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __getattr__(self, name: str) -> Callable[..., Any]:
        def call(**kwargs: Any) -> Any:
            self.calls.append((name, kwargs))
            if name not in self._responses:
                raise AssertionError(f"Unexpected API call: {name}")
            result = self._responses[name]
            if isinstance(result, Exception):
                raise result
            return result

        return call


def client_error(
    code: str, message: str = "test error", operation: str = "Describe"
) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, operation)


def fake_factory(client: Any) -> Callable[[str, str, str], Any]:
    """Return the same fake client whatever service is asked for."""

    def factory(service: str, account_id: str, region: str) -> Any:
        return client

    return factory


#: Account definitions for tests.
_ACCOUNTS_YAML = """
defaults:
  region: ap-northeast-1
accounts:
  - id: "123456789012"
    alias: prod
    readonly: true
"""


@pytest.fixture
def anyio_backend():
    """Run ASGI tests on the asyncio backend used by the application server."""
    return "asyncio"


@pytest.fixture
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Settings]:
    """Switch the workspace to tmp_path."""
    from app.config import get_settings
    from app.deps import get_client_factory, get_store

    accounts_file = tmp_path / "accounts.yaml"
    accounts_file.write_text(_ACCOUNTS_YAML, encoding="utf-8")

    monkeypatch.setenv("ARCH_WORKSPACE", str(tmp_path / "workspace"))
    monkeypatch.setenv("ARCH_ACCOUNTS", str(accounts_file))

    caches = (get_settings, get_store, get_client_factory)
    for cached in caches:
        cached.cache_clear()

    yield get_settings()

    for cached in caches:
        cached.cache_clear()


@pytest.fixture
def store(settings: Settings):
    from app.store import Store

    return Store(settings)


@pytest.fixture
def ctx() -> ResourceContext:
    return ResourceContext(
        arn="arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc",
        account_id="123456789012",
        account_alias="prod",
        region="ap-northeast-1",
        resource_id="i-0abc",
        fetched_at=datetime(2026, 9, 19, tzinfo=UTC),
    )
