"""Turning a single ARN into normalized resource JSON (the "Refresh" button)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import NamedTuple

from botocore.exceptions import BotoCoreError, ClientError

from app.aws.arn import InvalidArnError, parse_arn
from app.aws.profiles import (
    Profile,
    ResourceContext,
    ResourceNotFoundError,
    profile_for_arn_key,
    profile_for_type,
)
from app.aws.session import ClientFactory, MissingCredentialsError
from app.config import Settings
from app.models import Lifecycle, NormalizedResource, Section

logger = logging.getLogger(__name__)

#: Error codes that mean "no permission". Kept separate from deleted.
ACCESS_DENIED_CODES = frozenset(
    {
        "AccessDenied",
        "AccessDeniedException",
        "UnauthorizedOperation",
        "AuthFailure",
        "InvalidClientTokenId",
    }
)

#: Codes ending in these are taken to mean "the target does not exist".
_NOT_FOUND_SUFFIXES = ("NotFound", "NotFoundException", "NotFoundFault", "NoSuchEntity")


class UnsupportedResourceError(Exception):
    """An ARN with no matching Profile."""


def resolve_profile(arn: str) -> Profile:
    """Find the Profile for an ARN."""
    try:
        parsed = parse_arn(arn)
    except InvalidArnError as exc:
        raise UnsupportedResourceError(str(exc)) from exc

    profile = profile_for_arn_key(parsed.lookup_key)
    if profile is None:
        raise UnsupportedResourceError(
            f"Unsupported resource: {parsed.service}/{parsed.resource_prefix or '(none)'}"
            " (add a Profile under backend/app/aws/profiles/)"
        )
    return profile


def _is_not_found(code: str, profile: Profile) -> bool:
    return code in profile.not_found_codes or code.endswith(_NOT_FOUND_SUFFIXES)


class ResourceOwner(NamedTuple):
    """Owner metadata for accountless ARNs such as S3 buckets."""

    account_id: str | None = None
    region: str | None = None


def _placeholder(
    arn: str,
    profile: Profile | None,
    lifecycle: Lifecycle,
    *,
    settings: Settings,
    account_id: str = "",
    region: str = "",
    error: str | None = None,
) -> NormalizedResource:
    """The smallest JSON that keeps the diagram intact when a fetch fails."""
    parsed = parse_arn(arn)
    now = datetime.now(UTC)
    return NormalizedResource(
        arn=arn,
        account_id=account_id or parsed.account_id or "000000000000",
        account_alias=settings.alias_for(account_id or parsed.account_id),
        region=parsed.region or region or settings.default_region,
        resource_type=profile.resource_type if profile else "AWS::Unknown::Unknown",
        resource_id=parsed.resource_id,
        service=profile.service if profile else parsed.service.upper(),
        name=None,
        tags=[],
        icon_key=profile.icon_key if profile else "Architecture/Compute/Amazon-EC2",
        lifecycle=lifecycle,
        fetched_at=now,
        deleted_at=now if lifecycle is Lifecycle.DELETED else None,
        last_error=error,
        sections=[Section(title="Info", rows=[])],
    )


def _resolve_account_id(from_arn: str, settings: Settings, owner: ResourceOwner) -> str:
    """Resolve accountless ARNs from inventory or a single configured account."""
    if from_arn:
        return from_arn
    if owner.account_id and owner.account_id != "000000000000":
        return owner.account_id
    if len(settings.accounts) == 1:
        return next(iter(settings.accounts))
    return ""


def fetch_resource(
    arn: str,
    clients: ClientFactory,
    settings: Settings,
    owner: ResourceOwner | None = None,
) -> NormalizedResource:
    """Return active, deleted, or error resource details."""
    profile = resolve_profile(arn)
    parsed = parse_arn(arn)
    owner = owner or ResourceOwner()
    if owner.account_id == "000000000000":
        # A failed lookup's placeholder knows neither the owner nor the region.
        owner = ResourceOwner()
    account_id = _resolve_account_id(parsed.account_id, settings, owner)
    region = parsed.region or owner.region or settings.default_region

    ctx = ResourceContext(
        arn=arn,
        account_id=account_id,
        account_alias=settings.alias_for(account_id),
        region=region,
        resource_id=parsed.resource_id,
        fetched_at=datetime.now(UTC),
        partition=parsed.partition or "aws",
    )

    if not ctx.account_id:
        return _placeholder(
            arn,
            profile,
            Lifecycle.ERROR,
            settings=settings,
            region=region,
            error=(
                "Cannot tell which account owns this resource. "
                "The ARN has no account id — set the owning account in config/accounts.yaml."
            ),
        )

    try:
        client = clients(profile.boto_service, ctx.account_id, ctx.region)
        raw = profile.describe(client, ctx)
    except ResourceNotFoundError:
        logger.info("Treated as deleted: %s", arn)
        return _placeholder(
            arn,
            profile,
            Lifecycle.DELETED,
            settings=settings,
            account_id=account_id,
            region=region,
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        message = exc.response.get("Error", {}).get("Message", str(exc))
        if _is_not_found(code, profile):
            logger.info("Treated as deleted: %s (%s)", arn, code)
            return _placeholder(
                arn,
                profile,
                Lifecycle.DELETED,
                settings=settings,
                account_id=account_id,
                region=region,
            )
        # No permission is not "gone". Say so separately.
        logger.warning("Fetch failed: %s (%s)", arn, code)
        return _placeholder(
            arn,
            profile,
            Lifecycle.ERROR,
            settings=settings,
            account_id=account_id,
            region=region,
            error=f"{code}: {message}",
        )
    except MissingCredentialsError as exc:
        # No credentials, or a region the configuration does not allow. Promised as
        # a lifecycle, so it must not escape as an exception.
        logger.warning("Cannot reach the account: %s (%s)", arn, exc)
        return _placeholder(
            arn,
            profile,
            Lifecycle.ERROR,
            settings=settings,
            account_id=account_id,
            region=region,
            error=str(exc),
        )
    except (BotoCoreError, OSError) as exc:
        logger.warning("Could not reach AWS: %s (%s)", arn, exc)
        return _placeholder(
            arn,
            profile,
            Lifecycle.ERROR,
            settings=settings,
            account_id=account_id,
            region=region,
            error=str(exc),
        )

    try:
        resource = profile.normalize(raw, ctx)
    except Exception as exc:
        logger.exception("Normalization failed: %s", arn)
        return _placeholder(
            arn,
            profile,
            Lifecycle.ERROR,
            settings=settings,
            account_id=account_id,
            region=region,
            error=f"Normalization failed: {exc}",
        )

    if not settings.keep_raw_describe:
        return resource
    # Keys a Profile added for itself (_Listeners and the like) are not part of
    # the Describe response, so they stay out of what is kept.
    return resource.model_copy(
        update={"raw": {k: v for k, v in raw.items() if not k.startswith("_")}}
    )


def supported_for(resource_type: str) -> bool:
    return profile_for_type(resource_type) is not None
