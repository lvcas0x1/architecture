"""Tests for the single-file HTML export."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from html.parser import HTMLParser

import pytest

from app.export.html import (
    build_bundle,
    bundle_payload,
    collect_icons,
    export_diagram,
    icon_file_for,
    svg_to_data_uri,
)
from app.models import Diagram, ExportOptions, Lifecycle, NormalizedResource, Row, Section

EC2_ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc"
ICON = "Architecture/Compute/Amazon-EC2"


def diagram_with_resource(icon_key: str = ICON) -> Diagram:
    """A resource only goes inside a container, so build the box around it."""
    return Diagram.model_validate(
        {
            "meta": {"title": "production"},
            "nodes": [
                {
                    "id": "g1",
                    "type": "group",
                    "position": {"x": 0, "y": 0},
                    "data": {"label": "vpc"},
                },
                {
                    "id": "n1",
                    "type": "resource",
                    "parentId": "g1",
                    "position": {"x": 0, "y": 0},
                    "data": {"iconKey": icon_key, "resourceRef": EC2_ARN},
                },
            ],
            "edges": [],
        }
    )


def seed(store, **over) -> NormalizedResource:
    payload = {
        "arn": EC2_ARN,
        "account_id": "123456789012",
        "region": "ap-northeast-1",
        "resource_type": "AWS::EC2::Instance",
        "resource_id": "i-0abc",
        "service": "EC2",
        "name": "ec2-ap1",
        "icon_key": ICON,
        "lifecycle": Lifecycle.ACTIVE,
        "fetched_at": datetime(2026, 9, 19, tzinfo=UTC),
        "sections": [Section(title="Overview", rows=[Row(label="Type", value="m5.large")])],
    }
    payload.update(over)
    resource = NormalizedResource(**payload)
    store.write_resource(resource)
    return resource


class TestDataUri:
    def test_svg_becomes_a_data_uri(self):
        uri = svg_to_data_uri('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
        assert uri.startswith("data:image/svg+xml;charset=utf-8,")

    def test_sharp_is_escaped(self):
        """A raw # would be read as a fragment and break the image."""
        uri = svg_to_data_uri('<svg fill="#ff0000"></svg>')
        assert "#" not in uri
        assert "%23ff0000" in uri

    def test_whitespace_is_collapsed(self):
        uri = svg_to_data_uri("<svg>\n\n   <rect/>\n</svg>")
        assert "\n" not in uri


class TestIconResolution:
    def test_outside_the_public_dir_is_rejected(self):
        assert icon_file_for("/../../etc/passwd") is None
        assert icon_file_for("../secrets") is None

    def test_missing_file_is_none(self):
        assert icon_file_for("/icons/Nope/Nope.svg") is None

    def test_placeholder_icons_resolve(self):
        assert icon_file_for(f"/icons-placeholder/{ICON}.svg") is not None


class TestBundle:
    def test_only_referenced_resources_are_included(self, store):
        seed(store)
        seed(
            store,
            arn="arn:aws:rds:ap-northeast-1:123456789012:db:other",
            resource_type="AWS::RDS::DBInstance",
            resource_id="other",
            service="RDS",
        )
        bundle = build_bundle(diagram_with_resource(), store)

        # Resources the diagram does not reference are left out
        assert list(bundle.resources) == [EC2_ARN]

    def test_only_used_icons_are_included(self, store):
        seed(store)
        bundle = build_bundle(diagram_with_resource(), store)
        assert list(bundle.icons) == [ICON]

    def test_raw_is_excluded_by_default(self, store):
        seed(store, raw={"InstanceId": "i-0abc", "secret": "value"})
        bundle = build_bundle(diagram_with_resource(), store)
        assert bundle.resources[EC2_ARN].raw is None

    def test_raw_can_be_included_explicitly(self, store):
        seed(store, raw={"InstanceId": "i-0abc"})
        bundle = build_bundle(diagram_with_resource(), store, ExportOptions(include_raw=True))
        assert bundle.resources[EC2_ARN].raw == {"InstanceId": "i-0abc"}

    def test_missing_resource_does_not_break_export(self, store):
        bundle = build_bundle(diagram_with_resource(), store)
        assert bundle.resources == {}
        assert bundle.diagram.nodes

    def test_unknown_icon_is_skipped(self, store):
        seed(store)
        bundle = build_bundle(diagram_with_resource("Architecture/Nope/Nope"), store)
        assert bundle.icons == {}

    def test_deleted_resources_are_still_exported(self, store):
        """A deleted resource stays in the diagram, so it is exported too."""
        seed(store, lifecycle=Lifecycle.DELETED, deleted_at=datetime(2026, 9, 19, tzinfo=UTC))
        bundle = build_bundle(diagram_with_resource(), store)
        assert bundle.resources[EC2_ARN].lifecycle is Lifecycle.DELETED


