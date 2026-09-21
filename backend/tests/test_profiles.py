"""Profile tests (Describe plus normalization). Never touches AWS."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.aws.profiles import ResourceContext, ResourceNotFoundError, profile_for_type
from tests.conftest import FakeClient, client_error


def context(arn: str, resource_id: str, region: str = "ap-northeast-1") -> ResourceContext:
    return ResourceContext(
        arn=arn,
        account_id="123456789012",
        account_alias="prod",
        region=region,
        resource_id=resource_id,
        fetched_at=datetime(2026, 9, 19, tzinfo=UTC),
    )


def rows_of(resource, section_title: str) -> dict[str, object]:
    for section in resource.sections:
        if section.title == section_title:
            return {row.label: row.value for row in section.rows}
    raise AssertionError(f"section not found: {section_title}")


class TestEc2Instance:
    arn = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc"
    raw = {
        "InstanceId": "i-0abc",
        "InstanceType": "m5.large",
        "State": {"Name": "running"},
        "ImageId": "ami-0123",
        "Placement": {"AvailabilityZone": "ap-northeast-1a"},
        "VpcId": "vpc-01",
        "SubnetId": "subnet-01",
        "PrivateIpAddress": "10.0.2.23",
        "SecurityGroups": [{"GroupId": "sg-01"}],
        "EbsOptimized": True,
        "MetadataOptions": {"HttpTokens": "required"},
        "Tags": [{"Key": "Name", "Value": "ec2-ap1"}, {"Key": "Env", "Value": "prod"}],
    }

    def profile(self):
        return profile_for_type("AWS::EC2::Instance")

    def test_describe_unwraps_reservations(self):
        client = FakeClient({"describe_instances": {"Reservations": [{"Instances": [self.raw]}]}})
        result = self.profile().describe(client, context(self.arn, "i-0abc"))
        assert result["InstanceId"] == "i-0abc"
        assert client.calls[0] == ("describe_instances", {"InstanceIds": ["i-0abc"]})

    def test_describe_empty_means_not_found(self):
        client = FakeClient({"describe_instances": {"Reservations": []}})
        with pytest.raises(ResourceNotFoundError):
            self.profile().describe(client, context(self.arn, "i-0abc"))

    def test_display_fields(self):
        resource = self.profile().normalize(self.raw, context(self.arn, "i-0abc"))
        assert resource.service == "EC2"
        assert resource.name == "ec2-ap1"
        assert resource.resource_id == "i-0abc"
        assert {t.key for t in resource.tags} == {"Name", "Env"}

    def test_sections_have_fixed_order(self):
        resource = self.profile().normalize(self.raw, context(self.arn, "i-0abc"))
        assert [s.title for s in resource.sections] == [
            "Overview",
            "Network",
            "Storage",
            "Security",
        ]

    def test_network_section_links_to_vpc_and_subnet(self):
        resource = self.profile().normalize(self.raw, context(self.arn, "i-0abc"))
        network = next(s for s in resource.sections if s.title == "Network")
        refs = {row.label: row.ref for row in network.rows}
        assert refs["VPC"].endswith("vpc/vpc-01")
        assert refs["Subnet"].endswith("subnet/subnet-01")

    def test_relations_for_ai_edges(self):
        resource = self.profile().normalize(self.raw, context(self.arn, "i-0abc"))
        kinds = {r.type for r in resource.relations}
        assert kinds == {"in-vpc", "in-subnet", "security-group"}

    def test_running_state_is_marked_ok(self):
        resource = self.profile().normalize(self.raw, context(self.arn, "i-0abc"))
        state = next(row for row in resource.sections[0].rows if row.label == "State")
        assert state.kind == "badge"
        assert state.tone == "ok"

    def test_stopped_state_is_not_ok(self):
        raw = {**self.raw, "State": {"Name": "stopped"}}
        resource = self.profile().normalize(raw, context(self.arn, "i-0abc"))
        state = next(row for row in resource.sections[0].rows if row.label == "State")
        assert state.tone == "muted"

    def test_imdsv1_is_flagged(self):
        raw = {**self.raw, "MetadataOptions": {"HttpTokens": "optional"}}
        resource = self.profile().normalize(raw, context(self.arn, "i-0abc"))
        assert rows_of(resource, "Security")["IMDSv2"] == "optional"
        row = next(r for s in resource.sections for r in s.rows if r.label == "IMDSv2")
        assert row.tone == "warn"

    def test_missing_name_tag_falls_back_to_id(self):
        raw = {**self.raw, "Tags": []}
        resource = self.profile().normalize(raw, context(self.arn, "i-0abc"))
        assert resource.name == "i-0abc"


class TestSubnet:
    arn = "arn:aws:ec2:ap-northeast-1:123456789012:subnet/subnet-01"

    def test_public_ip_auto_assignment_is_flagged(self):
        profile = profile_for_type("AWS::EC2::Subnet")
        raw = {
            "SubnetId": "subnet-01",
            "VpcId": "vpc-01",
            "CidrBlock": "10.0.1.0/24",
            "AvailabilityZone": "ap-northeast-1a",
            "MapPublicIpOnLaunch": True,
            "Tags": [],
        }
        resource = profile.normalize(raw, context(self.arn, "subnet-01"))
        row = next(r for r in resource.sections[0].rows if r.label == "Auto-assign public IPv4")
        assert row.value == "Enabled"
        assert row.tone == "warn"

    def test_disabled_auto_assignment_is_not_a_private_subnet_claim(self):
        profile = profile_for_type("AWS::EC2::Subnet")
        raw = {
            "SubnetId": "subnet-02",
            "VpcId": "vpc-01",
            "CidrBlock": "10.0.2.0/24",
            "AvailabilityZone": "ap-northeast-1a",
            "MapPublicIpOnLaunch": False,
            "Tags": [],
        }
        resource = profile.normalize(raw, context(self.arn, "subnet-02"))
        row = next(r for r in resource.sections[0].rows if r.label == "Auto-assign public IPv4")
        assert row.value == "Disabled"
        assert row.tone == "muted"


class TestSecurityGroup:
    arn = "arn:aws:ec2:ap-northeast-1:123456789012:security-group/sg-01"

    def test_rules_are_readable(self):
        profile = profile_for_type("AWS::EC2::SecurityGroup")
        raw = {
            "GroupId": "sg-01",
            "GroupName": "sg-web",
            "Description": "web",
            "VpcId": "vpc-01",
            "IpPermissions": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": 443,
                    "ToPort": 443,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
                },
                {
                    "IpProtocol": "tcp",
                    "FromPort": 8000,
                    "ToPort": 8100,
                    "UserIdGroupPairs": [{"GroupId": "sg-02"}],
                },
            ],
            "IpPermissionsEgress": [{"IpProtocol": "-1", "IpRanges": [{"CidrIp": "0.0.0.0/0"}]}],
            "Tags": [],
        }
        resource = profile.normalize(raw, context(self.arn, "sg-01"))
        inbound = rows_of(resource, "Inbound rules")["Allow"]
        assert "tcp 443 <- 0.0.0.0/0" in inbound
        assert "tcp 8000-8100 <- sg-02" in inbound
        outbound = rows_of(resource, "Outbound rules")["Allow"]
        assert "All All -> 0.0.0.0/0" in outbound


class TestRds:
    arn = "arn:aws:rds:ap-northeast-1:123456789012:db:mydb"
    raw = {
        "DBInstanceIdentifier": "mydb",
        "DBInstanceClass": "db.r6g.large",
        "Engine": "mysql",
        "EngineVersion": "8.0.39",
        "DBInstanceStatus": "available",
        "MultiAZ": True,
        "Endpoint": {"Address": "mydb.rds.amazonaws.com", "Port": 3306},
        "PubliclyAccessible": False,
        "VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-01"}],
        "AllocatedStorage": 200,
        "StorageType": "gp3",
        "StorageEncrypted": True,
        "BackupRetentionPeriod": 14,
        "DeletionProtection": True,
        "DBSubnetGroup": {"VpcId": "vpc-01", "DBSubnetGroupName": "g"},
        "TagList": [{"Key": "Env", "Value": "prod"}],
    }

    def test_describe_by_identifier(self):
        client = FakeClient({"describe_db_instances": {"DBInstances": [self.raw]}})
        profile = profile_for_type("AWS::RDS::DBInstance")
        profile.describe(client, context(self.arn, "mydb"))
        assert client.calls[0][1] == {"DBInstanceIdentifier": "mydb"}

    def test_not_found_when_empty(self):
        client = FakeClient({"describe_db_instances": {"DBInstances": []}})
        with pytest.raises(ResourceNotFoundError):
            profile_for_type("AWS::RDS::DBInstance").describe(client, context(self.arn, "mydb"))

    def test_tag_list_key_is_used(self):
        resource = profile_for_type("AWS::RDS::DBInstance").normalize(
            self.raw, context(self.arn, "mydb")
        )
        assert [t.key for t in resource.tags] == ["Env"]

    def test_unencrypted_storage_is_an_error_badge(self):
        raw = {**self.raw, "StorageEncrypted": False}
        resource = profile_for_type("AWS::RDS::DBInstance").normalize(
            raw, context(self.arn, "mydb")
        )
        row = next(r for s in resource.sections for r in s.rows if r.label == "Encryption")
        assert row.tone == "error"

    def test_public_access_is_an_error_badge(self):
        raw = {**self.raw, "PubliclyAccessible": True}
        resource = profile_for_type("AWS::RDS::DBInstance").normalize(
            raw, context(self.arn, "mydb")
        )
        row = next(r for s in resource.sections for r in s.rows if r.label == "Public access")
        assert row.tone == "error"


class TestLoadBalancer:
    arn = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/x/1a2b"

    def test_describe_uses_full_arn(self):
        client = FakeClient(
            {
                "describe_load_balancers": {"LoadBalancers": [{"LoadBalancerName": "x"}]},
                "describe_listeners": {"Listeners": [{"Protocol": "HTTPS", "Port": 443}]},
                "describe_tags": {"TagDescriptions": [{"Tags": [{"Key": "Name", "Value": "alb"}]}]},
            }
        )
        profile = profile_for_type("AWS::ElasticLoadBalancingV2::LoadBalancer")
        result = profile.describe(client, context(self.arn, "app/x/1a2b"))
        assert client.calls[0][1] == {"LoadBalancerArns": [self.arn]}
        assert result["_Listeners"][0]["Port"] == 443

    def test_listener_failure_does_not_break_describe(self):
        """Say that it could not be read, rather than showing \"no listeners\"."""
        client = FakeClient(
            {
                "describe_load_balancers": {"LoadBalancers": [{"LoadBalancerName": "x"}]},
                "describe_listeners": client_error("AccessDenied"),
                "describe_tags": {"TagDescriptions": []},
            }
        )
        profile = profile_for_type("AWS::ElasticLoadBalancingV2::LoadBalancer")
        result = profile.describe(client, context(self.arn, "app/x/1a2b"))

        assert "_Listeners" not in result
        assert result["_ListenersError"] == "AccessDenied"

    def test_fetches_tags(self):
        client = FakeClient(
            {
                "describe_load_balancers": {"LoadBalancers": [{"LoadBalancerName": "x"}]},
                "describe_listeners": {"Listeners": []},
                "describe_tags": {"TagDescriptions": [{"Tags": [{"Key": "Env", "Value": "prod"}]}]},
            }
        )
        profile = profile_for_type("AWS::ElasticLoadBalancingV2::LoadBalancer")
        raw = profile.describe(client, context(self.arn, "app/x/1a2b"))
        raw.update({"Type": "application", "State": {"Code": "active"}, "AvailabilityZones": []})

        resource = profile.normalize(raw, context(self.arn, "app/x/1a2b"))
        assert [(t.key, t.value) for t in resource.tags] == [("Env", "prod")]

    def test_a_tag_failure_is_not_shown_as_having_no_tags(self):
        client = FakeClient(
            {
                "describe_load_balancers": {"LoadBalancers": [{"LoadBalancerName": "x"}]},
                "describe_listeners": {"Listeners": []},
                "describe_tags": client_error("AccessDenied"),
            }
        )
        profile = profile_for_type("AWS::ElasticLoadBalancingV2::LoadBalancer")
        raw = profile.describe(client, context(self.arn, "app/x/1a2b"))
        raw.update({"Type": "application", "State": {"Code": "active"}, "AvailabilityZones": []})

        resource = profile.normalize(raw, context(self.arn, "app/x/1a2b"))
        row = next(r for s in resource.sections if s.title == "Tags" for r in s.rows)
        assert row.value == "AccessDenied"

    def test_internet_facing_is_flagged(self):
        profile = profile_for_type("AWS::ElasticLoadBalancingV2::LoadBalancer")
        raw = {
            "LoadBalancerName": "alb",
            "Type": "application",
            "Scheme": "internet-facing",
            "State": {"Code": "active"},
            "VpcId": "vpc-01",
            "AvailabilityZones": [{"ZoneName": "a", "SubnetId": "subnet-01"}],
            "SecurityGroups": [],
            "_Listeners": [],
        }
        resource = profile.normalize(raw, context(self.arn, "app/x/1a2b"))
        row = next(r for r in resource.sections[0].rows if r.label == "Scheme")
        assert row.tone == "warn"


