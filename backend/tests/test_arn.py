"""ARN parsing tests."""

from __future__ import annotations

import pytest

from app.aws.arn import InvalidArnError, arn_to_filename, parse_arn


@pytest.mark.parametrize(
    ("arn", "service", "prefix", "resource_id"),
    [
        (
            "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc",
            "ec2",
            "instance",
            "i-0abc",
        ),
        ("arn:aws:rds:ap-northeast-1:123456789012:db:mydb", "rds", "db", "mydb"),
        (
            "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/x/1a2b",
            "elasticloadbalancing",
            "loadbalancer",
            "app/x/1a2b",
        ),
        ("arn:aws:s3:::my-bucket", "s3", "", "my-bucket"),
        (
            "arn:aws:lambda:ap-northeast-1:123456789012:function:my-fn",
            "lambda",
            "function",
            "my-fn",
        ),
        ("arn:aws:iam::123456789012:role/my-role", "iam", "role", "my-role"),
    ],
)
def test_parse(arn: str, service: str, prefix: str, resource_id: str):
    parsed = parse_arn(arn)
    assert parsed.service == service
    assert parsed.resource_prefix == prefix
    assert parsed.resource_id == resource_id


def test_account_and_region():
    parsed = parse_arn("arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc")
    assert parsed.account_id == "123456789012"
    assert parsed.region == "ap-northeast-1"
    assert parsed.partition == "aws"


def test_s3_has_no_account_or_region():
    parsed = parse_arn("arn:aws:s3:::my-bucket")
    assert parsed.account_id == ""
    assert parsed.region == ""


@pytest.mark.parametrize(
    "bad", ["", "i-0abc", "arn:aws:ec2", "arn:aws:ec2:region:acct", "notanarn:x:y:z:a:b"]
)
def test_invalid(bad: str):
    with pytest.raises(InvalidArnError):
        parse_arn(bad)


def test_lookup_key_matches_profile_registration():
    assert parse_arn("arn:aws:ec2:r:a:instance/i-1").lookup_key == ("ec2", "instance")
    assert parse_arn("arn:aws:s3:::b").lookup_key == ("s3", "")


class TestFilename:
    def test_path_separators_are_flattened(self):
        name = arn_to_filename(
            "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/x/1a2b"
        )
        assert "/" not in name
        assert name.endswith(".json")

    def test_different_resources_do_not_collide(self):
        a = arn_to_filename("arn:aws:ec2:ap-northeast-1:123456789012:instance/i-1")
        b = arn_to_filename("arn:aws:ec2:ap-northeast-1:123456789012:instance/i-2")
        c = arn_to_filename("arn:aws:ec2:us-east-1:123456789012:instance/i-1")
        assert len({a, b, c}) == 3
