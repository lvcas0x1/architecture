import json

import pytest

from app.collector.bundle import normalize_records, record
from app.collector.standalone import collect, pages


class Explorer:
    def __init__(self, account):
        self.account = account
        self.tokens = []

    def list_views(self):
        return {"Views": ["view"]}

    def list_resources(self, **kwargs):
        assert kwargs["MaxResults"] == 100
        self.tokens.append(kwargs.get("NextToken"))
        number = 2 if kwargs.get("NextToken") else 1
        return {
            "Resources": [
                {
                    "Arn": f"arn:aws:custom:us-east-1:{self.account}:thing/{number}",
                    "OwningAccountId": self.account,
                    "Region": "us-east-1",
                    "ResourceType": "custom:thing",
                }
            ],
            **({"NextToken": "next"} if number == 1 else {}),
        }


class Config:
    def __init__(self, account):
        self.account = account

    def describe_configuration_aggregators(self):
        return {"ConfigurationAggregators": [{"ConfigurationAggregatorName": "org"}]}

    def describe_configuration_aggregator_sources_status(self, **kwargs):
        return {
            "AggregatedSourceStatusList": [{"LastUpdateStatus": "FAILED", "SourceId": self.account}]
        }

    def select_aggregate_resource_config(self, **kwargs):
        assert "relationships" in kwargs["Expression"]
        assert "configurationItemCaptureTime" in kwargs["Expression"]
        return {
            "Results": [
                json.dumps(
                    {
                        "arn": f"arn:aws:custom:us-east-1:{self.account}:thing/1",
                        "accountId": self.account,
                        "awsRegion": "us-east-1",
                        "resourceType": "AWS::Custom::Thing",
                        "configuration": {"setting": 42},
                    }
                )
            ]
        }


def test_profiles_pagination_deduplication_and_coverage(monkeypatch):
    import app.collector.standalone as module

    monkeypatch.setattr(module, "discover", lambda *args: [])
    monkeypatch.setattr(module, "discover_buckets", lambda *args: [])
    explorers = {}

    class Session:
        available_profiles = ["one", "two", "expired"]
        region_name = "us-east-1"

        def __init__(self, profile_name=None):
            if profile_name == "expired":
                raise ValueError("SSO token expired")
            self.account = "111111111111" if profile_name == "one" else "222222222222"

        def client(self, service, **kwargs):
            if service == "sts":
                return self
            if service == "resource-explorer-2":
                return explorers.setdefault(self.account, Explorer(self.account))
            if service == "config":
                return Config(self.account)
            raise AssertionError(service)

        def get_caller_identity(self):
            return {"Account": self.account}

    graph, raw = collect(regions=["us-east-1"], session_factory=Session)
    assert len(graph.resources) == 4
    assert len(raw) == 6
    assert all(e.tokens == [None, "next"] for e in explorers.values())
    assert any(c.source == "credentials" and "expired" in c.message for c in graph.coverage)
    assert any(c.source == "config" and c.status == "partial" for c in graph.coverage)
    assert any(r.parameters.get("setting") == 42 for r in graph.resources)


def test_pagination_repeated_token_is_reported():
    class Client:
        def search(self, **kwargs):
            return {"NextToken": "same"}

    with pytest.raises(ValueError, match="Repeated pagination"):
        list(pages(Client(), "search", {}))


def test_route_based_subnet_classification_and_detail_parameters():
    def item(kind, resource_id, config):
        return record(
            "config",
            {
                "arn": f"arn:aws:ec2:us-east-1:111111111111:{kind}/{resource_id}",
                "accountId": "111111111111",
                "awsRegion": "us-east-1",
                "resourceId": resource_id,
                "resourceType": "AWS::EC2::Subnet" if kind == "subnet" else "AWS::EC2::RouteTable",
                "configuration": config,
            },
            "config",
        )

    data = [
        item("subnet", "subnet-1", {"vpcId": "vpc-1", "mapPublicIpOnLaunch": False}),
        item(
            "route-table",
            "rtb-1",
            {
                "vpcId": "vpc-1",
                "associations": [{"main": True}],
                "routes": [
                    {"destinationCidrBlock": "0.0.0.0/0", "gatewayId": "igw-1", "state": "active"}
                ],
            },
        ),
    ]
    graph = normalize_records(data)
    subnet = next(r for r in graph.resources if r.resource_id == "subnet-1")
    assert subnet.subnet_visibility == "public"
    assert subnet.detail.sections[0].rows
    only_subnet = normalize_records(data[:1]).resources[0]
    assert only_subnet.subnet_visibility == "unknown"


def test_newer_describe_membership_wins_over_older_config():
    arn = "arn:aws:ec2:us-east-1:111111111111:instance/i-1"
    data = [
        {
            "source": source,
            "observedAt": timestamp,
            "locator": source,
            "data": {
                "arn": arn,
                "accountId": "111111111111",
                "awsRegion": "us-east-1",
                "resourceType": "AWS::EC2::Instance",
                "configuration": {"SubnetId": subnet},
            },
        }
        for source, timestamp, subnet in [
            ("describe", "2026-09-21T01:00:00Z", "new"),
            ("config", "2026-09-20T01:00:00Z", "old"),
        ]
    ]
    assert normalize_records(data).resources[0].subnet_ids == ["new"]
