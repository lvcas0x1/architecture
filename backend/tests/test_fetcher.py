"""Tests for what \"Refresh\" does."""

from __future__ import annotations

import pytest

from app.aws.fetcher import UnsupportedResourceError, fetch_resource, resolve_profile
from app.models import Lifecycle
from tests.conftest import FakeClient, client_error, fake_factory

EC2_ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc"

RUNNING_INSTANCE = {
    "Reservations": [
        {
            "Instances": [
                {
                    "InstanceId": "i-0abc",
                    "InstanceType": "m5.large",
                    "State": {"Name": "running"},
                    "VpcId": "vpc-01",
                    "SubnetId": "subnet-01",
                    "SecurityGroups": [],
                    "Tags": [{"Key": "Name", "Value": "ec2-ap1"}],
                }
            ]
        }
    ]
}


def test_success_is_active(settings):
    client = FakeClient({"describe_instances": RUNNING_INSTANCE})
    resource = fetch_resource(EC2_ARN, fake_factory(client), settings)

    assert resource.lifecycle is Lifecycle.ACTIVE
    assert resource.name == "ec2-ap1"
    assert resource.account_alias == "prod"
    assert resource.deleted_at is None
    assert resource.last_error is None


def test_account_alias_comes_from_config(settings):
    client = FakeClient({"describe_instances": RUNNING_INSTANCE})
    resource = fetch_resource(
        "arn:aws:ec2:ap-northeast-1:999999999999:instance/i-0abc",
        fake_factory(client),
        settings,
    )
    # An unregistered account does not break it
    assert resource.account_alias is None


class TestDeleted:
    def test_empty_result_means_deleted(self, settings):
        client = FakeClient({"describe_instances": {"Reservations": []}})
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)

        assert resource.lifecycle is Lifecycle.DELETED
        assert resource.deleted_at is not None
        assert resource.last_error is None

    def test_declared_not_found_code(self, settings):
        client = FakeClient({"describe_instances": client_error("InvalidInstanceID.NotFound")})
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)
        assert resource.lifecycle is Lifecycle.DELETED

    def test_generic_not_found_suffix(self, settings):
        client = FakeClient({"describe_instances": client_error("SomethingNotFound")})
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)
        assert resource.lifecycle is Lifecycle.DELETED

    def test_deleted_keeps_identity_so_the_node_stays_drawable(self, settings):
        client = FakeClient({"describe_instances": {"Reservations": []}})
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)

        # It is greyed out rather than removed, so keep what the display needs
        assert resource.arn == EC2_ARN
        assert resource.resource_id == "i-0abc"
        assert resource.service == "EC2"
        assert resource.icon_key
        assert resource.resource_type == "AWS::EC2::Instance"


class TestError:
    @pytest.mark.parametrize(
        "code",
        ["AccessDenied", "AccessDeniedException", "UnauthorizedOperation", "AuthFailure"],
    )
    def test_permission_errors_are_not_deletions(self, settings, code: str):
        client = FakeClient({"describe_instances": client_error(code)})
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)

        assert resource.lifecycle is Lifecycle.ERROR
        assert resource.lifecycle is not Lifecycle.DELETED
        assert resource.deleted_at is None
        assert code in (resource.last_error or "")

    def test_throttling_is_an_error(self, settings):
        client = FakeClient({"describe_instances": client_error("Throttling")})
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)
        assert resource.lifecycle is Lifecycle.ERROR

    def test_connection_failure_is_an_error(self, settings):
        from botocore.exceptions import EndpointConnectionError

        client = FakeClient(
            {"describe_instances": EndpointConnectionError(endpoint_url="https://ec2")}
        )
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)
        assert resource.lifecycle is Lifecycle.ERROR

    def test_normalize_bug_does_not_break_the_diagram(self, settings):
        # An unexpected response shape (no State) must not break the diagram
        client = FakeClient(
            {"describe_instances": {"Reservations": [{"Instances": [{"Tags": "Not a valid ARN"}]}]}}
        )
        resource = fetch_resource(EC2_ARN, fake_factory(client), settings)
        assert resource.lifecycle is Lifecycle.ERROR
        assert resource.last_error


class TestUnsupported:
    def test_unknown_service_is_reported_clearly(self):
        with pytest.raises(UnsupportedResourceError, match="Unsupported resource"):
            resolve_profile("arn:aws:kinesis:ap-northeast-1:123456789012:stream/s1")

    def test_malformed_arn(self):
        with pytest.raises(UnsupportedResourceError):
            resolve_profile("this is not an ARN")

    def test_fetch_propagates_unsupported(self, settings):
        with pytest.raises(UnsupportedResourceError):
            fetch_resource(
                "arn:aws:kinesis:ap-northeast-1:123456789012:stream/s1",
                fake_factory(FakeClient({})),
                settings,
            )


def test_client_is_requested_for_the_right_account_and_region(settings):
    seen: list[tuple[str, str, str]] = []

    def factory(service: str, account_id: str, region: str):
        seen.append((service, account_id, region))
        return FakeClient({"describe_instances": RUNNING_INSTANCE})

    fetch_resource("arn:aws:ec2:us-east-1:123456789012:instance/i-0abc", factory, settings)
    assert seen == [("ec2", "123456789012", "us-east-1")]


