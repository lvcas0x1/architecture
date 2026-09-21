#!/usr/bin/env python3
"""Generate placeholder icons for development."""

from __future__ import annotations

import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.models import IconCatalog, IconEntry, IconGroup  # noqa: E402

PUBLIC = REPO_ROOT / "packages" / "editor" / "public"
ICON_DIR = PUBLIC / "icons-placeholder"
CATALOG_OUT = PUBLIC / "icons-placeholder.json"

#: Colour per category. Deliberately different from the official AWS palette.
CATEGORY_COLORS = {
    "Compute": "#4f6bed",
    "Storage": "#3d8f5a",
    "Databases": "#2f6f9f",
    "Networking-Content-Delivery": "#7a52c7",
    "Security-Identity": "#c0504d",
    "Management-Tools": "#8a6d3b",
    "Application-Integration": "#b8577a",
    "Containers": "#2f8f8f",
    "Analytics": "#a1552e",
    "Artificial-Intelligence": "#5c8f2f",
    "Developer-Tools": "#59606e",
}

#: (category, official logical name, label, abbreviation, resourceTypes, aliases)
#: Names containing '/' are full keys. Placement scopes remain user-defined.
SERVICES: list[tuple[str, str, str, str, list[str], list[str]]] = [
    (
        "Compute",
        "Amazon-EC2",
        "Amazon EC2",
        "EC2",
        ["AWS::EC2::Instance"],
        ["virtual server", "instance"],
    ),
    (
        "Compute",
        "AWS-Lambda",
        "AWS Lambda",
        "λ",
        ["AWS::Lambda::Function"],
        ["serverless", "function"],
    ),
    (
        "Compute",
        "Amazon-EC2-Auto-Scaling",
        "AWS Auto Scaling",
        "ASG",
        ["AWS::AutoScaling::AutoScalingGroup"],
        ["autoscaling"],
    ),
    ("Compute", "AWS-Batch", "AWS Batch", "BAT", ["AWS::Batch::JobQueue"], ["batch"]),
    (
        "Containers",
        "Amazon-Elastic-Container-Service",
        "Amazon ECS",
        "ECS",
        ["AWS::ECS::Cluster", "AWS::ECS::Service"],
        ["container"],
    ),
    (
        "Containers",
        "Amazon-Elastic-Kubernetes-Service",
        "Amazon EKS",
        "EKS",
        ["AWS::EKS::Cluster"],
        ["kubernetes", "k8s"],
    ),
    (
        "Containers",
        "Amazon-Elastic-Container-Registry",
        "Amazon ECR",
        "ECR",
        ["AWS::ECR::Repository"],
        ["registry"],
    ),
    ("Containers", "AWS-Fargate", "AWS Fargate", "FGT", [], ["fargate"]),
    (
        "Storage",
        "Amazon-Simple-Storage-Service",
        "Amazon S3",
        "S3",
        ["AWS::S3::Bucket"],
        ["object storage", "bucket"],
    ),
    (
        "Storage",
        "Amazon-Elastic-Block-Store",
        "Amazon EBS",
        "EBS",
        ["AWS::EC2::Volume"],
        ["volume", "disk"],
    ),
    (
        "Storage",
        "Amazon-EFS",
        "Amazon EFS",
        "EFS",
        ["AWS::EFS::FileSystem"],
        ["file system"],
    ),
    (
        "Storage",
        "AWS-Backup",
        "AWS Backup",
        "BKP",
        ["AWS::Backup::BackupVault"],
        ["backup"],
    ),
    (
        "Databases",
        "Amazon-RDS",
        "Amazon RDS",
        "RDS",
        ["AWS::RDS::DBInstance", "AWS::RDS::DBCluster"],
        ["database", "db"],
    ),
    (
        "Databases",
        "Amazon-Aurora",
        "Amazon Aurora",
        "AUR",
        ["AWS::RDS::DBCluster"],
        ["aurora"],
    ),
    (
        "Databases",
        "Amazon-DynamoDB",
        "Amazon DynamoDB",
        "DDB",
        ["AWS::DynamoDB::Table"],
        ["nosql", "table"],
    ),
    (
        "Databases",
        "Amazon-ElastiCache",
        "Amazon ElastiCache",
        "EC",
        ["AWS::ElastiCache::CacheCluster"],
        ["cache", "redis"],
    ),
    (
        "Networking-Content-Delivery",
        "Amazon-Virtual-Private-Cloud",
        "Amazon VPC",
        "VPC",
        ["AWS::EC2::VPC"],
        ["network"],
    ),
    (
        "Networking-Content-Delivery",
        "Elastic-Load-Balancing",
        "Elastic Load Balancing",
        "ELB",
        ["AWS::ElasticLoadBalancingV2::LoadBalancer"],
        ["load balancer", "alb", "nlb"],
    ),
    (
        "Networking-Content-Delivery",
        "Amazon-CloudFront",
        "Amazon CloudFront",
        "CF",
        ["AWS::CloudFront::Distribution"],
        ["cdn", "delivery"],
    ),
    (
        "Networking-Content-Delivery",
        "Amazon-Route-53",
        "Amazon Route 53",
        "R53",
        ["AWS::Route53::HostedZone"],
        ["dns", "domain"],
    ),
    (
        "Networking-Content-Delivery",
        "Amazon-API-Gateway",
        "Amazon API Gateway",
        "APIG",
        ["AWS::ApiGateway::RestApi", "AWS::ApiGatewayV2::Api"],
        ["api"],
    ),
    (
        "Networking-Content-Delivery",
        "AWS-Transit-Gateway",
        "AWS Transit Gateway",
        "TGW",
        ["AWS::EC2::TransitGateway"],
        ["transit"],
    ),
    (
        "Networking-Content-Delivery",
        "Resource/Networking-Content-Delivery/Amazon-VPC-NAT-Gateway",
        "NAT Gateway",
        "NAT",
        ["AWS::EC2::NatGateway"],
        ["nat"],
    ),
    (
        "Networking-Content-Delivery",
        "Resource/Networking-Content-Delivery/Amazon-VPC-Internet-Gateway",
        "Internet Gateway",
        "IGW",
        ["AWS::EC2::InternetGateway"],
        ["igw"],
    ),
    (
        "Networking-Content-Delivery",
        "AWS-Direct-Connect",
        "AWS Direct Connect",
        "DX",
        ["AWS::DirectConnect::Connection"],
        ["direct connect"],
    ),
    (
        "Security-Identity",
        "AWS-Identity-and-Access-Management",
        "AWS IAM",
        "IAM",
        ["AWS::IAM::Role", "AWS::IAM::User", "AWS::IAM::Policy"],
        ["permission", "role"],
    ),
    (
        "Security-Identity",
        "AWS-WAF",
        "AWS WAF",
        "WAF",
        ["AWS::WAFv2::WebACL"],
        ["firewall"],
    ),
    (
        "Security-Identity",
        "AWS-Secrets-Manager",
        "AWS Secrets Manager",
        "SEC",
        ["AWS::SecretsManager::Secret"],
        ["secret", "sensitive"],
    ),
    (
        "Security-Identity",
        "AWS-Key-Management-Service",
        "AWS KMS",
        "KMS",
        ["AWS::KMS::Key"],
        ["encryption", "key"],
    ),
    (
        "Security-Identity",
        "Amazon-Cognito",
        "Amazon Cognito",
        "COG",
        ["AWS::Cognito::UserPool"],
        ["authentication"],
    ),
    ("Security-Identity", "AWS-Shield", "AWS Shield", "SHL", [], ["ddos"]),
    (
        "Security-Identity",
        "AWS-Network-Firewall",
        "Security Group",
        "SG",
        ["AWS::EC2::SecurityGroup"],
        ["security group"],
    ),
    (
        "Management-Tools",
        "Amazon-CloudWatch",
        "Amazon CloudWatch",
        "CW",
        ["AWS::CloudWatch::Alarm", "AWS::Logs::LogGroup"],
        ["monitoring", "logs"],
    ),
    (
        "Management-Tools",
        "AWS-CloudTrail",
        "AWS CloudTrail",
        "CT",
        ["AWS::CloudTrail::Trail"],
        ["audit"],
    ),
    (
        "Management-Tools",
        "AWS-CloudFormation",
        "AWS CloudFormation",
        "CFN",
        ["AWS::CloudFormation::Stack"],
        ["iac", "stack"],
    ),
    (
        "Management-Tools",
        "AWS-Systems-Manager",
        "AWS Systems Manager",
        "SSM",
        ["AWS::SSM::Parameter"],
        ["ssm", "parameter"],
    ),
    (
        "Management-Tools",
        "AWS-Organizations",
        "AWS Organizations",
        "ORG",
        ["AWS::Organizations::Account"],
        ["organization", "multi-account"],
    ),
    (
        "Application-Integration",
        "Amazon-Simple-Notification-Service",
        "Amazon SNS",
        "SNS",
        ["AWS::SNS::Topic"],
        ["notification", "topic"],
    ),
    (
        "Application-Integration",
        "Amazon-Simple-Queue-Service",
        "Amazon SQS",
        "SQS",
        ["AWS::SQS::Queue"],
        ["queue"],
    ),
    (
        "Application-Integration",
        "Amazon-EventBridge",
        "Amazon EventBridge",
        "EVB",
        ["AWS::Events::Rule"],
        ["event"],
    ),
    (
        "Application-Integration",
        "AWS-Step-Functions",
        "AWS Step Functions",
        "SFN",
        ["AWS::StepFunctions::StateMachine"],
        ["workflow"],
    ),
    (
        "Analytics",
        "Amazon-Athena",
        "Amazon Athena",
        "ATH",
        ["AWS::Athena::WorkGroup"],
        ["query"],
    ),
    (
        "Analytics",
        "Amazon-Kinesis",
        "Amazon Kinesis",
        "KIN",
        ["AWS::Kinesis::Stream"],
        ["stream"],
    ),
    ("Analytics", "AWS-Glue", "AWS Glue", "GLU", ["AWS::Glue::Job"], ["etl"]),
    (
        "Analytics",
        "Amazon-Redshift",
        "Amazon Redshift",
        "RS",
        ["AWS::Redshift::Cluster"],
        ["dwh", "data warehouse"],
    ),
    (
        "Artificial-Intelligence",
        "Amazon-SageMaker-AI",
        "Amazon SageMaker",
        "SM",
        ["AWS::SageMaker::Endpoint"],
        ["machine learning", "ml"],
    ),
    (
        "Artificial-Intelligence",
        "Amazon-Bedrock",
        "Amazon Bedrock",
        "BR",
        [],
        ["generative ai", "llm"],
    ),
    (
        "Developer-Tools",
        "AWS-CodePipeline",
        "AWS CodePipeline",
        "CP",
        ["AWS::CodePipeline::Pipeline"],
        ["ci", "cd", "pipeline"],
    ),
    (
        "Developer-Tools",
        "AWS-CodeBuild",
        "AWS CodeBuild",
        "CB",
        ["AWS::CodeBuild::Project"],
        ["build"],
    ),
]

