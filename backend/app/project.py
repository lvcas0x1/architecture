from __future__ import annotations

import hashlib
from copy import deepcopy
from datetime import UTC, datetime

from app.models import Diagram
from app.models.diagram import OVERLAPPABLE_GROUP_STYLES
from app.models.project import (
    Coverage,
    Finding,
    GraphResource,
    HumanAuthority,
    Project,
    QualityReport,
    ResourceGraph,
)
from app.validation import load_known_icon_keys


def stable_id(value: str) -> str:
    return "n-" + hashlib.sha256(value.encode()).hexdigest()[:24]


def scope_for(resource: GraphResource) -> str:
    if resource.resource_type.startswith(("AWS::IAM::", "AWS::CloudFront::", "AWS::Route53::")):
        return "global"
    if resource.resource_type.startswith(
        ("AWS::Lambda::", "AWS::S3::", "AWS::DynamoDB::", "AWS::SQS::")
    ):
        return "region"
    if resource.region in ("", "global", "aws-global"):
        return "global"
    if len(resource.subnet_ids) == 1:
        return "subnet"
    if len(resource.availability_zones) == 1:
        return "zone"
    if len(resource.vpc_ids) == 1:
        return "vpc"
    return "region"


def build_diagram(
    graph: ResourceGraph, view: str = "overview", selected: list[str] | None = None
) -> Diagram:
    resources = {r.arn: r for r in graph.resources}
    by_key = {(r.account_id, r.region, r.resource_id): r for r in graph.resources}
    seeds = set(selected or resources)
    if selected is None:
        if view == "network":
            seeds = {
                a
                for a, r in resources.items()
                if r.resource_type.startswith(("AWS::EC2::", "AWS::ElasticLoadBalancing"))
            }
        elif view == "security":
            seeds = {
                a
                for a, r in resources.items()
                if any(
                    s in r.resource_type
                    for s in ("IAM", "SecurityGroup", "NetworkAcl", "KMS", "WAF")
                )
            }
        elif view == "application":
            seeds = {
                a
                for a, r in resources.items()
                if not any(
                    s in r.resource_type
                    for s in ("::VPC", "::Subnet", "SecurityGroup", "RouteTable", "NetworkAcl")
                )
            }
    unknown = seeds - resources.keys()
    if unknown:
        raise ValueError(f"Unknown selected ARNs: {sorted(unknown)}")
    included = set(seeds)
    for rel in graph.relations:
        if rel.source_arn in seeds:
            included.add(rel.target_arn)
        if rel.target_arn in seeds:
            included.add(rel.source_arn)
    nodes: dict[str, dict] = {}

    def group(key, label, style, parent=None, ref=None):
        node_id = stable_id(key)
        nodes.setdefault(
            node_id,
            {
                "id": node_id,
                "type": "group",
                "parentId": parent,
                "data": {"label": label, "style": style, "resourceRef": ref, "origin": "ai"},
            },
        )
        return node_id

    cloud = group("cloud", "AWS Cloud", "global")
    visiting: set[str] = set()

    def place(r: GraphResource):
        node_id = stable_id(r.arn)
        if node_id in nodes:
            return node_id
        if r.arn in visiting:
            raise ValueError(f"Cyclic containment: {r.arn}")
        visiting.add(r.arn)
        account = group(f"account:{r.account_id}", r.account_id, "account", cloud)
        parent = account
        if scope_for(r) != "global":
            parent = group(f"region:{r.account_id}:{r.region}", r.region, "region", account)
        scope = scope_for(r)
        if (
            scope not in ("global", "region")
            and len(r.vpc_ids) == 1
            and r.resource_type != "AWS::EC2::VPC"
        ):
            vpc = by_key.get((r.account_id, r.region, r.vpc_ids[0]))
            if vpc and vpc.resource_type == "AWS::EC2::VPC":
                parent = place(vpc)
        if (
            scope in ("zone", "subnet")
            and len(r.availability_zones) == 1
            and r.resource_type != "AWS::EC2::VPC"
        ):
            az = r.availability_zones[0]
            parent = group(f"az:{parent}:{az}", az, "az", parent)
        if scope == "subnet" and len(r.subnet_ids) == 1 and r.resource_type != "AWS::EC2::Subnet":
            subnet = by_key.get((r.account_id, r.region, r.subnet_ids[0]))
            if subnet and subnet.resource_type == "AWS::EC2::Subnet":
                parent = place(subnet)
        if r.resource_type in ("AWS::EC2::VPC", "AWS::EC2::Subnet"):
            # Public/private is not inferred from public-IP auto-assignment.
            style = (
                "vpc"
                if r.resource_type.endswith("::VPC")
                else (
                    f"subnet-{r.subnet_visibility}"
                    if r.subnet_visibility != "unknown"
                    else "generic"
                )
            )
            group(r.arn, r.name or r.resource_id, style, parent, r.arn)
        else:
            nodes[node_id] = {
                "id": node_id,
                "type": "resource",
                "parentId": parent,
                "data": {
                    "iconKey": r.icon_key,
                    "resourceRef": r.arn,
                    "labelOverride": r.name or r.resource_id,
                    "origin": "ai",
                },
            }
        visiting.remove(r.arn)
        return node_id

    for arn in sorted(included):
        if arn in resources:
            place(resources[arn])
        else:
            boundary = group("boundary", "Outside collected scope", "generic", cloud)
            nodes[stable_id(arn)] = {
                "id": stable_id(arn),
                "type": "resource",
                "parentId": boundary,
                "data": {
                    "resourceRef": arn,
                    "iconKey": "Resource/General-Icons/Generic-Application",
                    "labelOverride": arn.rsplit(":", 1)[-1],
                    "origin": "ai",
                },
            }
    edges = []
    seen = set()
    for rel in graph.relations:
        source, target = stable_id(rel.source_arn), stable_id(rel.target_arn)
        if source not in nodes or target not in nodes or rel.category == "containment":
            continue
        key = f"{source}:{target}:{rel.type}"
        if key in seen:
            continue
        seen.add(key)
        edges.append(
            {
                "id": stable_id(key),
                "source": source,
                "target": target,
                "data": {
                    "relationType": rel.type,
                    "label": rel.type,
                    "line": "dashed" if rel.category == "inferred" else "solid",
                    "origin": "ai",
                },
            }
        )
    # Remove unused synthetic containers created while resolving subnet parents.
    while True:
        parents = {n.get("parentId") for n in nodes.values()}
        empty = [
            k
            for k, n in nodes.items()
            if n["type"] == "group" and not n["data"].get("resourceRef") and k not in parents
        ]
        if not empty:
            break
        for key in empty:
            del nodes[key]
    return Diagram.model_validate(
        {
            "meta": {"title": f"AWS {view}", "generator": "ai"},
            "layout": {"mode": "auto"},
            "nodes": list(nodes.values()),
            "edges": edges,
        }
    )


