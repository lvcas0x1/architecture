"""ARN parsing. A diagram holds nothing but ARN references, so account, region and
resource kind all have to be recoverable from one.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

_ARN_PARTS = 6


class InvalidArnError(ValueError):
    """A string that cannot be read as an ARN."""


@dataclass(frozen=True, slots=True)
class ParsedArn:
    """The parts of ``arn:partition:service:region:account-id:resource``."""

    raw: str
    partition: str
    service: str
    region: str
    account_id: str
    #: The whole resource part. For example "instance/i-0abc" / "db:mydb" / "loadbalancer/app/x/id".
    resource: str

    @property
    def resource_prefix(self) -> str:
        """Return the resource prefix, or an empty string for bare IDs."""
        for separator in ("/", ":"):
            if separator in self.resource:
                return self.resource.split(separator, 1)[0]
        return ""

    @property
    def resource_id(self) -> str:
        """Return the resource ID without its type prefix."""
        prefix = self.resource_prefix
        if not prefix:
            return self.resource
        return self.resource[len(prefix) + 1 :]

    @property
    def lookup_key(self) -> tuple[str, str]:
        """Lookup key for the Profile registry."""
        return (self.service, self.resource_prefix)


def parse_arn(arn: str) -> ParsedArn:
    """Split an ARN. Handles the forms whose resource part contains ':'."""
    parts = arn.split(":", _ARN_PARTS - 1)
    if len(parts) < _ARN_PARTS or parts[0] != "arn":
        raise InvalidArnError(f"Not a valid ARN: {arn}")

    _, partition, service, region, account_id, resource = parts
    if not service or not resource:
        raise InvalidArnError(f"service or resource is empty: {arn}")

    return ParsedArn(
        raw=arn,
        partition=partition,
        service=service,
        region=region,
        account_id=account_id,
        resource=resource,
    )


def arn_to_filename(arn: str) -> str:
    """Map an ARN to a collision-resistant resource filename."""
    parsed = parse_arn(arn)
    safe_resource = parsed.resource.replace("/", "_").replace(":", "_")
    # Both / and : become _, so two different ARNs could produce the same name
    # (function:foo:bar and function:foo_bar). A short fingerprint keeps them apart.
    fingerprint = hashlib.sha256(arn.encode("utf-8")).hexdigest()[:8]
    stem = f"{parsed.account_id}_{parsed.region}_{parsed.service}_{safe_resource}"
    return f"{stem}_{fingerprint}.json"
