"""Tests for the normalized resource JSON."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models import Lifecycle, NormalizedResource

EC2_ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc123"


def build(**overrides) -> NormalizedResource:
    payload = {
        "arn": EC2_ARN,
        "accountId": "123456789012",
        "accountAlias": "prod",
        "region": "ap-northeast-1",
        "resourceType": "AWS::EC2::Instance",
        "resourceId": "i-0abc123",
        "service": "EC2",
        "name": "ec2-ap1",
        "iconKey": "Architecture/Compute/Amazon-EC2",
        "lifecycle": "active",
        "fetchedAt": datetime(2026, 9, 19, 3, 12, tzinfo=UTC),
        "tags": [{"key": "Env", "value": "prod"}, {"key": "Owner", "value": "platform"}],
        "sections": [
            {
                "title": "Overview",
                "rows": [
                    {"label": "Instance type", "value": "m5.large"},
                    {"label": "State", "value": "running", "kind": "badge", "tone": "ok"},
                ],
            },
        ],
        "relations": [
            {
                "type": "in-subnet",
                "targetArn": "arn:aws:ec2:ap-northeast-1:123456789012:subnet/subnet-0a",
            },
        ],
    }
    payload.update(overrides)
    return NormalizedResource.model_validate(payload)


def test_display_fields_present():
    """The four label lines under the icon are all present."""
    r = build()
    assert (r.service, r.name, r.resource_id) == ("EC2", "ec2-ap1", "i-0abc123")
    assert [t.key for t in r.tags] == ["Env", "Owner"]


def test_sections_preserve_order():
    """Display order in the popup = the order of sections and rows."""
    r = build(
        sections=[
            {"title": "A", "rows": []},
            {"title": "B", "rows": []},
            {"title": "C", "rows": []},
        ]
    )
    assert [s.title for s in r.sections] == ["A", "B", "C"]


def test_deleted_resource_marks_stale():
    """A deleted resource is expressed as a lifecycle, never removed from the diagram."""
    r = build(lifecycle="deleted", deletedAt=datetime(2026, 9, 19, tzinfo=UTC))
    assert r.lifecycle is Lifecycle.DELETED
    assert r.is_stale
    assert r.deleted_at is not None


def test_error_is_distinct_from_deleted():
    """A permission error or throttling is never mistaken for a deletion."""
    r = build(lifecycle="error", lastError="AccessDenied: ec2:DescribeInstances")
    assert r.lifecycle is Lifecycle.ERROR
    assert r.lifecycle is not Lifecycle.DELETED


def test_duplicate_tag_keys_rejected():
    with pytest.raises(ValidationError, match="Duplicate tag keys"):
        build(tags=[{"key": "Env", "value": "prod"}, {"key": "Env", "value": "stg"}])


def test_resource_type_format_enforced():
    with pytest.raises(ValidationError):
        build(resourceType="ec2-instance")


def test_camel_case_roundtrip():
    r = build()
    dumped = r.model_dump(mode="json")
    assert "accountId" in dumped and "iconKey" in dumped and "fetchedAt" in dumped
    assert NormalizedResource.model_validate(dumped) == r