def new_project(graph: ResourceGraph, view="overview", selected=None) -> Project:
    diagram = build_diagram(graph, view, selected)
    return Project(
        graph=graph,
        diagram=diagram,
        authority=HumanAuthority(baseline=diagram),
        view=view,
        selected_arns=selected or [],
    )


def _leaves(value, prefix=""):
    result = {}
    for key, item in value.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(item, dict) and item:
            result.update(_leaves(item, path))
        else:
            result[path] = item
    return result


def _assign(target, path, value):
    keys = path.split(".")
    for key in keys[:-1]:
        if not isinstance(target.get(key), dict):
            target[key] = {}
        target = target[key]
    target[keys[-1]] = deepcopy(value)


def accept_human(project: Project, diagram: Diagram) -> Project:
    authority = project.authority.model_copy(deep=True)
    current = diagram.model_dump(mode="json", by_alias=True)
    previous = project.diagram.model_dump(mode="json", by_alias=True)
    current_refs = diagram.referenced_arns()
    authority.deleted_refs = sorted(
        (set(authority.deleted_refs) | (project.diagram.referenced_arns() - current_refs))
        - current_refs
    )

    def connections(doc):
        refs = {n["id"]: n["data"].get("resourceRef") or n["id"] for n in doc["nodes"]}
        return {f"{refs[e['source']]}|{refs[e['target']]}" for e in doc["edges"]}

    authority.deleted_connections = sorted(
        (set(authority.deleted_connections) | (connections(previous) - connections(current)))
        - connections(current)
    )
    for collection in ("nodes", "edges"):
        before = {n["id"]: n for n in previous[collection]}
        after = {n["id"]: n for n in current[collection]}
        deleted = authority.deleted_nodes if collection == "nodes" else authority.deleted_edges
        deleted[:] = sorted((set(deleted) | (before.keys() - after.keys())) - after.keys())
        for key, node in after.items():
            token = f"{collection}:{key}"
            changes = (
                ["*"]
                if key not in before
                else [p for p, v in _leaves(node).items() if _leaves(before[key]).get(p) != v]
            )
            if changes:
                authority.protected[token] = sorted(
                    set(authority.protected.get(token, []) + changes)
                )
    for section in ("meta", "layout", "viewport"):
        changes = [
            p
            for p, v in _leaves(current[section]).items()
            if _leaves(previous[section]).get(p) != v
            and not (section == "meta" and p == "updatedAt")
        ]
        if changes:
            authority.protected[section] = sorted(
                set(authority.protected.get(section, []) + changes)
            )
    return project.model_copy(
        update={"diagram": diagram, "authority": authority, "revision": project.revision + 1}
    )


