#!/usr/bin/env python3
"""Build a demo workspace that works without touching AWS."""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.aws.profiles import ResourceContext, profile_for_type  # noqa: E402
from app.collector.inventory import build_inventory  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.models import InventoryEntry  # noqa: E402
from app.store import Store  # noqa: E402

ACCOUNT = "123456789012"
REGION = "ap-northeast-1"
ALIAS = "prod"

VPC_ID = "vpc-0prod0000000000"
SUBNET_PUB = "subnet-0public00000000"
SUBNET_PRI = "subnet-0private0000000"
SG_WEB = "sg-0web0000000000000"
INSTANCE = "i-0abc123def4567890"
ALB_RESOURCE = "loadbalancer/app/alb-prod/0a1b2c3d4e5f6789"


def arn(service: str, resource: str) -> str:
    return f"arn:aws:{service}:{REGION}:{ACCOUNT}:{resource}"


#: (ARN, resourceType, raw data shaped like a Describe response)
SAMPLES: list[tuple[str, str, dict[str, Any]]] = [
    (
        arn("ec2", f"vpc/{VPC_ID}"),
        "AWS::EC2::VPC",
        {
            "VpcId": VPC_ID,
            "CidrBlock": "10.0.0.0/16",
            "State": "available",
            "IsDefault": False,
            "InstanceTenancy": "default",
            "CidrBlockAssociationSet": [{"CidrBlock": "10.0.0.0/16"}],
            "Tags": [{"Key": "Name", "Value": "vpc-prod"}, {"Key": "Env", "Value": "prod"}],
        },
    ),
    (
        arn("ec2", f"subnet/{SUBNET_PUB}"),
        "AWS::EC2::Subnet",
        {
            "SubnetId": SUBNET_PUB,
            "VpcId": VPC_ID,
            "CidrBlock": "10.0.1.0/24",
            "AvailabilityZone": "ap-northeast-1a",
            "MapPublicIpOnLaunch": True,
            "AvailableIpAddressCount": 250,
            "Tags": [{"Key": "Name", "Value": "subnet-public-1a"}],
        },
    ),
    (
        arn("ec2", f"subnet/{SUBNET_PRI}"),
        "AWS::EC2::Subnet",
        {
            "SubnetId": SUBNET_PRI,
            "VpcId": VPC_ID,
            "CidrBlock": "10.0.2.0/24",
            "AvailabilityZone": "ap-northeast-1a",
            "MapPublicIpOnLaunch": False,
            "AvailableIpAddressCount": 248,
            "Tags": [{"Key": "Name", "Value": "subnet-private-1a"}],
        },
    ),
    (
        arn("ec2", f"security-group/{SG_WEB}"),
        "AWS::EC2::SecurityGroup",
        {
            "GroupId": SG_WEB,
            "GroupName": "sg-web",
            "Description": "Allows HTTP/HTTPS from the web tier",
            "VpcId": VPC_ID,
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 80,
                    "ToPort": 80,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                },
                {
                    "IpProtocol": "tcp",
                    "FromPort": 443,
                    "ToPort": 443,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                },
            ],
            "IpPermissionsEgress": [{"IpProtocol": "-1", "IpRanges": [{"CidrIp": "0.0.0.0/0"}]}],
            "Tags": [{"Key": "Name", "Value": "sg-web"}],
        },
    ),
    (
        arn("ec2", f"instance/{INSTANCE}"),
        "AWS::EC2::Instance",
        {
            "InstanceId": INSTANCE,
            "InstanceType": "m5.large",
            "State": {"Name": "running"},
            "ImageId": "ami-0123456789abcdef0",
            "PlatformDetails": "Linux/UNIX",
            "LaunchTime": datetime(2026, 4, 1, 9, 0, tzinfo=UTC),
            "Placement": {"AvailabilityZone": "ap-northeast-1a"},
            "VpcId": VPC_ID,
            "SubnetId": SUBNET_PRI,
            "PrivateIpAddress": "10.0.2.23",
            "SecurityGroups": [{"GroupId": SG_WEB, "GroupName": "sg-web"}],
            "RootDeviceName": "/dev/xvda",
            "RootDeviceType": "ebs",
            "EbsOptimized": True,
            "IamInstanceProfile": {"Arn": f"arn:aws:iam::{ACCOUNT}:instance-profile/ec2-prod-app"},
            "MetadataOptions": {"HttpTokens": "required"},
            "Tags": [
                {"Key": "Name", "Value": "ec2-ap1"},
                {"Key": "Env", "Value": "prod"},
                {"Key": "Owner", "Value": "platform"},
                {"Key": "CostCenter", "Value": "cc-1001"},
            ],
        },
    ),
    (
        arn("rds", "db:rds-prod-ap1"),
        "AWS::RDS::DBInstance",
        {
            "DBInstanceIdentifier": "rds-prod-ap1",
            "DBInstanceClass": "db.r6g.large",
            "Engine": "mysql",
            "EngineVersion": "8.0.39",
            "DBInstanceStatus": "available",
            "MultiAZ": True,
            "AvailabilityZone": "ap-northeast-1a",
            "Endpoint": {
                "Address": "rds-prod-ap1.abcdefg.ap-northeast-1.rds.amazonaws.com",
                "Port": 3306,
            },
            "PubliclyAccessible": False,
            "VpcSecurityGroups": [{"VpcSecurityGroupId": SG_WEB}],
            "AllocatedStorage": 200,
            "StorageType": "gp3",
            "StorageEncrypted": True,
            "BackupRetentionPeriod": 14,
            "PreferredBackupWindow": "17:00-17:30",
            "DeletionProtection": True,
            "DBSubnetGroup": {"VpcId": VPC_ID, "DBSubnetGroupName": "prod-db-subnets"},
            "TagList": [{"Key": "Env", "Value": "prod"}, {"Key": "Owner", "Value": "platform"}],
        },
    ),
    (
        arn("elasticloadbalancing", ALB_RESOURCE),
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
            "LoadBalancerName": "alb-prod",
            "Type": "application",
            "Scheme": "internet-facing",
            "State": {"Code": "active"},
            "DNSName": "alb-prod-123456789.ap-northeast-1.elb.amazonaws.com",
            "CreatedTime": datetime(2026, 3, 15, 2, 30, tzinfo=UTC),
            "VpcId": VPC_ID,
            "AvailabilityZones": [
                {"ZoneName": "ap-northeast-1a", "SubnetId": SUBNET_PUB},
                {"ZoneName": "ap-northeast-1c", "SubnetId": "subnet-0public00000001"},
            ],
            "SecurityGroups": [SG_WEB],
            "_Listeners": [
                {"Protocol": "HTTPS", "Port": 443},
                {"Protocol": "HTTP", "Port": 80},
            ],
        },
    ),
    (
        "arn:aws:s3:::prod-app-assets-ap1",
        "AWS::S3::Bucket",
        {
            "Name": "prod-app-assets-ap1",
            "Location": {"LocationConstraint": "ap-northeast-1"},
            "Encryption": {
                "ServerSideEncryptionConfiguration": {
                    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
                }
            },
            "Versioning": {"Status": "Enabled"},
            "PublicAccessBlock": {
                "PublicAccessBlockConfiguration": {
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                }
            },
            "Tagging": {"TagSet": [{"Key": "Env", "Value": "prod"}]},
            "Lifecycle": {"Rules": [{"ID": "expire-old-logs"}]},
        },
    ),
    (
        arn("lambda", "function:prod-image-resizer"),
        "AWS::Lambda::Function",
        {
            "FunctionName": "prod-image-resizer",
            "Runtime": "python3.13",
            "Handler": "app.handler",
            "Architectures": ["arm64"],
            "State": "Active",
            "LastModified": "2026-08-20T04:11:00.000+0000",
            "MemorySize": 1024,
            "Timeout": 30,
            "Role": f"arn:aws:iam::{ACCOUNT}:role/prod-image-resizer",
            "VpcConfig": {},
            "_Tags": {"Env": "prod", "Owner": "platform"},
        },
    ),
]


