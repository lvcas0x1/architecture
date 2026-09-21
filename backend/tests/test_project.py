from datetime import UTC, datetime

from app.collector.bundle import normalize_records, record
from app.models import Diagram
from app.models.project import Evidence, GraphRelation, GraphResource, ResourceGraph
from app.project import accept_human, assess, new_project, regenerate, stable_id

ACCOUNT = "111111111111"
REGION = "ap-northeast-1"


def resource(identifier, kind="Instance", **kwargs):
    return GraphResource(
        arn=f"arn:aws:ec2:{REGION}:{ACCOUNT}:{identifier}",
        account_id=ACCOUNT,
        region=REGION,
        resource_type=f"AWS::EC2::{kind}",
        resource_id=identifier.split("/")[-1],
        **kwargs,
    )


def graph():
    vpc = resource("vpc/vpc-1", "VPC")
    subnet = resource(
        "subnet/subnet-1", "Subnet", vpc_ids=["vpc-1"], availability_zones=["ap-northeast-1a"]
    )
    ec2 = resource("instance/i-1", subnet_ids=["subnet-1"], vpc_ids=["vpc-1"])
    peer = resource("instance/i-2", subnet_ids=["subnet-1"], vpc_ids=["vpc-1"])
    evidence = Evidence(source="config", observed_at=datetime.now(UTC), locator="relationships")
    return ResourceGraph(
        resources=[vpc, subnet, ec2, peer],
        relations=[
            GraphRelation(
                source_arn=ec2.arn,
                target_arn=peer.arn,
                type="associated-with",
                category="association",
                evidence=[evidence],
            )
        ],
    )


def edit(project, node_id, **data):
    doc = project.diagram.model_dump(by_alias=True)
    next(n for n in doc["nodes"] if n["id"] == node_id)["data"].update(data)
    return Diagram.model_validate(doc)


def test_build_uses_actual_subnet_and_evidence():
    project = new_project(graph())
    instance = next(n for n in project.diagram.nodes if n.id == stable_id(graph().resources[2].arn))
    assert instance.parent_id == stable_id(graph().resources[1].arn)
    assert assess(project).ok
    assert assess(project).metrics["coverageRatio"] == 1


def test_human_label_survives_ai_id_changes_and_repeated_regeneration():
    project = new_project(graph())
    node_id = stable_id(project.graph.resources[2].arn)
    project = accept_human(project, edit(project, node_id, labelOverride="Human truth"))
    proposal = new_project(graph()).diagram.model_dump(by_alias=True)
    for n in proposal["nodes"]:
        if n["id"] == node_id:
            n["id"] = "changed-by-ai"
    for e in proposal["edges"]:
        if e["source"] == node_id:
            e["source"] = "changed-by-ai"
    project = regenerate(project, proposal=Diagram.model_validate(proposal))
    project = regenerate(project)
    assert (
        next(n for n in project.diagram.nodes if n.id == node_id).data.label_override
        == "Human truth"
    )


def test_human_deletions_do_not_return():
    project = new_project(graph())
    node_id = stable_id(project.graph.resources[2].arn)
    doc = project.diagram.model_dump(by_alias=True)
    doc["nodes"] = [n for n in doc["nodes"] if n["id"] != node_id]
    doc["edges"] = []
    project = accept_human(project, Diagram.model_validate(doc))
    for _ in range(3):
        project = regenerate(project)
        assert node_id not in {n.id for n in project.diagram.nodes}
        assert not project.diagram.edges


def test_fact_check_rejects_wrong_subnet_and_unsupported_ai_edge():
    data = graph()
    other = resource("subnet/subnet-2", "Subnet", vpc_ids=["vpc-1"])
    data.resources.append(other)
    project = new_project(data)
    doc = project.diagram.model_dump(by_alias=True)
    node_id = stable_id(data.resources[2].arn)
    next(n for n in doc["nodes"] if n["id"] == node_id)["parentId"] = stable_id(other.arn)
    doc["edges"][0]["data"]["relationType"] = "sends-traffic"
    report = assess(project, Diagram.model_validate(doc))
    assert {f.code for f in report.findings} >= {"SUBNET_MISMATCH", "UNVERIFIED_EDGE"}


def test_selected_view_keeps_dependencies():
    data = graph()
    project = new_project(data, selected=[data.resources[2].arn])
    refs = project.diagram.referenced_arns()
    assert refs == {r.arn for r in data.resources}
    assert assess(project).metrics["selectedResources"] == 1


def test_unknown_services_are_retained_and_relationships_resolved():
    raws = [
        record(
            "config",
            {
                "arn": r.arn,
                "accountId": ACCOUNT,
                "awsRegion": REGION,
                "resourceType": r.resource_type,
                "resourceId": r.resource_id,
                "relationships": [{"resourceId": "vpc-1", "name": "Is contained in Vpc"}]
                if r.resource_type == "AWS::EC2::Subnet"
                else [],
            },
            "test",
        )
        for r in graph().resources
    ]
    raws.append(
        record(
            "resource-explorer",
            {
                "Arn": "arn:aws:unknown:ap-northeast-1:111111111111:thing/one",
                "OwningAccountId": ACCOUNT,
                "ResourceType": "unknown:thing",
            },
            "test",
        )
    )
    result = normalize_records(raws)
    assert len(result.resources) == 5
    assert result.relations[0].type == "in-vpc"
    assert any(r.resource_type == "unknown:thing" for r in result.resources)


