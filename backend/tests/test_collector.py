"""Inventory collection tests. Never touches AWS."""

from __future__ import annotations

import json
import logging

from app.collector.inventory import (
    build_inventory,
    collect_via_config_aggregator,
    collect_via_resource_explorer,
)
from tests.conftest import FakeClient, fake_factory

EC2_ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc"
RDS_ARN = "arn:aws:rds:ap-northeast-1:123456789012:db:mydb"


class TestResourceExplorer:
    def test_maps_results_to_entries(self, settings):
        client = FakeClient(
            {
                "search": {
                    "Resources": [
                        {
                            "Arn": EC2_ARN,
                            "OwningAccountId": "123456789012",
                            "Region": "ap-northeast-1",
                            "ResourceType": "ec2:instance",
                            # The real response is {"Name": "tags", "Data": [...]}
                            "Properties": [
                                {
                                    "Name": "tags",
                                    "Data": [
                                        {"Key": "Env", "Value": "prod"},
                                        {"Key": "Owner", "Value": "platform"},
                                    ],
                                }
                            ],
                        }
                    ]
                }
            }
        )
        entries = list(
            collect_via_resource_explorer(
                fake_factory(client), settings, account_id="111111111111", region="ap-northeast-1"
            )
        )

        assert len(entries) == 1
        entry = entries[0]
        assert entry.resource_type == "AWS::EC2::Instance"
        assert entry.service == "EC2"
        assert entry.account_alias == "prod"
        assert {t.key for t in entry.tags} == {"Env", "Owner"}
        # The detail has not been fetched yet
        assert entry.has_detail is False

    def test_unsupported_types_are_skipped(self, settings):
        client = FakeClient(
            {
                "search": {
                    "Resources": [
                        {
                            "Arn": "arn:aws:kinesis:ap-northeast-1:123456789012:stream/s1",
                            "OwningAccountId": "123456789012",
                            "Region": "ap-northeast-1",
                            "ResourceType": "kinesis:stream",
                        },
                        {
                            "Arn": EC2_ARN,
                            "OwningAccountId": "123456789012",
                            "Region": "ap-northeast-1",
                            "ResourceType": "ec2:instance",
                        },
                    ]
                }
            }
        )
        entries = list(
            collect_via_resource_explorer(
                fake_factory(client), settings, account_id="1", region="ap-northeast-1"
            )
        )
        # Listing things that cannot be drawn only confuses, so they are dropped
        assert [e.resource_type for e in entries] == ["AWS::EC2::Instance"]

    def test_view_arn_is_passed_through(self, settings):
        client = FakeClient({"search": {"Resources": []}})
        list(
            collect_via_resource_explorer(
                fake_factory(client),
                settings,
                account_id="1",
                region="ap-northeast-1",
                view_arn="arn:aws:resource-explorer-2:ap-northeast-1:1:view/org/abc",
                query="tag:Env=prod",
            )
        )
        _, kwargs = client.calls[0]
        assert kwargs["ViewArn"].endswith("view/org/abc")
        assert kwargs["QueryString"] == "tag:Env=prod"

    def test_pagination_is_followed(self, settings):
        pages = [
            {"Resources": [{"Arn": EC2_ARN, "ResourceType": "ec2:instance"}], "NextToken": "t1"},
            {"Resources": [{"Arn": RDS_ARN, "ResourceType": "rds:db"}]},
        ]

        class Paged(FakeClient):
            def __init__(self):
                super().__init__({})
                self.index = 0

            def search(self, **kwargs):
                self.calls.append(("search", kwargs))
                page = pages[self.index]
                self.index += 1
                return page

        client = Paged()
        entries = list(
            collect_via_resource_explorer(
                fake_factory(client), settings, account_id="1", region="ap-northeast-1"
            )
        )
        assert len(entries) == 2
        assert client.calls[1][1]["NextToken"] == "t1"