class TestS3:
    arn = "arn:aws:s3:::my-bucket"

    def test_missing_bucket_is_not_found(self):
        client = FakeClient({"head_bucket": client_error("NoSuchBucket")})
        with pytest.raises(ResourceNotFoundError):
            profile_for_type("AWS::S3::Bucket").describe(
                client, context(self.arn, "my-bucket", region="")
            )

    def test_optional_attributes_may_be_missing(self):
        client = FakeClient(
            {
                "head_bucket": {},
                "get_bucket_location": {"LocationConstraint": "ap-northeast-1"},
                # The APIs that raise when the setting is absent
                "get_bucket_encryption": client_error(
                    "ServerSideEncryptionConfigurationNotFoundError"
                ),
                "get_bucket_versioning": {},
                "get_public_access_block": client_error("NoSuchPublicAccessBlockConfiguration"),
                "get_bucket_tagging": client_error("NoSuchTagSet"),
                "get_bucket_lifecycle_configuration": client_error("NoSuchLifecycleConfiguration"),
            }
        )
        profile = profile_for_type("AWS::S3::Bucket")
        raw = profile.describe(client, context(self.arn, "my-bucket", region=""))
        resource = profile.normalize(raw, context(self.arn, "my-bucket", region=""))

        security = rows_of(resource, "Security")
        assert security["Default encryption"] == "Not configured"
        assert security["Public access block"] == "Partial"
        assert resource.tags == []

    def test_fully_locked_down_bucket(self):
        profile = profile_for_type("AWS::S3::Bucket")
        raw = {
            "Name": "my-bucket",
            "Location": {"LocationConstraint": "ap-northeast-1"},
            "Encryption": {
                "ServerSideEncryptionConfiguration": {
                    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]
                }
            },
            "Versioning": {"Status": "Enabled"},
            "PublicAccessBlock": {
                "PublicAccessBlockConfiguration": dict.fromkeys(
                    [
                        "BlockPublicAcls",
                        "IgnorePublicAcls",
                        "BlockPublicPolicy",
                        "RestrictPublicBuckets",
                    ],
                    True,
                )
            },
            "Tagging": {"TagSet": [{"Key": "Env", "Value": "prod"}]},
            "Lifecycle": {"Rules": [{"ID": "expire"}]},
        }
        resource = profile.normalize(raw, context(self.arn, "my-bucket", region=""))
        security = rows_of(resource, "Security")
        assert security["Default encryption"] == "aws:kms"
        assert security["Public access block"] == "All settings on"

    def test_us_east_1_location_is_null(self):
        profile = profile_for_type("AWS::S3::Bucket")
        raw = {"Name": "b", "Location": {"LocationConstraint": None}}
        resource = profile.normalize(raw, context(self.arn, "b", region=""))
        assert rows_of(resource, "Overview")["Region"] == "us-east-1"