#: Group icons for boxes (frames).
GROUPS: list[tuple[str, str, str]] = [
    ("AWS-Cloud", "AWS Cloud", "AWS"),
    ("AWS-Account", "AWS Account", "ACC"),
    ("Region", "Region", "RGN"),
    ("Virtual-private-cloud-VPC", "VPC", "VPC"),
    ("Public-subnet", "Public subnet", "PUB"),
    ("Private-subnet", "Private subnet", "PRI"),
]


def svg(abbrev: str, color: str, rounded: bool = True) -> str:
    """Draw a neutral icon carrying the abbreviation."""
    # Tighten the type as the abbreviation gets longer
    length = len(abbrev)
    font_size = 20 if length <= 2 else 16 if length == 3 else 13
    radius = 10 if rounded else 2
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" '
        'width="64" height="64" role="img">\n'
        f"  <title>{abbrev}</title>\n"
        f'  <rect x="2" y="2" width="60" height="60" rx="{radius}" fill="{color}"/>\n'
        f'  <rect x="2" y="2" width="60" height="60" rx="{radius}" fill="none" '
        'stroke="rgba(0,0,0,.25)" stroke-width="2"/>\n'
        f'  <text x="32" y="32" fill="#fff" font-size="{font_size}" '
        'font-family="Helvetica,Arial,sans-serif" font-weight="700" '
        f'text-anchor="middle" dominant-baseline="central">{abbrev}</text>\n'
        "</svg>\n"
    )


