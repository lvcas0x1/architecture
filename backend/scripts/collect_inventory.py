#!/usr/bin/env python3
"""Build a multi-account resource index."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.aws.session import Boto3ClientFactory  # noqa: E402
from app.collector.inventory import (  # noqa: E402
    build_inventory,
    collect_via_config_aggregator,
    collect_via_resource_explorer,
)
from app.config import get_settings  # noqa: E402
from app.store import Store  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--source",
        choices=("resource-explorer", "config-aggregator"),
        default=None,
        help="defaults to defaults.inventory_source in config/accounts.yaml",
    )
    parser.add_argument(
        "--account",
        default=None,
        help="account id the search runs from (defaults to the config file)",
    )
    parser.add_argument("--region", default=None, help="region of the aggregator index")
    parser.add_argument("--view-arn", default=None, help="Resource Explorer view ARN")
    parser.add_argument("--query", default="", help="Resource Explorer search string")
    parser.add_argument("--aggregator", default=None, help="AWS Config aggregator name")
    parser.add_argument("--dry-run", action="store_true", help="print the count without writing")
    args = parser.parse_args()

    settings = get_settings()
    store = Store(settings)
    clients = Boto3ClientFactory(settings)
    config = settings.collection

    # CLI arguments win. Without them, config/accounts.yaml is used.
    source = args.source or config.source
    if source == "config-aggregator":
        account = args.account or config.aggregator_account
        region = args.region or config.aggregator_region or settings.default_region
        aggregator = args.aggregator or config.aggregator_name
        if not aggregator:
            parser.error("--source config-aggregator needs --aggregator")
    else:
        account = args.account or config.explorer_account
        region = args.region or config.explorer_region or settings.default_region
        aggregator = None

    if not account:
        parser.error("pass --account, or set it in config/accounts.yaml")

    print(f"Collecting via {source} (account {account} / {region})...")
    if source == "resource-explorer":
        entries = list(
            collect_via_resource_explorer(
                clients,
                settings,
                account_id=account,
                region=region,
                view_arn=args.view_arn or config.view_arn,
                query=args.query,
            )
        )
    else:
        entries = list(
            collect_via_config_aggregator(
                clients,
                settings,
                account_id=account,
                region=region,
                aggregator_name=aggregator or "",
            )
        )

    inventory = build_inventory(entries, source=source, existing=store.read_inventory())

    by_service: dict[str, int] = {}
    for entry in inventory.entries:
        by_service[entry.service] = by_service.get(entry.service, 0) + 1
    for service, count in sorted(by_service.items(), key=lambda kv: -kv[1]):
        print(f"  {service:10} {count:5}")

    if args.dry_run:
        print(f"\n[dry-run] {len(inventory.entries)} entries (nothing written)")
        return 0

    path = store.write_inventory(inventory)
    print(f"\nSaved {len(inventory.entries)} entries to {path}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
