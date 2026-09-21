"""Normalization for the EC2 family (instances, VPCs, subnets, security groups)."""

from __future__ import annotations

from typing import Any

from app.models import NormalizedResource, Relation, Row, Section

from .base import BotoClient, Profile, ResourceContext, ResourceNotFoundError, register


def _arn(ctx: ResourceContext, resource: str) -> str:
    return ctx.arn_for("ec2", f"{resource}")


def _first(items: list[dict[str, Any]], what: str) -> dict[str, Any]:
    if not items:
        raise ResourceNotFoundError(what)
    return items[0]


@register
class Ec2InstanceProfile(Profile):
    resource_type = "AWS::EC2::Instance"
    service = "EC2"
    icon_key = "Architecture/Compute/Amazon-EC2"
    boto_service = "ec2"
    arn_keys = (("ec2", "instance"),)
    not_found_codes = ("InvalidInstanceID.NotFound",)

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        response = client.describe_instances(InstanceIds=[ctx.resource_id])
        reservations = response.get("Reservations") or []
        if not reservations:
            raise ResourceNotFoundError(ctx.resource_id)
        return _first(reservations[0].get("Instances") or [], ctx.resource_id)

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        tags = self.tags_from(raw)
        state = (raw.get("State") or {}).get("Name", "unknown")
        placement = raw.get("Placement") or {}
        sgs = [g.get("GroupId", "") for g in raw.get("SecurityGroups") or []]

        launch_time = raw.get("LaunchTime")
        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(label="Instance type", value=raw.get("InstanceType")),
                    Row(
                        label="State",
                        value=state,
                        kind="badge",
                        tone="ok" if state == "running" else "muted",
                    ),
                    Row(label="AMI", value=raw.get("ImageId"), kind="code"),
                    Row(label="Platform", value=raw.get("PlatformDetails")),
                    Row(
                        label="Launch time",
                        value=launch_time.isoformat()
                        if hasattr(launch_time, "isoformat")
                        else launch_time,
                    ),
                    Row(label="AZ", value=placement.get("AvailabilityZone")),
                ],
            ),
            Section(
                title="Network",
                rows=[
                    Row(
                        label="VPC",
                        value=raw.get("VpcId"),
                        kind="link",
                        ref=_arn(ctx, f"vpc/{raw['VpcId']}") if raw.get("VpcId") else None,
                    ),
                    Row(
                        label="Subnet",
                        value=raw.get("SubnetId"),
                        kind="link",
                        ref=_arn(ctx, f"subnet/{raw['SubnetId']}") if raw.get("SubnetId") else None,
                    ),
                    Row(label="Private IP", value=raw.get("PrivateIpAddress"), kind="code"),
                    Row(label="Public IP", value=raw.get("PublicIpAddress"), kind="code"),
                    Row(label="Security groups", value=sgs, kind="list"),
                ],
            ),
            Section(
                title="Storage",
                rows=[
                    Row(label="Root device", value=raw.get("RootDeviceName"), kind="code"),
                    Row(label="Root device type", value=raw.get("RootDeviceType")),
                    Row(
                        label="EBS optimized",
                        value="Enabled" if raw.get("EbsOptimized") else "Disabled",
                        kind="badge",
                        tone="ok" if raw.get("EbsOptimized") else "muted",
                    ),
                ],
            ),
            Section(
                title="Security",
                rows=[
                    Row(
                        label="IAM instance profile",
                        value=(raw.get("IamInstanceProfile") or {}).get("Arn"),
                        kind="link",
                        ref=(raw.get("IamInstanceProfile") or {}).get("Arn"),
                    ),
                    Row(
                        label="IMDSv2",
                        value=(raw.get("MetadataOptions") or {}).get("HttpTokens"),
                        kind="badge",
                        tone="ok"
                        if (raw.get("MetadataOptions") or {}).get("HttpTokens") == "required"
                        else "warn",
                    ),
                ],
            ),
        ]

        relations = []
        if raw.get("VpcId"):
            relations.append(Relation(type="in-vpc", target_arn=_arn(ctx, f"vpc/{raw['VpcId']}")))
        if raw.get("SubnetId"):
            relations.append(
                Relation(type="in-subnet", target_arn=_arn(ctx, f"subnet/{raw['SubnetId']}"))
            )
        for group_id in sgs:
            if group_id:
                relations.append(
                    Relation(
                        type="security-group",
                        target_arn=_arn(ctx, f"security-group/{group_id}"),
                    )
                )

        return self.build(
            ctx,
            resource_type=self.resource_type,
            service=self.service,
            icon_key=self.icon_key,
            name=self.name_from_tags(tags, raw.get("InstanceId")),
            tags=tags,
            sections=sections,
            relations=relations,
        )


@register
class VpcProfile(Profile):
    resource_type = "AWS::EC2::VPC"
    service = "VPC"
    icon_key = "Architecture/Networking-Content-Delivery/Amazon-Virtual-Private-Cloud"
    boto_service = "ec2"
    arn_keys = (("ec2", "vpc"),)
    not_found_codes = ("InvalidVpcID.NotFound",)

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        return _first(
            client.describe_vpcs(VpcIds=[ctx.resource_id]).get("Vpcs") or [], ctx.resource_id
        )

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        tags = self.tags_from(raw)
        extra_cidrs = [
            entry.get("CidrBlock", "")
            for entry in raw.get("CidrBlockAssociationSet") or []
            if entry.get("CidrBlock") != raw.get("CidrBlock")
        ]
        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(label="CIDR", value=raw.get("CidrBlock"), kind="code"),
                    Row(label="Additional CIDRs", value=extra_cidrs, kind="list"),
                    Row(
                        label="State",
                        value=raw.get("State"),
                        kind="badge",
                        tone="ok" if raw.get("State") == "available" else "muted",
                    ),
                    Row(
                        label="Default VPC",
                        value="Yes" if raw.get("IsDefault") else "No",
                    ),
                    Row(label="Tenancy", value=raw.get("InstanceTenancy")),
                ],
            ),
        ]
        return self.build(
            ctx,
            resource_type=self.resource_type,
            service=self.service,
            icon_key=self.icon_key,
            name=self.name_from_tags(tags, raw.get("VpcId")),
            tags=tags,
            sections=sections,
        )