def main() -> int:
    if ICON_DIR.exists():
        shutil.rmtree(ICON_DIR)

    entries: list[IconEntry] = []

    for category, name, label, abbrev, resource_types, aliases in SERVICES:
        key = name if "/" in name else f"Architecture/{category}/{name}"
        color = CATEGORY_COLORS.get(category, "#59606e")
        dest = ICON_DIR / f"{key}.svg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(svg(abbrev, color), encoding="utf-8")
        entries.append(
            IconEntry(
                key=key,
                group=IconGroup(key.split("/", 1)[0]),
                category=category.replace("-", " "),
                label=label,
                path=f"/icons-placeholder/{key}.svg",
                aliases=sorted({label.lower(), abbrev.lower(), *aliases}),
                resource_types=resource_types,
            )
        )

    for name, label, abbrev in GROUPS:
        key = f"Group/Group/{name}"
        dest = ICON_DIR / f"{key}.svg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(svg(abbrev, "#59606e", rounded=False), encoding="utf-8")
        entries.append(
            IconEntry(
                key=key,
                group=IconGroup.GROUP,
                category="Group",
                label=label,
                path=f"/icons-placeholder/{key}.svg",
                aliases=sorted({label.lower(), abbrev.lower()}),
            )
        )

    catalog = IconCatalog(
        generated_at=datetime.now(UTC), package_release="placeholder", icons=entries
    )
    CATALOG_OUT.write_text(
        catalog.model_dump_json(indent=2, by_alias=True) + "\n", encoding="utf-8"
    )

    print(f"Generated {len(entries)} placeholder icons.")
    print(f"  {ICON_DIR.relative_to(REPO_ROOT)}/")
    print(f"  {CATALOG_OUT.relative_to(REPO_ROOT)}")
    print("\nImporting the official icons (npm run icons) takes precedence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