class TestConfigAggregator:
    def test_maps_sql_results(self, settings):
        row = json.dumps(
            {
                "arn": RDS_ARN,
                "accountId": "123456789012",
                "awsRegion": "ap-northeast-1",
                "resourceType": "AWS::RDS::DBInstance",
                "resourceId": "mydb",
                "resourceName": "mydb",
                "tags": [{"key": "Env", "value": "prod"}],
            }
        )
        client = FakeClient({"select_aggregate_resource_config": {"Results": [row]}})
        entries = list(
            collect_via_config_aggregator(
                fake_factory(client),
                settings,
                account_id="1",
                region="ap-northeast-1",
                aggregator_name="org",
            )
        )

        assert entries[0].resource_type == "AWS::RDS::DBInstance"
        assert entries[0].name == "mydb"

    def test_limit_is_set_explicitly(self, settings):
        """Non-aggregate queries default to 25 per page; without this it takes more round trips."""
        client = FakeClient({"select_aggregate_resource_config": {"Results": []}})
        list(
            collect_via_config_aggregator(
                fake_factory(client),
                settings,
                account_id="1",
                region="ap-northeast-1",
                aggregator_name="org",
            )
        )
        _, kwargs = client.calls[0]
        assert kwargs["Limit"] > 25
        assert kwargs["ConfigurationAggregatorName"] == "org"

    def test_broken_row_is_skipped(self, settings):
        client = FakeClient(
            {
                "select_aggregate_resource_config": {
                    "Results": [
                        "{broken",
                        json.dumps({"arn": EC2_ARN, "resourceType": "AWS::EC2::Instance"}),
                    ]
                }
            }
        )
        entries = list(
            collect_via_config_aggregator(
                fake_factory(client),
                settings,
                account_id="1",
                region="ap-northeast-1",
                aggregator_name="org",
            )
        )
        assert len(entries) == 1


class TestBuildInventory:
    def test_deduplicates_and_sorts(self, settings):
        from app.models import InventoryEntry

        def entry(arn: str, service: str, name: str) -> InventoryEntry:
            return InventoryEntry(
                arn=arn,
                account_id="123456789012",
                region="ap-northeast-1",
                resource_type="AWS::EC2::Instance",
                resource_id="x",
                service=service,
                name=name,
                icon_key="Architecture/Compute/Amazon-EC2",
            )

        inventory = build_inventory(
            [entry(EC2_ARN, "EC2", "b"), entry(EC2_ARN, "EC2", "b"), entry(RDS_ARN, "RDS", "a")],
            source="resource-explorer",
        )
        assert len(inventory.entries) == 2
        assert [e.service for e in inventory.entries] == ["EC2", "RDS"]

    def test_existing_detail_flags_are_preserved(self, settings):
        from datetime import UTC, datetime

        from app.models import Inventory, InventoryEntry

        common = {
            "account_id": "123456789012",
            "region": "ap-northeast-1",
            "resource_type": "AWS::EC2::Instance",
            "resource_id": "i-0abc",
            "service": "EC2",
            "icon_key": "Architecture/Compute/Amazon-EC2",
        }
        existing = Inventory(
            generated_at=datetime.now(UTC),
            source="describe",
            entries=[
                InventoryEntry(
                    arn=EC2_ARN,
                    has_detail=True,
                    lifecycle="active",
                    fetched_at=datetime(2026, 9, 1, tzinfo=UTC),
                    **common,
                )
            ],
        )
        rebuilt = build_inventory(
            [InventoryEntry(arn=EC2_ARN, **common)],
            source="resource-explorer",
            existing=existing,
        )
        # Re-collecting never loses the details that were fetched
        assert rebuilt.entries[0].has_detail is True
        assert rebuilt.entries[0].lifecycle == "active"


class TestSearchLimit:
    """One search returns at most the first 1,000. Do not miss a truncated result."""

    def test_warns_when_truncated(self, settings, caplog) -> None:
        client = FakeClient(
            {
                "search": {
                    "Resources": [],
                    "Count": {"Complete": False, "TotalResources": 1000},
                }
            }
        )
        with caplog.at_level(logging.WARNING):
            list(
                collect_via_resource_explorer(
                    fake_factory(client),
                    settings,
                    account_id="123456789012",
                    region="ap-northeast-1",
                )
            )
        assert "truncated at the limit" in caplog.text

    def test_silent_when_complete(self, settings, caplog) -> None:
        client = FakeClient(
            {"search": {"Resources": [], "Count": {"Complete": True, "TotalResources": 3}}}
        )
        with caplog.at_level(logging.WARNING):
            list(
                collect_via_resource_explorer(
                    fake_factory(client),
                    settings,
                    account_id="123456789012",
                    region="ap-northeast-1",
                )
            )
        assert "truncated at the limit" not in caplog.text
