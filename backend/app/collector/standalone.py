from __future__ import annotations

from functools import partial
from pathlib import Path

from botocore.config import Config

from app.aws.fetcher import ResourceOwner, fetch_resource, supported_for
from app.collector.bundle import add_detail, normalize_records, record
from app.collector.discovery import discover, discover_buckets
from app.config import Settings
from app.models.project import Coverage


def pages(client, operation, params, token="NextToken"):
    params = dict(params)
    seen = set()
    while True:
        response = getattr(client, operation)(**params)
        yield response
        next_token = response.get(token)
        if not next_token:
            return
        if next_token in seen:
            raise ValueError(f"Repeated pagination token: {operation}")
        seen.add(next_token)
        params[token] = next_token


def collect(profiles=None, regions=None, session_factory=None):
    import boto3

    session_factory = session_factory or boto3.Session
    profiles = profiles or session_factory().available_profiles or [None]
    records, coverage = [], []
    sessions = {}
    retry = Config(
        retries={"mode": "standard", "max_attempts": 5}, connect_timeout=10, read_timeout=60
    )

    def report(source, profile, account, region, status, message="", count=0):
        coverage.append(
            Coverage(
                source=source,
                profile=profile or "default",
                account_id=account,
                region=region,
                status=status,
                message=message,
                count=count,
            )
        )

    for profile in profiles:
        try:
            session = session_factory(profile_name=profile)
            account = session.client("sts", config=retry).get_caller_identity()["Account"]
            sessions.setdefault(account, []).append(session)
        except Exception as exc:
            report("credentials", profile, "", "", "error", str(exc))
            continue
        target_regions = regions
        if not target_regions:
            try:
                response = session.client(
                    "ec2", region_name=session.region_name or "us-east-1", config=retry
                ).describe_regions()
                target_regions = sorted(r["RegionName"] for r in response["Regions"])
            except Exception as exc:
                target_regions = [session.region_name or "us-east-1"]
                report("regions", profile, account, target_regions[0], "partial", str(exc))
        records.extend(
            discover_buckets(
                session,
                account,
                target_regions[0],
                retry,
                partial(report, "describe-discovery", profile, account, "global"),
            )
        )
        for region in target_regions:
            records.extend(
                discover(
                    session,
                    account,
                    region,
                    retry,
                    partial(report, "describe-discovery", profile, account, region),
                )
            )
            for source in ("resource-explorer", "config"):
                start = len(records)
                try:
                    if source == "resource-explorer":
                        client = session.client(
                            "resource-explorer-2", region_name=region, config=retry
                        )
                        views = [
                            v
                            for page in pages(client, "list_views", {})
                            for v in page.get("Views", [])
                        ]
                        if not views:
                            report(
                                source, profile, account, region, "partial", "No accessible views"
                            )
                            continue
                        for view in views:
                            # MaxResults=1000 suppresses NextToken in ListResources.
                            for page in pages(
                                client, "list_resources", {"ViewArn": view, "MaxResults": 100}
                            ):
                                records.extend(
                                    record(source, r, view) for r in page.get("Resources", [])
                                )
                    else:
                        client = session.client("config", region_name=region, config=retry)
                        aggregators = [
                            a["ConfigurationAggregatorName"]
                            for page in pages(client, "describe_configuration_aggregators", {})
                            for a in page.get("ConfigurationAggregators", [])
                        ]
                        if not aggregators:
                            report(
                                source,
                                profile,
                                account,
                                region,
                                "partial",
                                "No configuration aggregators",
                            )
                            continue
                        expression = (
                            "SELECT arn, accountId, awsRegion, resourceType, resourceId, "
                            "resourceName, availabilityZone, configuration, relationships, tags, "
                            "configurationItemCaptureTime"
                        )
                        import json

                        for aggregator in aggregators:
                            try:
                                for status_page in pages(
                                    client,
                                    "describe_configuration_aggregator_sources_status",
                                    {"ConfigurationAggregatorName": aggregator},
                                ):
                                    for status in status_page.get("AggregatedSourceStatusList", []):
                                        if status.get("LastUpdateStatus") != "SUCCEEDED":
                                            report(
                                                source,
                                                profile,
                                                status.get("SourceId", account),
                                                status.get("AwsRegion", region),
                                                "partial",
                                                f"{aggregator}: {status.get('LastUpdateStatus')} "
                                                f"{status.get('LastErrorMessage', '')}",
                                            )
                            except Exception as exc:
                                report(
                                    source,
                                    profile,
                                    account,
                                    region,
                                    "partial",
                                    f"Aggregator coverage unavailable: {exc}",
                                )
                            for page in pages(
                                client,
                                "select_aggregate_resource_config",
                                {
                                    "ConfigurationAggregatorName": aggregator,
                                    "Expression": expression,
                                    "Limit": 100,
                                },
                            ):
                                records.extend(
                                    record(source, json.loads(r), aggregator)
                                    for r in page.get("Results", [])
                                )
                    report(source, profile, account, region, "complete", count=len(records) - start)
                except Exception as exc:
                    report(
                        source,
                        profile,
                        account,
                        region,
                        "partial" if len(records) > start else "error",
                        str(exc),
                        len(records) - start,
                    )
    graph = normalize_records(records, coverage)

    def clients(service, account, region):
        if account not in sessions:
            raise ValueError(
                f"No local profile for account {account}; configure an AssumeRole profile"
            )

        class Clients:
            def __getattr__(self, operation):
                def call(**kwargs):
                    last_error = None
                    for session in sessions[account]:
                        try:
                            client = session.client(service, region_name=region, config=retry)
                            return getattr(client, operation)(**kwargs)
                        except Exception as exc:
                            last_error = exc
                    raise last_error

                return call

        return Clients()

    settings = Settings(workspace=Path("."))
    for resource in graph.resources:
        if not supported_for(resource.resource_type):
            graph.coverage.append(
                Coverage(
                    source="describe",
                    profile="",
                    account_id=resource.account_id,
                    region=resource.region,
                    status="unsupported",
                    message=f"No Describe adapter: {resource.resource_type}",
                )
            )
            continue
        try:
            detail = fetch_resource(
                resource.arn, clients, settings, ResourceOwner(resource.account_id, resource.region)
            )
            add_detail(graph, detail)
            graph.coverage.append(
                Coverage(
                    source="describe",
                    profile="",
                    account_id=resource.account_id,
                    region=resource.region,
                    status="complete" if detail.lifecycle == "active" else "error",
                    message=detail.last_error or "",
                    count=1,
                )
            )
        except Exception as exc:
            graph.coverage.append(
                Coverage(
                    source="describe",
                    profile="",
                    account_id=resource.account_id,
                    region=resource.region,
                    status="error",
                    message=f"{resource.arn}: {exc}",
                )
            )
    return graph, records