def regenerate(
    project: Project, graph: ResourceGraph | None = None, proposal: Diagram | None = None
) -> Project:
    if graph is not None:
        graph = graph.model_copy(deep=True)
        found = {r.arn for r in graph.resources}
        missing = [r for r in project.graph.resources if r.arn not in found]
        graph.resources.extend(missing)
        if missing:
            graph.coverage.append(
                Coverage(
                    source="merge",
                    profile="",
                    status="partial",
                    message=(
                        f"Retained {len(missing)} resources absent from the new collection; "
                        "absence is not deletion"
                    ),
                )
            )
    else:
        graph = project.graph
    proposal = proposal or build_diagram(graph, project.view, project.selected_arns or None)
    result = proposal.model_dump(mode="json", by_alias=True)
    for item in result["nodes"] + result["edges"]:
        item["data"]["origin"] = "ai"
    current = project.diagram.model_dump(mode="json", by_alias=True)
    authority = project.authority
    # Match existing resources even if an AI renames node IDs.
    old_refs = {
        n["data"].get("resourceRef"): n["id"]
        for n in current["nodes"]
        if n["data"].get("resourceRef")
    }
    baseline = authority.baseline.model_dump(mode="json", by_alias=True)
    old_refs.update(
        {
            n["data"].get("resourceRef"): n["id"]
            for n in baseline["nodes"]
            if n["id"] in authority.deleted_nodes and n["data"].get("resourceRef")
        }
    )
    remap = {n["id"]: old_refs.get(n["data"].get("resourceRef"), n["id"]) for n in result["nodes"]}
    for node in result["nodes"]:
        node["id"] = remap[node["id"]]
        node["parentId"] = remap.get(node["parentId"], node["parentId"])
    old_edges = {
        (e["source"], e["target"], e["data"]["relationType"]): e["id"]
        for e in baseline["edges"] + current["edges"]
    }
    for edge in result["edges"]:
        edge["source"] = remap.get(edge["source"], edge["source"])
        edge["target"] = remap.get(edge["target"], edge["target"])
        edge["id"] = old_edges.get(
            (edge["source"], edge["target"], edge["data"]["relationType"]), edge["id"]
        )
    for collection, deleted in (
        ("nodes", authority.deleted_nodes),
        ("edges", authority.deleted_edges),
    ):
        items = {
            n["id"]: n
            for n in result[collection]
            if n["id"] not in deleted
            and not (
                collection == "nodes" and n["data"].get("resourceRef") in authority.deleted_refs
            )
        }
        for item in current[collection]:
            paths = authority.protected.get(f"{collection}:{item['id']}", [])
            if not paths:
                continue
            target = items.setdefault(item["id"], deepcopy(item))
            if collection == "nodes":
                target["type"] = item["type"]
                if "resourceRef" in item["data"]:
                    target["data"]["resourceRef"] = item["data"]["resourceRef"]
            if "*" in paths:
                items[item["id"]] = deepcopy(item)
            else:
                leaves = _leaves(item)
                for path in paths:
                    if path in leaves:
                        _assign(target, path, leaves[path])
        result[collection] = list(items.values())
    # Preserve ancestors required by human edits, including their original placement.
    nodes = {n["id"]: n for n in result["nodes"]}
    old_nodes = {n["id"]: n for n in current["nodes"]}
    for edge in result["edges"]:
        if authority.protected.get(f"edges:{edge['id']}"):
            for endpoint in (edge["source"], edge["target"]):
                if (
                    endpoint not in nodes
                    and endpoint in old_nodes
                    and endpoint not in authority.deleted_nodes
                ):
                    nodes[endpoint] = deepcopy(old_nodes[endpoint])
    pending = list(nodes.values())
    while pending:
        parent = pending.pop().get("parentId")
        if (
            parent
            and parent not in nodes
            and parent in old_nodes
            and parent not in authority.deleted_nodes
        ):
            nodes[parent] = deepcopy(old_nodes[parent])
            pending.append(nodes[parent])
    # A human-deleted container also excludes newly proposed descendants.
    while True:
        dangling = [k for k, n in nodes.items() if n.get("parentId") and n["parentId"] not in nodes]
        if not dangling:
            break
        for key in dangling:
            del nodes[key]
    result["nodes"] = list(nodes.values())
    refs = {key: n["data"].get("resourceRef") or key for key, n in nodes.items()}
    result["edges"] = [
        e
        for e in result["edges"]
        if e["source"] in nodes
        and e["target"] in nodes
        and f"{refs[e['source']]}|{refs[e['target']]}" not in authority.deleted_connections
    ]
    for section in ("meta", "layout", "viewport"):
        leaves = _leaves(current[section])
        for path in authority.protected.get(section, []):
            if path in leaves:
                _assign(result[section], path, leaves[path])
    geometry_protected = any(
        key.startswith("nodes:")
        and any(
            path == "*" or path in ("parentId", "locked") or path.startswith(("position", "size"))
            for path in paths
        )
        for key, paths in authority.protected.items()
    ) or "mode" in authority.protected.get("layout", [])
    if project.diagram.layout.mode == "manual" and geometry_protected:
        result["layout"]["mode"] = "manual"
        for index, node in enumerate(result["nodes"]):
            old = old_nodes.get(node["id"], {})
            if node["position"] is None:
                node["position"] = old.get("position") or {"x": 48, "y": 64 + index * 160}
            if node["size"] is None:
                node["size"] = old.get("size")
    merged = Diagram.model_validate(result)
    return project.model_copy(
        update={
            "graph": graph,
            "diagram": merged,
            "authority": authority.model_copy(update={"baseline": proposal}),
            "revision": project.revision + 1,
        }
    )


