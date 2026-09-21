"""Supplying clients for several accounts."""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.config import Settings

#: Refresh this long before expiry.
_REFRESH_MARGIN = timedelta(minutes=5)
_SESSION_DURATION_SECONDS = 3600


class ClientFactory(Protocol):
    """(boto3 service name, account id, region) -> client."""

    def __call__(self, service: str, account_id: str, region: str) -> Any: ...


class MissingCredentialsError(RuntimeError):
    """No way to reach that account is configured."""


class Boto3ClientFactory:
    """Builds boto3 clients from an assumed-role session."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        #: account_id -> (credentials, expiry)
        self._credentials: dict[str, tuple[dict[str, str], datetime]] = {}

    def __call__(self, service: str, account_id: str, region: str) -> Any:
        import boto3

        account = self._settings.account(account_id)

        # Refuse regions the configuration does not list, so a call never lands
        # in the wrong region. An account with no regions listed is unrestricted.
        target_region = region or self._settings.default_region
        if account is not None and account.regions and target_region not in account.regions:
            raise MissingCredentialsError(
                f"Region {target_region} is not listed for account {account_id} "
                f"in config/accounts.yaml (allowed: {', '.join(account.regions)})"
            )

        # With no role configured, assume the running credentials belong to that account.
        if account is None or not account.role_arn:
            return boto3.client(service, region_name=target_region)

        credentials = self._assume(account.role_arn, account_id)
        return boto3.client(
            service,
            region_name=target_region,
            aws_access_key_id=credentials["AccessKeyId"],
            aws_secret_access_key=credentials["SecretAccessKey"],
            aws_session_token=credentials["SessionToken"],
        )

    def _assume(self, role_arn: str, account_id: str) -> dict[str, str]:
        import boto3

        with self._lock:
            cached = self._credentials.get(account_id)
            if cached and cached[1] - _REFRESH_MARGIN > datetime.now(UTC):
                return cached[0]

            sts = boto3.client("sts")
            response = sts.assume_role(
                RoleArn=role_arn,
                RoleSessionName=self._settings.session_name,
                DurationSeconds=_SESSION_DURATION_SECONDS,
            )
            credentials = response["Credentials"]
            expires_at = credentials.get("Expiration") or (
                datetime.now(UTC) + timedelta(seconds=_SESSION_DURATION_SECONDS)
            )
            self._credentials[account_id] = (credentials, expires_at)
            return credentials

    def invalidate(self, account_id: str | None = None) -> None:
        with self._lock:
            if account_id is None:
                self._credentials.clear()
            else:
                self._credentials.pop(account_id, None)
