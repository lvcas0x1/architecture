from __future__ import annotations

import json
from datetime import UTC, datetime

from pydantic import AwareDatetime, TypeAdapter

from app.aws.arn import parse_arn
from app.aws.profiles import profile_for_arn_key, profile_for_type
from app.models import NormalizedResource, Row, Section, Tag
from app.models.project import Coverage, Evidence, GraphRelation, GraphResource, ResourceGraph


def _values(value, names):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in names and isinstance(item, str) and item:
                found.append(item)
            if key.lower() in names and isinstance(item, list):
                found.extend(v for v in item if isinstance(v, str) and v)
            found.extend(_values(item, names))
    elif isinstance(value, list):
        for item in value:
            found.extend(_values(item, names))
    return sorted(set(found))


def normalize_records(records: list[dict], coverage=None) -> ResourceGraph:
    resources: dict[str, GraphResource] = {}
    relationships = []
    identities = {}
    coverage = list(coverage or [])
    timestamp = TypeAdapter(AwareDatetime)
    records = sorted(
        records,
        key=lambda r: timestamp.validate_python(
            r["data"].get("configurationItemCaptureTime") or r["observedAt"]
        ),
    )
    for record in records:
        raw = record["data"]
        source = record["source"]
        arn = raw.get("arn") or raw.get("Arn")
        if not arn:
            coverage.append(
                Coverage(
                    source=source,
                    profile="",
                    status="partial",
                    message=f"Missing ARN: {raw.get('resourceId', 'unknown')}",
                )
            )
            continue
        parsed = parse_arn(arn)
        kind = raw.get("resourceType") or raw.get("ResourceType") or "AWS::Unknown::Unknown"
        profile = profile_for_type(kind) or profile_for_arn_key(parsed.lookup_key)
        evidence = Evidence(
            source=source,
            observed_at=raw.get("configurationItemCaptureTime") or record["observedAt"],
            locator=record.get("locator", source),
        )
        configuration = raw.get("configuration") or {}
        if isinstance(configuration, str):
            configuration = json.loads(configuration)
        tags = raw.get("tags") or {}
        if isinstance(tags, list):
            tags = {
                t.get("key", t.get("Key", "")): str(t.get("value", t.get("Value", "")))
                for t in tags
            }
        if source == "resource-explorer":
            for prop in raw.get("Properties", []):
                if prop.get("Name") == "tags":
                    tags.update({t["Key"]: t.get("Value", "") for t in prop.get("Data", [])})
        resource = GraphResource(
            arn=arn,
            account_id=raw.get("accountId") or raw.get("OwningAccountId") or parsed.account_id,
            region=raw.get("awsRegion") or raw.get("Region") or parsed.region or "global",
            resource_type=profile.resource_type if profile else kind,
            resource_id=raw.get("resourceId") or parsed.resource_id,
            name=raw.get("resourceName") or tags.get("Name", ""),
            tags=tags,
            parameters=configuration,
            availability_zones=_values(
                {"availabilityZone": raw.get("availabilityZone"), "configuration": configuration},
                {"availabilityzone", "availabilityzones", "secondaryavailabilityzone", "zonename"},
            ),
            vpc_ids=_values(configuration, {"vpcid"}),
            subnet_ids=_values(configuration, {"subnetid", "subnetids", "subnetidentifier"}),
            evidence=[evidence],
            **({"icon_key": profile.icon_key} if profile else {}),
        )
        previous = resources.get(arn)
        if previous:
            resource.evidence = previous.evidence + resource.evidence
            if source == "resource-explorer":
                for key in ("availability_zones", "vpc_ids", "subnet_ids"):
                    setattr(resource, key, getattr(previous, key))
            resource.name = resource.name or previous.name
            resource.parameters = resource.parameters or previous.parameters
        resources[arn] = resource
        identities[(resource.account_id, resource.region, resource.resource_id)] = arn
        for relation in raw.get("relationships") or []:
            relationships.append((resource, relation, evidence))
    by_id = {(r.account_id, r.region, r.resource_id): r for r in resources.values()}
    by_id.update({key: resources[arn] for key, arn in identities.items()})
    relations = []
    for observed_resource, raw, evidence in relationships:
        resource = resources[observed_resource.arn]
        # Do not apply older membership evidence over a newer configuration snapshot.
        latest = max(e.observed_at for e in resource.evidence if e.source != "resource-explorer")
        older = evidence.observed_at < latest
        target = resources.get(raw.get("resourceId")) or by_id.get(
            (resource.account_id, resource.region, raw.get("resourceId"))
        )
        if not target:
            # Unresolved IDs stay visible as coverage findings rather than invented ARNs.
            coverage.append(
                Coverage(
                    source="config",
                    profile="",
                    account_id=resource.account_id,
                    region=resource.region,
                    status="partial",
                    message=f"Unresolved relationship: {resource.arn} -> {raw.get('resourceId')}",
                )
            )
            continue
        kind = "associated-with"
        if target.resource_type == "AWS::EC2::VPC":
            kind = "in-vpc"
            if not older:
                resource.vpc_ids = sorted({*resource.vpc_ids, target.resource_id})
        elif target.resource_type == "AWS::EC2::Subnet":
            kind = "in-subnet"
            if not older:
                resource.subnet_ids = sorted({*resource.subnet_ids, target.resource_id})
        relations.append(
            GraphRelation(
                source_arn=resource.arn,
                target_arn=target.arn,
                type=kind,
                category="containment" if kind.startswith("in-") else "association",
                evidence=[
                    evidence.model_copy(
                        update={
                            "locator": f"{evidence.locator}:relationships:{raw.get('name', '')}"
                        }
                    )
                ],
            )
        )
    for resource in resources.values():
        for key, relation_type in (("vpc_ids", "in-vpc"), ("subnet_ids", "in-subnet")):
            for resource_id in getattr(resource, key):
                target = by_id.get((resource.account_id, resource.region, resource_id))
                if target and target.arn != resource.arn:
                    relations.append(
                        GraphRelation(
                            source_arn=resource.arn,
                            target_arn=target.arn,
                            type=relation_type,
                            category="containment",
                            evidence=resource.evidence,
                        )
                    )
        if len(resource.account_id) == 12:
            resource.detail = NormalizedResource(
                arn=resource.arn,
                account_id=resource.account_id,
                region=resource.region,
                resource_type=resource.resource_type
                if resource.resource_type.startswith("AWS::")
                else "AWS::Unknown::Unknown",
                resource_id=resource.resource_id,
                service=resource.resource_type.split(":")[0],
                name=resource.name,
                tags=[Tag(key=k, value=v) for k, v in resource.tags.items()],
                icon_key=resource.icon_key,
                lifecycle="active",
                fetched_at=max(e.observed_at for e in resource.evidence),
                sections=[
                    Section(
                        title="Collected configuration",
                        rows=[
                            Row(
                                label=k,
                                value=json.dumps(v, default=str)
                                if isinstance(v, (dict, list))
                                else str(v),
                            )
                            for k, v in resource.parameters.items()
                        ],
                    )
                ],
            )
    classify_subnets(list(resources.values()))
    return ResourceGraph(
        resources=sorted(resources.values(), key=lambda r: r.arn),
        relations=relations,
        coverage=coverage or [],
    )