class TestLambda:
    arn = "arn:aws:lambda:ap-northeast-1:123456789012:function:my-fn"

    def test_describe_uses_arn_and_merges_tags(self):
        client = FakeClient(
            {
                "get_function": {
                    "Configuration": {"FunctionName": "my-fn", "Runtime": "python3.13"},
                    "Tags": {"Env": "prod"},
                }
            }
        )
        profile = profile_for_type("AWS::Lambda::Function")
        raw = profile.describe(client, context(self.arn, "my-fn"))
        assert raw["_Tags"] == {"Env": "prod"}

    def test_vpc_less_function_is_labelled(self):
        profile = profile_for_type("AWS::Lambda::Function")
        raw = {
            "FunctionName": "my-fn",
            "Runtime": "python3.13",
            "Role": "arn:aws:iam::123456789012:role/r",
            "VpcConfig": {},
            "_Tags": {},
        }
        resource = profile.normalize(raw, context(self.arn, "my-fn"))
        assert rows_of(resource, "Network")["VPC"] == "None (outside a VPC)"
        assert [r.type for r in resource.relations] == ["assumes-role"]


def test_all_profiles_declare_required_metadata():
    from app.aws.profiles import all_profiles

    for profile in all_profiles():
        assert profile.resource_type.startswith("AWS::")
        assert profile.service
        assert profile.icon_key.count("/") >= 2
        assert profile.boto_service
        assert profile.arn_keys