@register
class SubnetProfile(Profile):
    resource_type = "AWS::EC2::Subnet"
    service = "VPC"
    icon_key = "Architecture/Networking-Content-Delivery/Amazon-Virtual-Private-Cloud"
    boto_service = "ec2"
    arn_keys = (("ec2", "subnet"),)
    not_found_codes = ("InvalidSubnetID.NotFound",)

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        return _first(
            client.describe_subnets(SubnetIds=[ctx.resource_id]).get("Subnets") or [],
            ctx.resource_id,
        )

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        tags = self.tags_from(raw)
        public = bool(raw.get("MapPublicIpOnLaunch"))
        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(label="CIDR", value=raw.get("CidrBlock"), kind="code"),
                    Row(label="AZ", value=raw.get("AvailabilityZone")),
                    Row(
                        label="Auto-assign public IPv4",
                        value="Enabled" if public else "Disabled",
                        kind="badge",
                        tone="warn" if public else "muted",
                    ),
                    Row(label="Available IPs", value=str(raw.get("AvailableIpAddressCount", ""))),
                ],
            ),
            Section(
                title="Network",
                rows=[
                    Row(
                        label="VPC",
                        value=raw.get("VpcId"),
                        kind="link",
                        ref=_arn(ctx, f"vpc/{raw['VpcId']}") if raw.get("VpcId") else None,
                    ),
                ],
            ),
        ]
        relations = (
            [Relation(type="in-vpc", target_arn=_arn(ctx, f"vpc/{raw['VpcId']}"))]
            if raw.get("VpcId")
            else []
        )
        return self.build(
            ctx,
            resource_type=self.resource_type,
            service=self.service,
            icon_key=self.icon_key,
            name=self.name_from_tags(tags, raw.get("SubnetId")),
            tags=tags,
            sections=sections,
            relations=relations,
        )


@register
class SecurityGroupProfile(Profile):
    resource_type = "AWS::EC2::SecurityGroup"
    service = "VPC"
    icon_key = "Architecture/Security-Identity/AWS-Network-Firewall"
    boto_service = "ec2"
    arn_keys = (("ec2", "security-group"),)
    not_found_codes = ("InvalidGroup.NotFound",)

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        return _first(
            client.describe_security_groups(GroupIds=[ctx.resource_id]).get("SecurityGroups") or [],
            ctx.resource_id,
        )

    @staticmethod
    def _rules(entries: list[dict[str, Any]], *, outbound: bool = False) -> list[str]:
        rules: list[str] = []
        for entry in entries:
            protocol = entry.get("IpProtocol", "-1")
            protocol = "All" if protocol == "-1" else protocol
            from_port = entry.get("FromPort")
            to_port = entry.get("ToPort")
            ports = (
                "All"
                if from_port is None
                else str(from_port)
                if from_port == to_port
                else f"{from_port}-{to_port}"
            )
            if protocol in ("icmp", "icmpv6", "1", "58"):
                icmp_type = "All" if from_port in (None, -1) else str(from_port)
                icmp_code = "All" if to_port in (None, -1) else str(to_port)
                ports = f"type {icmp_type} / code {icmp_code}"
            sources = [r.get("CidrIp", "") for r in entry.get("IpRanges") or []]
            sources += [r.get("CidrIpv6", "") for r in entry.get("Ipv6Ranges") or []]
            sources += [r.get("GroupId", "") for r in entry.get("UserIdGroupPairs") or []]
            sources += [r.get("PrefixListId", "") for r in entry.get("PrefixListIds") or []]
            arrow = "->" if outbound else "<-"
            for source in sources or ["-"]:
                rules.append(f"{protocol} {ports} {arrow} {source}")
        return rules

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        tags = self.tags_from(raw)
        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(label="Group name", value=raw.get("GroupName")),
                    Row(label="Description", value=raw.get("Description")),
                    Row(
                        label="VPC",
                        value=raw.get("VpcId"),
                        kind="link",
                        ref=_arn(ctx, f"vpc/{raw['VpcId']}") if raw.get("VpcId") else None,
                    ),
                ],
            ),
            Section(
                title="Inbound rules",
                rows=[
                    Row(
                        label="Allow",
                        value=self._rules(raw.get("IpPermissions") or []),
                        kind="list",
                    )
                ],
            ),
            Section(
                title="Outbound rules",
                rows=[
                    Row(
                        label="Allow",
                        value=self._rules(raw.get("IpPermissionsEgress") or [], outbound=True),
                        kind="list",
                    )
                ],
            ),
        ]
        relations = (
            [Relation(type="in-vpc", target_arn=_arn(ctx, f"vpc/{raw['VpcId']}"))]
            if raw.get("VpcId")
            else []
        )
        return self.build(
            ctx,
            resource_type=self.resource_type,
            service=self.service,
            icon_key=self.icon_key,
            name=raw.get("GroupName") or self.name_from_tags(tags, raw.get("GroupId")),
            tags=tags,
            sections=sections,
            relations=relations,
        )
