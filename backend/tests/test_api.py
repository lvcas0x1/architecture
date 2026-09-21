"""API tests. Never touches AWS."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx2 import ASGITransport, AsyncClient

from app.deps import get_client_factory
from app.models import Lifecycle, NormalizedResource, Section
from app.store import Store
from tests.conftest import FakeClient, fake_factory

EC2_ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc"
pytestmark = pytest.mark.anyio

RUNNING = {
    "Reservations": [
        {
            "Instances": [
                {
                    "InstanceId": "i-0abc",
                    "InstanceType": "m5.large",
                    "State": {"Name": "running"},
                    "VpcId": "vpc-01",
                    "SubnetId": "subnet-01",
                    "SecurityGroups": [],
                    "Tags": [{"Key": "Name", "Value": "ec2-ap1"}],
                }
            ]
        }
    ]
}


@pytest.fixture
async def client(settings):
    """A test client with only the AWS calls faked."""
    from app import main

    store = Store(settings)
    fake_client = FakeClient({"describe_instances": RUNNING})

    app = main.create_app()
    app.dependency_overrides[get_client_factory] = lambda: fake_factory(fake_client)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver", follow_redirects=True
    ) as test_client:
        test_client.store = store  # type: ignore[attr-defined]
        yield test_client


def seed_resource(store: Store, **over) -> NormalizedResource:
    payload = {
        "arn": EC2_ARN,
        "account_id": "123456789012",
        "region": "ap-northeast-1",
        "resource_type": "AWS::EC2::Instance",
        "resource_id": "i-0abc",
        "service": "EC2",
        "name": "ec2-ap1",
        "icon_key": "Architecture/Compute/Amazon-EC2",
        "lifecycle": Lifecycle.ACTIVE,
        "fetched_at": datetime(2026, 9, 19, tzinfo=UTC),
        "sections": [Section(title="Overview", rows=[])],
    }
    payload.update(over)
    resource = NormalizedResource(**payload)
    store.write_resource(resource)
    return resource


class TestHealth:
    async def test_reports_supported_types(self, client):
        body = (await client.get("/api/health")).json()
        assert body["status"] == "ok"
        assert "AWS::EC2::Instance" in body["supportedResourceTypes"]


class TestResources:
    async def test_get_returns_stored_json(self, client):
        seed_resource(client.store)
        response = await client.get(f"/api/resources/{EC2_ARN}")

        assert response.status_code == 200
        assert response.json()["name"] == "ec2-ap1"
        # Comes back in camelCase (the same shape the editor uses)
        assert "resourceId" in response.json()

    async def test_get_unknown_is_404_with_guidance(self, client):
        response = await client.get(f"/api/resources/{EC2_ARN}")
        assert response.status_code == 404
        assert "Refresh" in response.json()["detail"]

    async def test_refresh_fetches_and_persists(self, client):
        response = await client.post(f"/api/resources/{EC2_ARN}/refresh")

        assert response.status_code == 200
        assert response.json()["lifecycle"] == "active"
        # It is saved, so a later GET returns it
        assert (await client.get(f"/api/resources/{EC2_ARN}")).status_code == 200

    async def test_refresh_of_unsupported_type_is_422(self, client):
        response = await client.post(
            "/api/resources/arn:aws:kinesis:ap-northeast-1:123456789012:stream/s1/refresh"
        )
        assert response.status_code == 422
        assert "Unsupported" in response.json()["detail"]

    async def test_refresh_bulk(self, client):
        response = await client.post(
            "/api/resources/refresh-bulk",
            json={"arns": [EC2_ARN, "arn:aws:kinesis:ap-northeast-1:123456789012:stream/s1"]},
        )
        body = response.json()
        assert response.status_code == 200
        assert len(body["resources"]) == 1
        # Unsupported types go into errors; the run as a whole continues
        assert len(body["errors"]) == 1

    async def test_refresh_bulk_requires_arns(self, client):
        assert (
            await client.post("/api/resources/refresh-bulk", json={"arns": []})
        ).status_code == 422


class TestInventory:
    async def test_built_from_stored_resources(self, client):
        seed_resource(client.store)
        entries = (await client.get("/api/inventory")).json()["entries"]
        assert [e["arn"] for e in entries] == [EC2_ARN]

    async def test_empty_is_not_an_error(self, client):
        assert (await client.get("/api/inventory")).json()["entries"] == []


class TestDiagrams:
    diagram = {
        "schemaVersion": "1.0",
        "meta": {"title": "production"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "layout": {"mode": "manual"},
        "nodes": [],
        "edges": [],
    }

    async def test_put_then_get(self, client):
        assert (await client.put("/api/diagrams/prod", json=self.diagram)).status_code == 200
        assert (await client.get("/api/diagrams/prod")).json()["meta"]["title"] == "production"

    async def test_list(self, client):
        (await client.put("/api/diagrams/prod", json=self.diagram))
        items = (await client.get("/api/diagrams")).json()
        assert items[0]["id"] == "prod"
        assert items[0]["title"] == "production"

    async def test_get_missing_is_404(self, client):
        assert (await client.get("/api/diagrams/none")).status_code == 404

    async def test_delete(self, client):
        (await client.put("/api/diagrams/prod", json=self.diagram))
        assert (await client.delete("/api/diagrams/prod")).status_code == 204
        assert (await client.get("/api/diagrams/prod")).status_code == 404

    @pytest.mark.parametrize("bad", ["..%2Fescape", "../escape", "..", "%2E%2E%2Fx"])
    async def test_path_traversal_never_writes_outside_the_workspace(self, client, bad, settings):
        response = await client.put(f"/api/diagrams/{bad}", json=self.diagram)

        assert response.status_code >= 400
        # Nothing was created outside the workspace
        assert list(settings.diagrams_dir.glob("*")) == []
        assert not (settings.workspace.parent / "escape.arch.json").exists()

    async def test_schema_violation_is_rejected(self, client):
        bad = {**self.diagram, "nodes": [{"id": "n1", "type": "resource"}]}
        assert (await client.put("/api/diagrams/x", json=bad)).status_code == 422

    async def test_resource_edge_to_anchor_is_rejected(self, client):
        """The line rule holds on the server too."""
        bad = {
            **self.diagram,
            "nodes": [
                {
                    "id": "n1",
                    "type": "resource",
                    "position": {"x": 0, "y": 0},
                    "data": {"iconKey": "Architecture/Compute/Amazon-EC2"},
                },
                {"id": "a1", "type": "anchor", "position": {"x": 1, "y": 1}, "data": {}},
            ],
            "edges": [{"id": "e1", "source": "n1", "target": "a1", "data": {"kind": "resource"}}],
        }
        assert (await client.put("/api/diagrams/x", json=bad)).status_code == 422


class TestValidation:
    async def test_reports_unknown_arn(self, client):
        payload = {
            "schemaVersion": "1.0",
            "meta": {"title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "layout": {"mode": "manual"},
            "nodes": [
                {
                    "id": "g1",
                    "type": "group",
                    "position": {"x": 0, "y": 0},
                    "data": {"label": "vpc"},
                },
                {
                    "id": "n1",
                    "type": "resource",
                    "parentId": "g1",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "iconKey": "Architecture/Compute/Amazon-EC2",
                        "resourceRef": "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-missing",
                    },
                },
            ],
            "edges": [],
        }
        seed_resource(client.store)
        body = (await client.post("/api/diagrams/validate", json=payload)).json()

        assert body["ok"] is False
        assert any("not in the inventory" in e for e in body["errors"])

    async def test_warns_about_unlinked_nodes(self, client):
        payload = {
            "schemaVersion": "1.0",
            "meta": {"title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "layout": {"mode": "manual"},
            "nodes": [
                {
                    "id": "g1",
                    "type": "group",
                    "position": {"x": 0, "y": 0},
                    "data": {"label": "vpc"},
                },
                {
                    "id": "n1",
                    "type": "resource",
                    "parentId": "g1",
                    "position": {"x": 0, "y": 0},
                    "data": {"iconKey": "Architecture/Compute/Amazon-EC2"},
                },
            ],
            "edges": [],
        }
        body = (await client.post("/api/diagrams/validate", json=payload)).json()
        assert any("no JSON linked" in w for w in body["warnings"])


async def test_icons_endpoint_falls_back_to_placeholder(client):
    response = await client.get("/api/icons")
    assert response.status_code == 200
    assert len(response.json()["icons"]) > 0


async def test_invalid_resource_arn_is_a_client_error(client):
    assert (await client.get("/api/resources/not-an-arn")).status_code == 422


async def test_malformed_diagram_does_not_break_listing_or_export(client, settings):
    (settings.diagrams_dir / "broken.arch.json").write_text("[]", encoding="utf-8")
    assert (await client.get("/api/diagrams")).status_code == 200
    assert (await client.post("/api/diagrams/broken/export/html")).status_code == 422
