"""Normalization for Elastic Load Balancing v2 (ALB / NLB)."""

from __future__ import annotations

import logging
from typing import Any

from botocore.exceptions import ClientError

from app.models import NormalizedResource, Relation, Row, Section, Tag

from .base import BotoClient, Profile, ResourceContext, ResourceNotFoundError, register

logger = logging.getLogger(__name__)


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "unknown")


@register
class LoadBalancerProfile(Profile):
    resource_type = "AWS::ElasticLoadBalancingV2::LoadBalancer"
    service = "ELB"
    icon_key = "Architecture/Networking-Content-Delivery/Elastic-Load-Balancing"
    boto_service = "elbv2"
    arn_keys = (("elasticloadbalancing", "loadbalancer"),)
    not_found_codes = ("LoadBalancerNotFound", "LoadBalancerNotFoundException")

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        # ELBv2 wants the whole ARN, not the id
        response = client.describe_load_balancers(LoadBalancerArns=[ctx.arn])
        balancers = response.get("LoadBalancers") or []
        if not balancers:
            raise ResourceNotFoundError(ctx.arn)
        balancer = dict(balancers[0])

        # Preserve partial results and report listener/tag failures separately.
        try:
            listeners = []
            marker = None
            while True:
                request = {"LoadBalancerArn": ctx.arn}
                if marker:
                    request["Marker"] = marker
                page = client.describe_listeners(**request)
                listeners.extend(page.get("Listeners") or [])
                marker = page.get("NextMarker")
                if not marker:
                    break
            balancer["_Listeners"] = listeners
        except ClientError as exc:
            logger.warning("Could not read listeners: %s (%s)", ctx.arn, exc)
            balancer["_ListenersError"] = _error_code(exc)

        try:
            descriptions = client.describe_tags(ResourceArns=[ctx.arn]).get("TagDescriptions") or []
            balancer["_Tags"] = descriptions[0].get("Tags") if descriptions else []
        except ClientError as exc:
            logger.warning("Could not read tags: %s (%s)", ctx.arn, exc)
            balancer["_Tags"] = []
            balancer["_TagsError"] = _error_code(exc)
        return balancer

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        state = (raw.get("State") or {}).get("Code", "unknown")
        scheme = raw.get("Scheme", "")
        subnets = [az.get("SubnetId", "") for az in raw.get("AvailabilityZones") or []]
        azs = [az.get("ZoneName", "") for az in raw.get("AvailabilityZones") or []]
        listeners = [
            f"{listener.get('Protocol')}:{listener.get('Port')}"
            for listener in raw.get("_Listeners") or []
        ]
        listeners_error = raw.get("_ListenersError")
        tags_error = raw.get("_TagsError")
        vpc_id = raw.get("VpcId")
        created = raw.get("CreatedTime")

        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(label="Type", value=raw.get("Type")),
                    Row(
                        label="Scheme",
                        value=scheme,
                        kind="badge",
                        tone="warn" if scheme == "internet-facing" else "ok",
                    ),
                    Row(
                        label="State",
                        value=state,
                        kind="badge",
                        tone="ok" if state == "active" else "warn",
                    ),
                    Row(label="DNS name", value=raw.get("DNSName"), kind="code"),
                    Row(
                        label="Created",
                        value=created.isoformat() if hasattr(created, "isoformat") else created,
                    ),
                ],
            ),
            Section(
                title="Listeners",
                rows=[
                    Row(
                        label="Listening on",
                        value=listeners if not listeners_error else f"({listeners_error})",
                        kind="list" if not listeners_error else "text",
                    )
                ],
            ),
            Section(
                title="Network",
                rows=[
                    Row(
                        label="VPC",
                        value=vpc_id,
                        kind="link",
                        ref=ctx.arn_for("ec2", f"vpc/{vpc_id}") if vpc_id else None,
                    ),
                    Row(label="AZ", value=azs, kind="list"),
                    Row(label="Subnet", value=subnets, kind="list"),
                    Row(
                        label="Security groups",
                        value=raw.get("SecurityGroups") or [],
                        kind="list",
                    ),
                ],
            ),
        ]

        # A tag read that failed is not "no tags"; say which it was.
        if tags_error:
            sections.append(
                Section(
                    title="Tags",
                    rows=[
                        Row(
                            label="Could not be read",
                            value=tags_error,
                            kind="badge",
                            tone="warn",
                        )
                    ],
                )
            )

        relations: list[Relation] = []
        if vpc_id:
            relations.append(
                Relation(
                    type="in-vpc",
                    target_arn=ctx.arn_for("ec2", f"vpc/{vpc_id}"),
                )
            )
        for subnet_id in subnets:
            if subnet_id:
                relations.append(
                    Relation(
                        type="in-subnet",
                        target_arn=ctx.arn_for("ec2", f"subnet/{subnet_id}"),
                    )
                )

        return self.build(
            ctx,
            resource_type=self.resource_type,
            service=self.service,
            icon_key=self.icon_key,
            name=raw.get("LoadBalancerName"),
            tags=[
                Tag(key=t.get("Key", ""), value=t.get("Value", "")) for t in raw.get("_Tags") or []
            ],
            sections=sections,
            relations=relations,
        )