def main() -> int:
    settings = get_settings()
    store = Store(settings)
    now = datetime.now(UTC)

    entries: list[InventoryEntry] = []
    for resource_arn, resource_type, raw in SAMPLES:
        profile = profile_for_type(resource_type)
        if profile is None:
            print(f"  skipped (no Profile registered): {resource_type}", file=sys.stderr)
            continue

        from app.aws.arn import parse_arn

        parsed = parse_arn(resource_arn)
        ctx = ResourceContext(
            arn=resource_arn,
            account_id=parsed.account_id or ACCOUNT,
            account_alias=ALIAS,
            region=parsed.region or REGION,
            resource_id=parsed.resource_id,
            fetched_at=now,
        )
        resource = profile.normalize(raw, ctx)
        store.write_resource(resource)
        entries.append(
            InventoryEntry(
                arn=resource.arn,
                account_id=resource.account_id,
                account_alias=resource.account_alias,
                region=resource.region,
                resource_type=resource.resource_type,
                resource_id=resource.resource_id,
                service=resource.service,
                name=resource.name,
                tags=resource.tags,
                icon_key=resource.icon_key,
                lifecycle=resource.lifecycle,
                fetched_at=resource.fetched_at,
                has_detail=True,
            )
        )
        print(f"  {resource.service:8} {resource.name}")

    store.write_inventory(build_inventory(entries, source="describe"))
    print(f"\nCreated {len(entries)} resources and the index in {settings.workspace}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