class TestAccountResolution:
    """Resources whose ARN has no account id (S3 and friends)."""

    S3_ARN = "arn:aws:s3:::prod-app-assets"

    def test_fills_in_the_only_configured_account(self, settings) -> None:
        client = FakeClient(
            {
                "head_bucket": {},
                "get_bucket_location": {"LocationConstraint": "ap-northeast-1"},
                "get_bucket_tagging": {"TagSet": []},
                "get_bucket_versioning": {},
                "get_bucket_encryption": {},
                "get_public_access_block": {},
                "get_bucket_lifecycle_configuration": {},
            }
        )
        resource = fetch_resource(self.S3_ARN, fake_factory(client), settings)

        assert resource.lifecycle is Lifecycle.ACTIVE
        assert resource.account_id == "123456789012"

    def test_uses_the_region_that_was_fetched(self, settings) -> None:
        client = FakeClient(
            {
                "head_bucket": {},
                "get_bucket_location": {"LocationConstraint": "eu-west-1"},
                "get_bucket_tagging": {"TagSet": []},
                "get_bucket_versioning": {},
                "get_bucket_encryption": {},
                "get_public_access_block": {},
                "get_bucket_lifecycle_configuration": {},
            }
        )
        resource = fetch_resource(self.S3_ARN, fake_factory(client), settings)
        assert resource.region == "eu-west-1"

    def test_says_why_when_the_account_is_ambiguous(self, settings) -> None:
        import dataclasses

        # No accounts configured (or several, with no way to choose)
        empty = dataclasses.replace(settings, accounts={})
        resource = fetch_resource(self.S3_ARN, fake_factory(FakeClient({})), empty)

        assert resource.lifecycle is Lifecycle.ERROR
        assert "account" in (resource.last_error or "")


class TestOwnerFromInventory:
    """With several accounts configured, the index says who owns an S3 bucket."""

    S3_ARN = "arn:aws:s3:::prod-app-assets"

    def _s3_client(self) -> FakeClient:
        return FakeClient(
            {
                "head_bucket": {},
                "get_bucket_location": {"LocationConstraint": "ap-northeast-1"},
                "get_bucket_tagging": {"TagSet": []},
                "get_bucket_versioning": {},
                "get_bucket_encryption": {},
                "get_public_access_block": {},
                "get_bucket_lifecycle_configuration": {},
            }
        )

    def test_owner_wins_over_guessing(self, settings) -> None:
        import dataclasses

        from app.aws.fetcher import ResourceOwner
        from app.config import AccountConfig

        several = dataclasses.replace(
            settings,
            accounts={
                "123456789012": AccountConfig(id="123456789012"),
                "210987654321": AccountConfig(id="210987654321"),
            },
        )
        resource = fetch_resource(
            self.S3_ARN,
            fake_factory(self._s3_client()),
            several,
            ResourceOwner(account_id="210987654321", region="ap-northeast-1"),
        )

        assert resource.account_id == "210987654321"


class TestRegionRestriction:
    """A region the configuration does not list is a lifecycle, not a crash."""

    def test_becomes_an_error_lifecycle(self, settings) -> None:
        from app.aws.session import MissingCredentialsError

        def factory(service: str, account_id: str, region: str):
            raise MissingCredentialsError(f"Region {region} is not listed")

        resource = fetch_resource(EC2_ARN, factory, settings)

        assert resource.lifecycle is Lifecycle.ERROR
        assert "not listed" in (resource.last_error or "")
        assert resource.account_id == "123456789012"


class TestRawDescribe:
    """The raw Describe response is kept only when the configuration asks for it."""

    def test_left_out_by_default(self, settings) -> None:
        client = FakeClient({"describe_instances": RUNNING_INSTANCE})
        assert fetch_resource(EC2_ARN, fake_factory(client), settings).raw is None

    def test_kept_when_configured(self, settings) -> None:
        import dataclasses

        keeping = dataclasses.replace(settings, keep_raw_describe=True)
        client = FakeClient({"describe_instances": RUNNING_INSTANCE})
        resource = fetch_resource(EC2_ARN, fake_factory(client), keeping)

        assert resource.raw is not None
        assert resource.raw["InstanceId"] == "i-0abc"


def test_placeholder_owner_does_not_override_a_configured_account(settings):
    from app.aws.fetcher import ResourceOwner, _resolve_account_id

    assert _resolve_account_id("", settings, ResourceOwner("000000000000")) == "123456789012"


def test_malformed_instance_id_is_error_not_deleted(settings):
    from app.aws.fetcher import fetch_resource
    from tests.conftest import FakeClient, client_error, fake_factory

    client = FakeClient({"describe_instances": client_error("InvalidInstanceID.Malformed")})
    result = fetch_resource(
        "arn:aws:ec2:ap-northeast-1:123456789012:instance/bad", fake_factory(client), settings
    )
    assert result.lifecycle == "error"
    assert "Malformed" in result.last_error
