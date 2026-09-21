"""Normalization for Lambda functions."""

from __future__ import annotations

from typing import Any

from app.models import NormalizedResource, Relation, Row, Section

from .base import BotoClient, Profile, ResourceContext, ResourceNotFoundError, register


@register
class LambdaFunctionProfile(Profile):
    resource_type = "AWS::Lambda::Function"
    service = "Lambda"
    icon_key = "Architecture/Compute/AWS-Lambda"
    boto_service = "lambda"
    arn_keys = (("lambda", "function"),)
    not_found_codes = ("ResourceNotFoundException",)

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        response = client.get_function(FunctionName=ctx.arn)
        configuration = response.get("Configuration")
        if not configuration:
            raise ResourceNotFoundError(ctx.resource_id)
        return {**configuration, "_Tags": response.get("Tags") or {}}

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        from app.models import Tag

        tags = [Tag(key=k, value=v) for k, v in sorted((raw.get("_Tags") or {}).items())]
        vpc_config = raw.get("VpcConfig") or {}
        subnets = vpc_config.get("SubnetIds") or []
        state = raw.get("State", "unknown")

        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(label="Runtime", value=raw.get("Runtime")),
                    Row(label="Handler", value=raw.get("Handler"), kind="code"),
                    Row(label="Architecture", value=raw.get("Architectures") or [], kind="list"),
                    Row(
                        label="State",
                        value=state,
                        kind="badge",
                        tone="ok" if state == "Active" else "warn",
                    ),
                    Row(label="Last modified", value=raw.get("LastModified")),
                ],
            ),
            Section(
                title="Runtime settings",
                rows=[
                    Row(label="Memory", value=f"{raw.get('MemorySize', '')} MB"),
                    Row(label="Timeout", value=f"{raw.get('Timeout', '')} s"),
                    Row(
                        label="Execution role",
                        value=raw.get("Role"),
                        kind="link",
                        ref=raw.get("Role"),
                    ),
                ],
            ),
            Section(
                title="Network",
                rows=[
                    Row(
                        label="VPC",
                        value=vpc_config.get("VpcId") or "None (outside a VPC)",
                        kind="link" if vpc_config.get("VpcId") else "text",
                        ref=ctx.arn_for("ec2", f"vpc/{vpc_config['VpcId']}")
                        if vpc_config.get("VpcId")
                        else None,
                    ),
                    Row(label="Subnet", value=subnets, kind="list"),
                    Row(
                        label="Security groups",
                        value=vpc_config.get("SecurityGroupIds") or [],
                        kind="list",
                    ),
                ],
            ),
        ]

        relations: list[Relation] = []
        if raw.get("Role"):
            relations.append(Relation(type="assumes-role", target_arn=raw["Role"]))
        for subnet_id in subnets:
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
            name=raw.get("FunctionName"),
            tags=tags,
            sections=sections,
            relations=relations,
        )