def add_detail(graph, detail):
    resource = next(r for r in graph.resources if r.arn == detail.arn)
    resource.detail = detail
    if detail.lifecycle != "active":
        return
    resource.name = detail.name or resource.name
    resource.region = detail.region
    resource.tags = {tag.key: tag.value for tag in detail.tags}
    resource.icon_key = detail.icon_key
    evidence = Evidence(
        source="describe", observed_at=detail.fetched_at, locator=f"{detail.resource_type}:Describe"
    )
    resource.evidence.append(evidence)
    by_arn = {r.arn: r for r in graph.resources}
    for relation in detail.relations:
        target = by_arn.get(relation.target_arn)
        if relation.type == "in-vpc" and target:
            resource.vpc_ids = sorted({*resource.vpc_ids, target.resource_id})
        if relation.type == "in-subnet" and target:
            resource.subnet_ids = sorted({*resource.subnet_ids, target.resource_id})
        graph.relations.append(
            GraphRelation(
                source_arn=detail.arn,
                target_arn=relation.target_arn,
                type=relation.type,
                category="containment"
                if relation.type.startswith("in-")
                else "permission"
                if relation.type == "assumes-role"
                else "association",
                evidence=[evidence],
            )
        )


def record(source, data, locator):
    return {
        "source": source,
        "observedAt": datetime.now(UTC).isoformat(),
        "locator": locator,
        "data": data,
    }


def classify_subnets(resources):
    for subnet in resources:
        if subnet.resource_type != "AWS::EC2::Subnet":
            continue
        explicit, main = [], []
        for table in resources:
            if (
                table.resource_type != "AWS::EC2::RouteTable"
                or table.account_id != subnet.account_id
                or table.region != subnet.region
            ):
                continue
            config = {k.lower(): v for k, v in table.parameters.items()}
            associations = [
                {k.lower(): v for k, v in a.items()} for a in config.get("associations", [])
            ]
            if any(a.get("subnetid") == subnet.resource_id for a in associations):
                explicit.append(config)
            elif set(table.vpc_ids) & set(subnet.vpc_ids) and any(
                a.get("main") for a in associations
            ):
                main.append(config)
        candidates = explicit or main
        if len(candidates) != 1 or "routes" not in candidates[0]:
            continue
        routes = [{k.lower(): v for k, v in route.items()} for route in candidates[0]["routes"]]
        public = any(
            str(route.get("gatewayid", "")).startswith("igw-")
            and route.get("state", "active") == "active"
            and (
                route.get("destinationcidrblock") == "0.0.0.0/0"
                or route.get("destinationipv6cidrblock") == "::/0"
            )
            for route in routes
        )
        subnet.subnet_visibility = "public" if public else "private"
