"""Tests for workspace file I/O."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.models import Diagram, Lifecycle, NormalizedResource, Section
from app.store import DiagramNotFoundError, InvalidDiagramIdError

ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc"


def make_resource(**over) -> NormalizedResource:
    payload = {
        "arn": ARN,
        "account_id": "123456789012",
        "account_alias": "prod",
        "region": "ap-northeast-1",
        "resource_type": "AWS::EC2::Instance",
        "resource_id": "i-0abc",
        "service": "EC2",
        "name": "ec2-ap1",
        "icon_key": "Architecture/Compute/Amazon-EC2",
        "lifecycle": Lifecycle.ACTIVE,
        "fetched_at": datetime(2026, 9, 19, tzinfo=UTC),
        "sections": [Section(title="Overview", rows=[])],
    }
    payload.update(over)
    return NormalizedResource(**payload)


def make_diagram(title: str = "diagram") -> Diagram:
    return Diagram.model_validate({"meta": {"title": title}, "nodes": [], "edges": []})


class TestResources:
    def test_round_trip(self, store):
        store.write_resource(make_resource())
        loaded = store.read_resource(ARN)
        assert loaded is not None
        assert loaded.name == "ec2-ap1"

    def test_missing_returns_none(self, store):
        assert store.read_resource(ARN) is None

    def test_overwrite_replaces(self, store):
        store.write_resource(make_resource())
        store.write_resource(make_resource(name="new name"))
        assert store.read_resource(ARN).name == "new name"
        assert len(store.all_resources()) == 1

    def test_broken_file_is_skipped_not_fatal(self, store, settings):
        store.write_resource(make_resource())
        (settings.resources_dir / "broken.json").write_text("{broken", encoding="utf-8")

        assert len(store.all_resources()) == 1
        assert store.read_resource(ARN) is not None

    def test_arns_with_slashes_do_not_collide(self, store):
        alb = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/x/1a"
        store.write_resource(make_resource())
        store.write_resource(
            make_resource(
                arn=alb,
                resource_type="AWS::ElasticLoadBalancingV2::LoadBalancer",
                resource_id="app/x/1a",
                service="ELB",
            )
        )
        assert len(store.all_resources()) == 2


class TestInventory:
    def test_built_from_resources_when_index_missing(self, store):
        store.write_resource(make_resource())
        inventory = store.read_inventory()

        assert [e.arn for e in inventory.entries] == [ARN]
        assert inventory.entries[0].has_detail is True

    def test_written_index_is_preferred(self, store):
        store.write_resource(make_resource())
        inventory = store.inventory_from_resources()
        store.write_inventory(inventory)

        assert len(store.read_inventory().entries) == 1

    def test_empty_workspace_gives_empty_inventory(self, store):
        assert store.read_inventory().entries == []

    def test_parallel_writes_keep_every_index_entry(self, store):
        """Bulk refresh writes from several threads; the index is read and written whole."""
        from concurrent.futures import ThreadPoolExecutor

        arns = [f"arn:aws:ec2:ap-northeast-1:123456789012:instance/i-{n:04d}" for n in range(12)]
        for arn in arns:
            store.write_resource(
                make_resource(arn=arn, resource_id=arn.rsplit("/", 1)[1], name=None)
            )
        store.write_inventory(store.inventory_from_resources())

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(
                pool.map(
                    lambda arn: store.write_resource(
                        make_resource(arn=arn, resource_id=arn.rsplit("/", 1)[1], name="named")
                    ),
                    arns,
                )
            )

        names = {entry.name for entry in store.read_inventory().entries}
        assert names == {"named"}


class TestDiagrams:
    def test_round_trip(self, store):
        store.write_diagram("prod", make_diagram("production"))
        assert store.read_diagram("prod").meta.title == "production"

    def test_listing_shows_titles(self, store):
        store.write_diagram("a", make_diagram("diagram A"))
        store.write_diagram("b", make_diagram("diagram B"))
        titles = {item["title"] for item in store.list_diagrams()}
        assert titles == {"diagram A", "diagram B"}

    def test_missing_raises(self, store):
        with pytest.raises(DiagramNotFoundError):
            store.read_diagram("none")

    def test_delete(self, store):
        store.write_diagram("x", make_diagram())
        store.delete_diagram("x")
        assert store.list_diagrams() == []
        with pytest.raises(DiagramNotFoundError):
            store.delete_diagram("x")

    @pytest.mark.parametrize("bad", ["../escape", "a/b", "", "..", "x" * 200, "with\\backslash"])
    def test_path_traversal_is_rejected(self, store, bad: str):
        with pytest.raises(InvalidDiagramIdError):
            store.diagram_path(bad)

    def test_spaces_in_ids_are_allowed(self, store):
        store.write_diagram("prod-setup v2", make_diagram())
        assert store.read_diagram("prod-setup v2") is not None


def test_atomic_write_leaves_no_temp_files(store, settings):
    store.write_resource(make_resource())
    store.write_diagram("d", make_diagram())
    leftovers = list(settings.workspace.rglob("*.tmp"))
    assert leftovers == []


def test_same_arn_detail_and_index_are_one_transaction_across_stores(store, settings, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from app.store import Store

    first = make_resource(name="first")
    store.write_resource(first)
    store.write_inventory(store.inventory_from_resources())
    other = Store(settings)
    reached_index = Event()
    release_index = Event()
    second_started = Event()
    second_finished = Event()
    original = store._refresh_index_entry

    def delayed(resource):
        reached_index.set()
        assert release_index.wait(5)
        original(resource)

    monkeypatch.setattr(store, "_refresh_index_entry", delayed)

    def second():
        second_started.set()
        other.write_resource(make_resource(name="second"))
        second_finished.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(store.write_resource, first)
        assert reached_index.wait(5)
        b = pool.submit(second)
        assert second_started.wait(5)
        try:
            # The second Store must wait before replacing the detail file.
            assert not second_finished.wait(0.1)
            assert store.read_resource(ARN).name == "first"
        finally:
            release_index.set()
        a.result(timeout=5)
        b.result(timeout=5)
    assert store.read_resource(ARN).name == store.read_inventory().entries[0].name == "second"
