"""Normalization for S3 buckets."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.models import NormalizedResource, Row, Section

from .base import BotoClient, Profile, ResourceContext, ResourceNotFoundError, register

logger = logging.getLogger(__name__)

#: Error codes that mean the bucket itself does not exist.
_MISSING_BUCKET_CODES = {"NoSuchBucket", "404", "NotFound"}


#: Error codes that mean "that setting is absent". Anything else counts as a failed fetch.
_NOT_CONFIGURED_CODES = {
    "NoSuchTagSet",
    "NoSuchLifecycleConfiguration",
    "NoSuchCORSConfiguration",
    "NoSuchWebsiteConfiguration",
    "NoSuchPublicAccessBlockConfiguration",
    "ServerSideEncryptionConfigurationNotFoundError",
}


def _safe[T](call: Callable[[], T]) -> T | None:
    """Return None for unset attributes; propagate permission errors."""
    try:
        return call()
    except Exception as exc:
        code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
        if code in _MISSING_BUCKET_CODES:
            raise
        if code in _NOT_CONFIGURED_CODES:
            return None
        logger.warning("Could not call an S3 side API: %s", code or exc)
        raise


@register
class S3BucketProfile(Profile):
    resource_type = "AWS::S3::Bucket"
    service = "S3"
    icon_key = "Architecture/Storage/Amazon-Simple-Storage-Service"
    boto_service = "s3"
    arn_keys = (("s3", ""),)
    not_found_codes = ("NoSuchBucket", "404", "NotFound")

    def describe(self, client: BotoClient, ctx: ResourceContext) -> dict[str, Any]:
        bucket = ctx.resource_id
        # Existence check. A NotFound-style error surfaces here when absent.
        try:
            client.head_bucket(Bucket=bucket)
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
            if code in _MISSING_BUCKET_CODES:
                raise ResourceNotFoundError(bucket) from exc
            raise

        return {
            "Name": bucket,
            "Location": _safe(lambda: client.get_bucket_location(Bucket=bucket)),
            "Encryption": _safe(lambda: client.get_bucket_encryption(Bucket=bucket)),
            "Versioning": _safe(lambda: client.get_bucket_versioning(Bucket=bucket)),
            "PublicAccessBlock": _safe(lambda: client.get_public_access_block(Bucket=bucket)),
            "Tagging": _safe(lambda: client.get_bucket_tagging(Bucket=bucket)),
            "Lifecycle": _safe(lambda: client.get_bucket_lifecycle_configuration(Bucket=bucket)),
        }

    def normalize(self, raw: dict[str, Any], ctx: ResourceContext) -> NormalizedResource:
        location = (raw.get("Location") or {}).get("LocationConstraint")
        region = "eu-west-1" if location == "EU" else location or "us-east-1"
        tags = self.tags_from(raw.get("Tagging") or {}, key="TagSet")

        encryption_rules = (
            (raw.get("Encryption") or {}).get("ServerSideEncryptionConfiguration") or {}
        ).get("Rules") or []
        algorithm = None
        if encryption_rules:
            algorithm = (encryption_rules[0].get("ApplyServerSideEncryptionByDefault") or {}).get(
                "SSEAlgorithm"
            )

        versioning = (raw.get("Versioning") or {}).get("Status") or "Not configured"
        pab = (raw.get("PublicAccessBlock") or {}).get("PublicAccessBlockConfiguration") or {}
        pab_all = bool(pab) and all(
            pab.get(key)
            for key in (
                "BlockPublicAcls",
                "IgnorePublicAcls",
                "BlockPublicPolicy",
                "RestrictPublicBuckets",
            )
        )
        lifecycle_rules = [
            rule.get("ID") or rule.get("Prefix") or "(unnamed)"
            for rule in (raw.get("Lifecycle") or {}).get("Rules") or []
        ]

        sections = [
            Section(
                title="Overview",
                rows=[
                    Row(label="Bucket name", value=raw.get("Name"), kind="code"),
                    Row(
                        label="Region",
                        # us-east-1 returns a LocationConstraint of None
                        value=region,
                    ),
                ],
            ),
            Section(
                title="Security",
                rows=[
                    Row(
                        label="Default encryption",
                        value=algorithm or "Not configured",
                        kind="badge",
                        tone="ok" if algorithm else "error",
                    ),
                    Row(
                        label="Public access block",
                        value="All settings on" if pab_all else "Partial",
                        kind="badge",
                        tone="ok" if pab_all else "error",
                    ),
                ],
            ),
            Section(
                title="Data management",
                rows=[
                    Row(
                        label="Versioning",
                        value=versioning,
                        kind="badge",
                        tone="ok" if versioning == "Enabled" else "muted",
                    ),
                    Row(label="Lifecycle rules", value=lifecycle_rules, kind="list"),
                ],
            ),
        ]

        return self.build(
            ctx,
            # The S3 ARN has no region, so use what Describe returned
            region=region,
            resource_type=self.resource_type,
            service=self.service,
            icon_key=self.icon_key,
            name=raw.get("Name"),
            tags=tags,
            sections=sections,
        )