def test_multi_subnet_resource_is_not_arbitrarily_assigned_to_one():
    data = graph()
    data.resources[2].subnet_ids = ["subnet-1", "subnet-2"]
    project = new_project(data)
    instance = next(n for n in project.diagram.nodes if n.id == stable_id(data.resources[2].arn))
    assert instance.parent_id == stable_id(data.resources[0].arn)


def test_deleted_resource_cannot_return_under_a_new_id_after_collection_changes():
    project = new_project(graph())
    arn = project.graph.resources[2].arn
    node_id = stable_id(arn)
    doc = project.diagram.model_dump(by_alias=True)
    doc["nodes"] = [n for n in doc["nodes"] if n["id"] != node_id]
    doc["edges"] = []
    project = accept_human(project, Diagram.model_validate(doc))
    project = regenerate(project, proposal=project.diagram)
    proposal = new_project(graph()).diagram.model_dump(by_alias=True)
    for node in proposal["nodes"]:
        if node["id"] == node_id:
            node["id"] = "new-ai-id"
    proposal["edges"] = []
    regenerated = regenerate(project, proposal=Diagram.model_validate(proposal))
    assert arn not in regenerated.diagram.referenced_arns()


def test_deleted_connection_cannot_return_with_changed_id_or_type():
    project = new_project(graph())
    doc = project.diagram.model_dump(by_alias=True)
    doc["edges"] = []
    project = accept_human(project, Diagram.model_validate(doc))
    project = regenerate(project, proposal=project.diagram)
    proposal = new_project(graph()).diagram.model_dump(by_alias=True)
    proposal["edges"][0]["id"] = "renamed"
    proposal["edges"][0]["data"]["relationType"] = "new-type"
    result = regenerate(project, proposal=Diagram.model_validate(proposal))
    assert not result.diagram.edges


def test_missing_collection_is_not_resource_deletion():
    project = new_project(graph())
    updated = regenerate(project, ResourceGraph())
    assert updated.diagram.referenced_arns() == project.diagram.referenced_arns()
    assert any(c.source == "merge" for c in updated.graph.coverage)


def test_human_position_survives_proposed_coordinates():
    project = new_project(graph())
    doc = project.diagram.model_dump(by_alias=True)
    for node in doc["nodes"]:
        node["position"] = {"x": 40, "y": 80}
    doc["layout"]["mode"] = "manual"
    project.diagram = Diagram.model_validate(doc)
    doc["nodes"][-1]["position"] = {"x": 432, "y": 765}
    project = accept_human(project, Diagram.model_validate(doc))
    proposal = project.diagram.model_dump(by_alias=True)
    proposal["nodes"][-1]["position"] = {"x": 0, "y": 0}
    updated = regenerate(project, proposal=Diagram.model_validate(proposal))
    assert updated.diagram.nodes[-1].position.x == 432
    assert updated.diagram.nodes[-1].position.y == 765


def test_cli_regeneration_updates_same_file_and_rejects_invalid_proposal(
    tmp_path, monkeypatch, capsys
):
    import sys

    from scripts.architecture import main

    project = new_project(graph())
    node_id = stable_id(project.graph.resources[2].arn)
    project = accept_human(project, edit(project, node_id, labelOverride="Approved"))
    path = tmp_path / "project.architecture.json"
    path.write_text(project.model_dump_json())
    monkeypatch.setattr(sys, "argv", ["architecture", "regenerate", str(path)])
    assert main() == 0
    from app.models.project import Project

    loaded = Project.model_validate_json(path.read_text())
    assert (
        next(n for n in loaded.diagram.nodes if n.id == node_id).data.label_override == "Approved"
    )
    unchanged = path.read_bytes()
    proposal = loaded.diagram.model_dump(by_alias=True)
    proposal["edges"][0]["data"]["relationType"] = "invented-traffic"
    draft = tmp_path / "draft.json"
    draft.write_text(Diagram.model_validate(proposal).model_dump_json())
    monkeypatch.setattr(
        sys, "argv", ["architecture", "regenerate", str(path), "--proposal", str(draft)]
    )
    assert main() == 1
    assert path.read_bytes() == unchanged
    assert "UNVERIFIED_EDGE" in capsys.readouterr().out


def test_cli_generates_context_views_chunks_and_detail(tmp_path, monkeypatch, capsys):
    import json
    import sys

    from scripts.architecture import main

    inventory = tmp_path / "inventory.json"
    inventory.write_text(graph().model_dump_json())
    project = tmp_path / "project.architecture.json"
    for view in ("overview", "network", "application", "security"):
        monkeypatch.setattr(
            sys,
            "argv",
            ["architecture", "generate", str(inventory), "--out", str(project), "--view", view],
        )
        assert main() == 0
        assert json.loads(project.read_text())["view"] == view
    monkeypatch.setattr(
        sys, "argv", ["architecture", "generate", str(inventory), "--out", str(project)]
    )
    assert main() == 0
    context = tmp_path / "context.json"
    monkeypatch.setattr(
        sys, "argv", ["architecture", "context", str(project), "--out", str(context)]
    )
    assert main() == 0
    assert json.loads(context.read_text())["validation"]["ok"]
    monkeypatch.setattr(
        sys, "argv", ["architecture", "inspect", str(project), "--arn", graph().resources[0].arn]
    )
    assert main() == 0
    assert json.loads(capsys.readouterr().out)["resourceId"] == "vpc-1"
    monkeypatch.setattr(
        sys,
        "argv",
        ["architecture", "generate", str(inventory), "--out", str(project), "--chunk-size", "2"],
    )
    assert main() == 0
    assert len(list(tmp_path.glob("project.architecture-*.json"))) == 2
