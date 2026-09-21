"""Normalization for RDS."""

from __future__ import annotations

from typing import Any

from app.models import NormalizedResource, Relation, Row, Section

from .base import BotoClient, Profile, ResourceContext, ResourceNotFoundError, register


@register
class RdsInstanceProfile(Profile):
    resource_type = "AWS::RDS::DBInstance"
    service = "RDS"
    icon_key = "Architecture/Databases/Amazon-RDS"
    boto_service = "rds"
    arn_keys = (("rds", "db"),)
    not_found_codes = ("DBInstanceNotFound", "DBInstanceNotFoundFault")

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        response = client.describe_db_instances(DBInstanceIdentifier=ctx.resource_id)
        instances = response.get("DBInstances") or []
        if not instances:
            raise ResourceNotFoundError(ctx.resource_id)
        return instances[0]

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        tags = self.tags_from(raw, key="TagList")
        endpoint = raw.get("Endpoint") or {}
        status = raw.get("DBInstanceStatus", "unknown")
        subnet_group = raw.get("DBSubnetGroup") or {}
        vpc_id = subnet_group.get("VpcId")
        sgs = [
            g.get("VpcSecurityGroupId", "")
            for g in raw.get("VpcSecurityGroups") or []
            if g.get("VpcSecurityGroupId")
        ]
        encrypted = bool(raw.get("StorageEncrypted"))
        public = bool(raw.get("PubliclyAccessible"))

        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(
                        label="Engine",
                        value=f"{raw.get('Engine')} {raw.get('EngineVersion', '')}".strip(),
                    ),
                    Row(label="Instance class", value=raw.get("DBInstanceClass")),
                    Row(
                        label="State",
                        value=status,
                        kind="badge",
                        tone="ok" if status == "available" else "warn",
                    ),
                    Row(label="Multi-AZ", value="Yes" if raw.get("MultiAZ") else "No"),
                    Row(label="AZ", value=raw.get("AvailabilityZone")),
                ],
            ),
            Section(
                title="Connectivity",
                rows=[
                    Row(label="Endpoint", value=endpoint.get("Address"), kind="code"),
                    Row(label="Port", value=str(endpoint.get("Port", ""))),
                    Row(
                        label="Public access",
                        value="Enabled" if public else "Disabled",
                        kind="badge",
                        tone="error" if public else "ok",
                    ),
                    Row(label="Security groups", value=sgs, kind="list"),
                ],
            ),
            Section(
                title="Storage",
                rows=[
                    Row(label="Allocated storage", value=f"{raw.get('AllocatedStorage', '')} GiB"),
                    Row(label="Storage type", value=raw.get("StorageType")),
                    Row(
                        label="Encryption",
                        value="Enabled" if encrypted else "Disabled",
                        kind="badge",
                        tone="ok" if encrypted else "error",
                    ),
                ],
            ),
            Section(
                title="Backup",
                rows=[
                    Row(label="Retention", value=f"{raw.get('BackupRetentionPeriod', 0)} days"),
                    Row(label="Backup window", value=raw.get("PreferredBackupWindow")),
                    Row(
                        label="Deletion protection",
                        value="Enabled" if raw.get("DeletionProtection") else "Disabled",
                        kind="badge",
                        tone="ok" if raw.get("DeletionProtection") else "warn",
                    ),
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
                    Row(label="Subnet group", value=subnet_group.get("DBSubnetGroupName")),
                ],
            ),
        ]

        relations: list[Relation] = []
        if vpc_id:
            relations.append(
                Relation(
                    type="in-vpc",
                    target_arn=ctx.arn_for("ec2", f"vpc/{vpc_id}"),
                )
            )
        for group_id in sgs:
            relations.append(
                Relation(
                    type="security-group",
                    target_arn=ctx.arn_for("ec2", f"security-group/{group_id}"),
                )
            )

        return self.build(
            ctx,
            resource_type=self.resource_type,
            service=self.service,
            icon_key=self.icon_key,
            name=raw.get("DBInstanceIdentifier"),
            tags=tags,
            sections=sections,
            relations=relations,
        )
