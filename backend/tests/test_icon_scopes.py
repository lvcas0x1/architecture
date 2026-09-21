"""Icon attributes (placement layers)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx2 import ASGITransport, AsyncClient

from app.models import (
    Diagram,
    DiagramMeta,
    IconCatalog,
    IconEntry,
    IconGroup,
    IconScopes,
    ResourceScope,
)
from app.store import Store
from app.validation import validate_diagram

EC2 = "Architecture/Compute/Amazon-EC2"
pytestmark = pytest.mark.anyio
S3 = "Architecture/Storage/Amazon-Simple-Storage-Service"


def catalog() -> IconCatalog:
    return IconCatalog(
        generated_at=datetime(2026, 9, 19, tzinfo=UTC),
        icons=[
            IconEntry(
                key=EC2,
                group=IconGroup.ARCHITECTURE,
                category="Compute",
                label="Amazon EC2",
                path="/icons/ec2.svg",
            ),
            IconEntry(
                key=S3,
                group=IconGroup.ARCHITECTURE,
                category="Storage",
                label="Amazon S3",
                path="/icons/s3.svg",
            ),
        ],
    )


class TestEffective:
    def test_every_icon_starts_with_no_attribute(self) -> None:
        """No shipped defaults. Whether to set one is entirely the user's call."""
        assert IconScopes().effective(catalog()) == {}

    def test_only_what_was_set_is_listed(self) -> None:
        scopes = IconScopes(scopes={EC2: ResourceScope.SUBNET})
        effective = scopes.effective(catalog())

        assert effective == {EC2: ResourceScope.SUBNET}
        assert S3 not in effective

    def test_keys_missing_from_the_catalog_are_dropped(self) -> None:
        """An icon package update that removed a key leaves no orphan setting."""
        scopes = IconScopes(scopes={"Architecture/Compute/Gone": ResourceScope.ZONE})
        assert "Architecture/Compute/Gone" not in scopes.effective(catalog())


class TestStore:
    def test_empty_when_never_written(self, store: Store) -> None:
        assert store.read_icon_scopes().scopes == {}

    def test_writes_and_reads_back(self, store: Store) -> None:
        store.write_icon_scopes(IconScopes(scopes={EC2: ResourceScope.SUBNET}))
        assert store.read_icon_scopes().scopes == {EC2: ResourceScope.SUBNET}

    def test_records_the_save_time(self, store: Store) -> None:
        store.write_icon_scopes(IconScopes(scopes={EC2: ResourceScope.VPC}))
        assert store.read_icon_scopes().updated_at is not None

    def test_corrupted_file_does_not_break_it(self, store: Store) -> None:
        store.settings.icon_scopes.write_text("{ broken", encoding="utf-8")
        assert store.read_icon_scopes().scopes == {}


@pytest.fixture
async def client(settings):
    from app import main

    async with AsyncClient(
        transport=ASGITransport(app=main.create_app()),
        base_url="http://testserver",
        follow_redirects=True,
    ) as test_client:
        yield test_client


class TestApi:
    async def test_starts_empty(self, client: AsyncClient) -> None:
        body = (await client.get("/api/icon-scopes")).json()
        assert body["scopes"] == {}

    async def test_saves_and_reads_back(self, client: AsyncClient) -> None:
        saved = await client.put(
            "/api/icon-scopes", json={"schemaVersion": "1.0", "scopes": {EC2: "subnet"}}
        )
        assert saved.status_code == 200
        assert (await client.get("/api/icon-scopes")).json()["scopes"] == {EC2: "subnet"}

    async def test_replaces_the_whole_set(self, client: AsyncClient) -> None:
        (
            await client.put(
                "/api/icon-scopes", json={"schemaVersion": "1.0", "scopes": {EC2: "subnet"}}
            )
        )
        (
            await client.put(
                "/api/icon-scopes", json={"schemaVersion": "1.0", "scopes": {S3: "global"}}
            )
        )
        assert (await client.get("/api/icon-scopes")).json()["scopes"] == {S3: "global"}

    async def test_rejects_an_unknown_attribute(self, client: AsyncClient) -> None:
        res = await client.put(
            "/api/icon-scopes", json={"schemaVersion": "1.0", "scopes": {EC2: "planet"}}
        )
        assert res.status_code == 422


#: The shortest legal parent chain. Only the attribute check matters here, so
#: only the boxes each style needs are stacked.
_CHAIN: dict[str, list[str]] = {
    "global": [],
    "account": ["global"],
    "region": ["global", "account"],
    "vpc": ["global", "account", "region"],
    "az": ["global", "account", "region", "vpc"],
    "subnet-public": ["global", "account", "region", "vpc", "az"],
    "generic": [],
}


def diagram_with(icon_key: str, group_style: str) -> Diagram:
    """A diagram with one icon inside a box of the given style."""
    styles = [*_CHAIN[group_style], group_style]
    nodes: list[dict] = []
    for depth, style in enumerate(styles):
        nodes.append(
            {
                "id": f"g-{depth}",
                "type": "group",
                **({"parentId": f"g-{depth - 1}"} if depth else {}),
                "position": {"x": 20, "y": 20},
                "size": {"width": 900 - depth * 60, "height": 700 - depth * 60},
                "data": {"label": style, "style": style},
            }
        )
    nodes.append(
        {
            "id": "n-1",
            "type": "resource",
            "parentId": f"g-{len(styles) - 1}",
            "position": {"x": 40, "y": 40},
            "data": {"iconKey": icon_key},
        }
    )
    return Diagram.model_validate(
        {"meta": DiagramMeta(title="t").model_dump(by_alias=True), "nodes": nodes}
    )


class TestValidation:
    """Changing an attribute can make a saved diagram stop matching."""

    @pytest.fixture
    def scopes(self) -> dict[str, ResourceScope]:
        return {EC2: ResourceScope.ZONE}

    def test_a_mismatched_place_is_an_error(self, scopes) -> None:
        report = validate_diagram(
            diagram_with(EC2, "region"), known_icon_keys={EC2}, icon_scopes=scopes
        )
        assert not report["ok"]
        assert any("icon attribute" in e for e in report["errors"])

    def test_a_matching_place_passes(self, scopes) -> None:
        report = validate_diagram(
            diagram_with(EC2, "subnet-public"), known_icon_keys={EC2}, icon_scopes=scopes
        )
        assert report["errors"] == []

    def test_no_attribute_passes_anywhere(self) -> None:
        report = validate_diagram(
            diagram_with(EC2, "global"),
            known_icon_keys={EC2},
            icon_scopes={EC2: ResourceScope.ANY},
        )
        assert report["errors"] == []

    def test_a_generic_box_is_an_exception(self, scopes) -> None:
        """The generic box is the escape hatch, so anything goes inside it."""
        report = validate_diagram(
            diagram_with(EC2, "generic"), known_icon_keys={EC2}, icon_scopes=scopes
        )
        assert report["errors"] == []
