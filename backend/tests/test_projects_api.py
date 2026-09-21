import pytest
from httpx2 import ASGITransport, AsyncClient

from app.models.project import Project
from app.project import stable_id
from tests.test_project import graph

pytestmark = pytest.mark.anyio


async def test_import_human_save_regenerate_and_validate(settings):
    from app.main import create_app

    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/projects/import", json={"graph": graph().model_dump(mode="json")}
        )
        assert response.status_code == 200
        project = response.json()
        diagram = Project.model_validate(project).diagram.model_dump(mode="json")
        target = stable_id(graph().resources[2].arn)
        next(n for n in diagram["nodes"] if n["id"] == target)["data"]["labelOverride"] = "Approved"
        response = await client.post(
            "/api/projects/human", json={"project": project, "diagram": diagram}
        )
        assert response.status_code == 200
        response = await client.post("/api/projects/regenerate", json={"project": response.json()})
        assert response.status_code == 200
        regenerated = response.json()
        assert (
            next(n for n in regenerated["diagram"]["nodes"] if n["id"] == target)["data"][
                "labelOverride"
            ]
            == "Approved"
        )
        report = (await client.post("/api/projects/validate", json=regenerated)).json()
        assert report["ok"]
        assert report["metrics"]["humanProtectedFields"] == 1
        context = (await client.post("/api/projects/context", json=regenerated)).json()
        assert context["humanAuthority"]["protected"]
        proposal = regenerated["diagram"]
        proposal["edges"][0]["data"]["relationType"] = "unverified"
        rejected = await client.post(
            "/api/projects/regenerate", json={"project": regenerated, "proposal": proposal}
        )
        assert rejected.status_code == 422
        assert rejected.json()["detail"]["findings"][0]["code"] == "UNVERIFIED_EDGE"


async def test_import_rejects_duplicate_resources(settings):
    from app.main import create_app

    payload = graph().model_dump(mode="json")
    payload["resources"].append(payload["resources"][0])
    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as client:
        response = await client.post("/api/projects/import", json={"graph": payload})
        assert response.status_code == 422
