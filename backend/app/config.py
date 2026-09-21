"""Loading the configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REGION = "ap-northeast-1"


@dataclass(frozen=True, slots=True)
class AccountConfig:
    id: str
    alias: str | None = None
    role_arn: str | None = None
    #: Regions this account may be called in. Empty means no restriction.
    regions: tuple[str, ...] = ()
    #: Informational. The app only ever reads from AWS; nothing writes.
    readonly: bool = True


@dataclass(frozen=True, slots=True)
class CollectionConfig:
    """Defaults for inventory collection (``config/accounts.yaml``)."""

    source: str = "resource-explorer"
    #: The account Resource Explorer is called from (the delegated administrator).
    explorer_account: str | None = None
    explorer_region: str | None = None
    view_arn: str | None = None
    #: AWS Config aggregator.
    aggregator_account: str | None = None
    aggregator_region: str | None = None
    aggregator_name: str | None = None


@dataclass(frozen=True, slots=True)
class Settings:
    workspace: Path
    accounts: dict[str, AccountConfig] = field(default_factory=dict)
    default_region: str = DEFAULT_REGION
    collection: CollectionConfig = field(default_factory=CollectionConfig)
    #: Keep the raw Describe response in each resource JSON. Off by default: it
    #: multiplies the file size and stores addresses and tags the display never uses.
    keep_raw_describe: bool = False
    #: Session name used when assuming a role. It shows up in CloudTrail, so make it identifiable.
    session_name: str = "architecture-diagram"

    @property
    def inventory_index(self) -> Path:
        return self.workspace / "inventory" / "index.json"

    @property
    def resources_dir(self) -> Path:
        return self.workspace / "inventory" / "resources"

    @property
    def diagrams_dir(self) -> Path:
        return self.workspace / "diagrams"

    @property
    def exports_dir(self) -> Path:
        return self.workspace / "exports"

    @property
    def icon_scopes(self) -> Path:
        """The user's icon attributes."""
        return self.workspace / "icon-scopes.json"

    def account(self, account_id: str) -> AccountConfig | None:
        return self.accounts.get(account_id)

    def alias_for(self, account_id: str) -> str | None:
        account = self.accounts.get(account_id)
        return account.alias if account else None

    def ensure_dirs(self) -> None:
        for path in (self.resources_dir, self.diagrams_dir, self.exports_dir):
            path.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True, slots=True)
class AccountsFile:
    """What ``config/accounts.yaml`` yields."""

    accounts: dict[str, AccountConfig]
    default_region: str
    collection: CollectionConfig
    keep_raw_describe: bool = False


def load_accounts(path: Path) -> AccountsFile:
    """Read ``config/accounts.yaml``. Works empty when absent (the file paths still work)."""
    if not path.exists():
        return AccountsFile({}, DEFAULT_REGION, CollectionConfig())

    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    defaults = data.get("defaults") or {}
    default_region = defaults.get("region", DEFAULT_REGION)

    explorer = data.get("resource_explorer") or {}
    aggregator = data.get("config_aggregator") or {}
    collection = CollectionConfig(
        source=defaults.get("inventory_source", "resource-explorer"),
        explorer_account=explorer.get("delegated_admin_account"),
        explorer_region=explorer.get("aggregator_region"),
        view_arn=explorer.get("view_arn"),
        aggregator_account=aggregator.get("account"),
        aggregator_region=aggregator.get("region"),
        aggregator_name=aggregator.get("name"),
    )

    accounts: dict[str, AccountConfig] = {}
    for entry in data.get("accounts") or []:
        account_id = str(entry.get("id", "")).strip()
        if not account_id:
            continue
        accounts[account_id] = AccountConfig(
            id=account_id,
            alias=entry.get("alias"),
            role_arn=entry.get("role_arn"),
            regions=tuple(entry.get("regions") or ()),
            readonly=bool(entry.get("readonly", True)),
        )
    return AccountsFile(
        accounts=accounts,
        default_region=default_region,
        collection=collection,
        keep_raw_describe=bool(defaults.get("keep_raw_describe", False)),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """``ARCH_WORKSPACE`` / ``ARCH_ACCOUNTS`` override these."""
    workspace = Path(os.environ.get("ARCH_WORKSPACE", REPO_ROOT / "workspace"))
    accounts_path = Path(os.environ.get("ARCH_ACCOUNTS", REPO_ROOT / "config" / "accounts.yaml"))
    config = load_accounts(accounts_path)
    settings = Settings(
        workspace=workspace,
        accounts=config.accounts,
        default_region=config.default_region,
        collection=config.collection,
        keep_raw_describe=config.keep_raw_describe,
    )
    settings.ensure_dirs()
    return settings