class TestHtml:
    def test_is_a_single_self_contained_document(self, store):
        seed(store)
        document = export_diagram(diagram_with_resource(), store)

        assert document.startswith("<!doctype html>")

        # Inspect actual resource references, not URL literals inside bundled JS
        # (e.g. Ajv's URI parser uses "http://" without making any request).
        class ResourceReferences(HTMLParser):
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                for attribute in ("src", "href", "srcset", "poster", "data"):
                    value = attrs.get(attribute)
                    if value is not None:
                        assert value.startswith(("data:", "#")), (tag, attribute, value)

        ResourceReferences().feed(document)

    def test_title_comes_from_the_diagram(self, store):
        seed(store)
        document = export_diagram(diagram_with_resource(), store)
        assert "<title>production</title>" in document

    def test_title_is_escaped(self, store):
        seed(store)
        diagram = diagram_with_resource()
        diagram.meta.title = "<script>alert(1)</script>"
        document = export_diagram(diagram, store)
        assert "<title>&lt;script&gt;" in document

    def test_embedded_json_cannot_close_the_script_tag(self, store):
        seed(store, name="</script><img src=x onerror=alert(1)>")
        document = export_diagram(diagram_with_resource(), store)

        # Escaped, so the document does not end early
        assert "</script><img" not in document
        assert document.rstrip().endswith("</html>")

    def test_embedded_bundle_is_valid_json(self, store):
        seed(store)
        document = export_diagram(diagram_with_resource(), store)
        match = re.search(
            r'<script type="application/json" id="arch-bundle">(.*?)</script>',
            document,
            re.DOTALL,
        )
        assert match
        payload = json.loads(match.group(1).replace("<\\/", "</"))

        assert payload["diagram"]["meta"]["title"] == "production"
        assert payload["resources"][EC2_ARN]["name"] == "ec2-ap1"
        assert payload["icons"][ICON].startswith("data:image/svg+xml")

    def test_viewer_is_inlined(self, store):
        seed(store)
        document = export_diagram(diagram_with_resource(), store)
        assert "arch-root" in document
        # The viewer's JS and CSS are inlined
        assert len(document) > 100_000


class TestExportApi:
    pytestmark = pytest.mark.anyio

    @pytest.fixture
    async def client(self, settings):
        from httpx2 import ASGITransport, AsyncClient

        from app import main
        from app.store import Store

        app = main.create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver", follow_redirects=True
        ) as client:
            client.store = Store(settings)  # type: ignore[attr-defined]
            yield client

    async def test_export_returns_html_as_a_download(self, client):
        seed(client.store)
        response = await client.post(
            "/api/export/html",
            json={"diagram": json.loads(diagram_with_resource().model_dump_json(by_alias=True))},
        )

        assert response.status_code == 200
        assert response.text.startswith("<!doctype html>")
        assert "attachment" in response.headers["content-disposition"]

    async def test_summary_reports_what_will_be_bundled(self, client):
        seed(client.store)
        response = await client.post(
            "/api/export/summary",
            json={"diagram": json.loads(diagram_with_resource().model_dump_json(by_alias=True))},
        )
        body = response.json()

        assert body["resourceCount"] == 1
        assert body["iconCount"] == 1
        assert body["missingResources"] == []

    async def test_summary_lists_unfetched_resources(self, client):
        response = await client.post(
            "/api/export/summary",
            json={"diagram": json.loads(diagram_with_resource().model_dump_json(by_alias=True))},
        )
        assert response.json()["missingResources"] == [EC2_ARN]

    async def test_saved_diagram_can_be_exported(self, client, settings):
        seed(client.store)
        client.store.write_diagram("prod", diagram_with_resource())

        response = await client.post("/api/diagrams/prod/export/html")
        assert response.status_code == 200
        # save=True, so a copy stays under exports
        assert list(settings.exports_dir.glob("*.html"))

    async def test_exporting_a_missing_diagram_is_404(self, client):
        assert (await client.post("/api/diagrams/none/export/html")).status_code == 404


def test_collect_icons_without_catalog_returns_empty(monkeypatch, store):
    from app.export import html as html_module

    monkeypatch.setattr(html_module, "load_icon_catalog", lambda: None)
    assert collect_icons(diagram_with_resource()) == {}


class TestMasking:
    """Masking for sharing outside."""

    def test_no_original_account_id_in_the_html(self, store) -> None:
        seed(store)
        html = export_diagram(diagram_with_resource(), store, ExportOptions(mask_account_ids=True))
        assert "123456789012" not in html
        assert "1234********" in html

    def test_unmasked_when_not_asked(self, store) -> None:
        seed(store)
        html = export_diagram(diagram_with_resource(), store, ExportOptions(mask_account_ids=False))
        assert "123456789012" in html

    def test_refs_and_resource_keys_stay_in_step(self, store) -> None:
        """Masking one side only would leave a diagram whose details cannot be found."""
        seed(store)
        bundle = build_bundle(diagram_with_resource(), store, ExportOptions(mask_account_ids=True))
        payload = json.loads(bundle_payload(bundle))

        refs = {
            node["data"]["resourceRef"]
            for node in payload["diagram"]["nodes"]
            if node["data"].get("resourceRef")
        }
        assert refs
        assert refs <= set(payload["resources"])


class TestAccountMasking:
    """What the mask must survive: no leaks, and no two accounts becoming one."""

    def test_an_id_glued_to_other_characters_is_masked(self) -> None:
        from app.export.html import mask_account_id

        assert mask_account_id("account_123456789012") == "account_1234********"
        assert mask_account_id("arn:aws:iam::123456789012:role/app").endswith(
            "1234********:role/app"
        )

    def test_a_longer_run_of_digits_is_left_alone(self) -> None:
        from app.export.html import mask_account_id

        assert mask_account_id("1234567890123") == "1234567890123"

    def test_two_accounts_with_the_same_prefix_stay_apart(self) -> None:
        from app.export.html import AccountMasker

        masker = AccountMasker()
        first = masker.text("arn:aws:iam::123456789012:role/app")
        second = masker.text("arn:aws:iam::123499999999:role/app")

        assert first != second
        assert masker.text("arn:aws:iam::123456789012:role/app") == first

    def test_a_numeric_account_id_in_raw_data_is_masked(self) -> None:
        from app.export.html import AccountMasker

        masked = AccountMasker().deep({"OwnerId": 123456789012, "Count": 12})

        assert masked["OwnerId"] == "1234********"
        assert masked["Count"] == 12