def test_security_group_prefix_lists_and_icmp_are_not_lost():
    profile = profile_for_type("AWS::EC2::SecurityGroup")
    rows = profile._rules(
        [
            {
                "IpProtocol": "tcp",
                "FromPort": 443,
                "ToPort": 443,
                "PrefixListIds": [{"PrefixListId": "pl-123"}],
            },
            {
                "IpProtocol": "icmp",
                "FromPort": 8,
                "ToPort": -1,
                "IpRanges": [{"CidrIp": "10.0.0.0/8"}],
            },
        ],
        outbound=True,
    )
    assert rows == ["tcp 443 -> pl-123", "icmp type 8 / code All -> 10.0.0.0/8"]


def test_s3_legacy_eu_location_is_normalized():
    profile = profile_for_type("AWS::S3::Bucket")
    resource = profile.normalize(
        {"Name": "bucket", "Location": {"LocationConstraint": "EU"}},
        context("arn:aws:s3:::bucket", "bucket"),
    )
    assert resource.region == "eu-west-1"
    assert rows_of(resource, "Overview")["Region"] == "eu-west-1"


def test_listener_pagination():
    class PaginatedClient(FakeClient):
        def describe_listeners(self, **kwargs):
            self.calls.append(("describe_listeners", kwargs))
            if "Marker" not in kwargs:
                return {"Listeners": [{"Port": 80}], "NextMarker": "page-2"}
            assert kwargs["Marker"] == "page-2"
            return {"Listeners": [{"Port": 443}]}

    profile = profile_for_type("AWS::ElasticLoadBalancingV2::LoadBalancer")
    arn = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/lb/1"
    client = PaginatedClient(
        {
            "describe_load_balancers": {"LoadBalancers": [{}]},
            "describe_tags": {"TagDescriptions": []},
        }
    )
    raw = profile.describe(client, context(arn, "app/lb/1"))
    assert [listener["Port"] for listener in raw["_Listeners"]] == [80, 443]