def assess(project: Project, diagram: Diagram | None = None) -> QualityReport:
    diagram = diagram or project.diagram
    findings: list[Finding] = []
    resources = {r.arn: r for r in project.graph.resources}
    boundaries = {
        arn
        for relation in project.graph.relations
        for arn in (relation.source_arn, relation.target_arn)
    }
    nodes = {n.id: n for n in diagram.nodes}
    refs = {n.id: getattr(n.data, "resource_ref", None) for n in diagram.nodes}

    def protected_label(node_id):
        paths = project.authority.protected.get(f"nodes:{node_id}", [])
        return "*" in paths or "data.label" in paths

    def issue(code, message, node=None, expected=None, severity="error"):
        if node and (
            project.authority.protected.get(f"nodes:{node}")
            or project.authority.protected.get(f"edges:{node}")
        ):
            severity = "warning"
        findings.append(
            Finding(code=code, message=message, node_id=node, expected=expected, severity=severity)
        )

    for node in diagram.nodes:
        ref = refs[node.id]
        if not ref:
            continue
        resource = resources.get(ref)
        if resource is None:
            if ref in boundaries or node.data.origin == "user":
                issue(
                    "OUTSIDE_SCOPE",
                    "Resource is outside collected scope",
                    node.id,
                    severity="warning",
                )
            else:
                issue(
                    "UNKNOWN_RESOURCE",
                    "Resource has no inventory or relationship evidence",
                    node.id,
                    ref,
                )
            continue
        parent = nodes.get(node.parent_id)
        ancestors = []
        while parent:
            ancestors.append(parent)
            parent = nodes.get(parent.parent_id)
        styles = {a.data.style for a in ancestors if a.type == "group"}
        if "account" not in styles:
            issue(
                "MISSING_ACCOUNT",
                "Resource needs an account container",
                node.id,
                resource.account_id,
            )
        if scope_for(resource) != "global" and "region" not in styles:
            issue("MISSING_REGION", "Resource needs a region container", node.id, resource.region)
        if scope_for(resource) == "global" and "region" in styles:
            issue("GLOBAL_IN_REGION", "Global resource is inside a region", node.id)
        if node.type == "resource" and node.data.icon_key != resource.icon_key:
            issue(
                "ICON_MISMATCH",
                "Icon differs from the resource type",
                node.id,
                resource.icon_key,
                severity="warning",
            )
        for az in (a for a in ancestors if a.type == "group" and a.data.style == "az"):
            if (
                resource.availability_zones
                and az.data.label not in resource.availability_zones
                and not protected_label(az.id)
            ):
                issue(
                    "AZ_MISMATCH",
                    "AZ does not match inventory",
                    node.id,
                    resource.availability_zones,
                )
        if scope_for(resource) == "subnet" and resource.resource_type != "AWS::EC2::Subnet":
            expected = {
                r.arn
                for r in resources.values()
                if r.resource_id in resource.subnet_ids
                and r.account_id == resource.account_id
                and r.region == resource.region
                and r.resource_type == "AWS::EC2::Subnet"
            }
            if expected and not expected.intersection(refs[a.id] for a in ancestors):
                issue(
                    "MISSING_SUBNET",
                    "Resource is outside its known subnet",
                    node.id,
                    sorted(expected),
                )
        for ancestor in ancestors:
            if ancestor.type != "group":
                continue
            style = ancestor.data.style
            if (
                style == "account"
                and ancestor.id == stable_id(f"account:{resource.account_id}")
                and resource.account_id not in ancestor.data.label
                and not protected_label(ancestor.id)
            ):
                issue(
                    "ACCOUNT_LABEL_MISMATCH",
                    "Account label contradicts inventory",
                    ancestor.id,
                    resource.account_id,
                )
            if (
                style == "region"
                and ancestor.id == stable_id(f"region:{resource.account_id}:{resource.region}")
                and resource.region not in ancestor.data.label
                and not protected_label(ancestor.id)
            ):
                issue(
                    "REGION_LABEL_MISMATCH",
                    "Region label contradicts inventory",
                    ancestor.id,
                    resource.region,
                )
            if (
                style == "account"
                and ancestor.id != stable_id(f"account:{resource.account_id}")
                and ancestor.data.label != resource.account_id
            ):
                issue(
                    "ACCOUNT_MISMATCH",
                    "Account does not match inventory",
                    node.id,
                    resource.account_id,
                )
            if (
                style == "region"
                and ancestor.id != stable_id(f"region:{resource.account_id}:{resource.region}")
                and ancestor.data.label != resource.region
            ):
                issue(
                    "REGION_MISMATCH",
                    "Region does not match inventory",
                    node.id,
                    resource.region,
                )
            owner = resources.get(refs[ancestor.id])
            if (
                owner
                and owner.resource_type == "AWS::EC2::VPC"
                and resource.vpc_ids
                and owner.resource_id not in resource.vpc_ids
            ):
                issue("VPC_MISMATCH", "VPC does not match inventory", node.id, resource.vpc_ids)
            if (
                owner
                and owner.resource_type == "AWS::EC2::Subnet"
                and resource.subnet_ids
                and owner.resource_id not in resource.subnet_ids
            ):
                issue(
                    "SUBNET_MISMATCH",
                    "Subnet does not match inventory",
                    node.id,
                    resource.subnet_ids,
                )
        if resource.evidence and all(
            (datetime.now(UTC) - e.observed_at).total_seconds() > 86400 for e in resource.evidence
        ):
            issue("STALE_RESOURCE", "Evidence is older than 24 hours", node.id, severity="warning")
    supported = {
        (r.source_arn, r.target_arn, r.type)
        for r in project.graph.relations
        if r.evidence and r.category != "inferred"
    }
    known_icons = load_known_icon_keys()
    if known_icons is not None:
        for key in sorted(diagram.referenced_icon_keys() - known_icons):
            issue("UNKNOWN_ICON", "Icon is not in the catalog", expected=key)
    unsupported = 0
    for edge in diagram.edges:
        if (refs[edge.source], refs[edge.target], edge.data.relation_type) not in supported:
            unsupported += 1
            issue(
                "UNVERIFIED_EDGE",
                "No collected evidence supports this connection",
                edge.id,
                severity="warning" if edge.data.origin == "user" else "error",
            )
    wanted = set(project.selected_arns or resources) - set(project.authority.deleted_refs)
    if project.view != "overview" and not project.selected_arns:
        wanted = build_diagram(project.graph, project.view).referenced_arns() & resources.keys()
    represented = set(refs.values()) & wanted
    missing = wanted - represented
    if missing:
        issue("MISSING_RESOURCES", "Selected resources are missing", expected=sorted(missing))
    for coverage in project.graph.coverage:
        if coverage.status != "complete":
            issue("INCOMPLETE_COLLECTION", coverage.message or coverage.status, severity="warning")
    overlaps = 0
    for index, left in enumerate(diagram.nodes):
        if not left.position or not left.size:
            continue
        for right in diagram.nodes[index + 1 :]:
            if not right.position or not right.size or left.parent_id != right.parent_id:
                continue
            if (
                left.type == right.type == "group"
                and frozenset((left.data.style, right.data.style)) in OVERLAPPABLE_GROUP_STYLES
            ):
                continue
            if (
                left.position.x < right.position.x + right.size.width
                and right.position.x < left.position.x + left.size.width
                and left.position.y < right.position.y + right.size.height
                and right.position.y < left.position.y + left.size.height
            ):
                overlaps += 1
    if overlaps:
        issue("OVERLAP", f"{overlaps} sibling bounds overlap", severity="warning")
    return QualityReport(
        ok=not any(f.severity == "error" for f in findings),
        findings=findings,
        metrics={
            "selectedResources": len(wanted),
            "representedResources": len(represented),
            "coverageRatio": len(represented) / len(wanted) if wanted else 1,
            "unverifiedEdges": unsupported,
            "overlappingPairs": overlaps,
            "humanProtectedFields": sum(len(v) for v in project.authority.protected.values()),
            "humanEditedNodes": sum(k.startswith("nodes:") for k in project.authority.protected),
            "humanDeletedResources": len(project.authority.deleted_refs),
        },
    )


def ai_context(project: Project):
    selected = project.diagram.referenced_arns()
    resources = [r for r in project.graph.resources if r.arn in selected]
    relations = [
        r for r in project.graph.relations if r.source_arn in selected and r.target_arn in selected
    ]
    return {
        "instructions": (
            "Return diagram JSON only. Use collected evidence; associations are not traffic. "
            "Human-protected fields and deleted resources/connections are immutable. "
            "Submit through regenerate; validate and correct until ok. "
            "Never replace the project file."
        ),
        "schema": Diagram.model_json_schema(by_alias=True),
        "diagram": project.diagram.model_dump(mode="json"),
        "resources": [
            r.model_dump(mode="json", exclude={"detail", "parameters"}) for r in resources
        ],
        "relations": [r.model_dump(mode="json") for r in relations],
        "humanAuthority": project.authority.model_dump(mode="json", exclude={"baseline"}),
        "validation": assess(project).model_dump(mode="json"),
    }
