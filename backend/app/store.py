"""File I/O in the workspace."""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from app.aws.arn import arn_to_filename
from app.config import Settings
from app.models import Diagram, IconScopes, Inventory, InventoryEntry, NormalizedResource

logger = logging.getLogger(__name__)

_DIAGRAM_SUFFIX = ".arch.json"
# Allow Latin and CJK names; reject leading dots and path separators.
_SAFE_NAME = re.compile(r"^(?!\.)[A-Za-z0-9\u3041-\u3093\u30a1-\u30f6\u4e00-\u9fa0_\-. ]{1,120}$")


class DiagramNotFoundError(FileNotFoundError):
    pass


class InvalidDiagramIdError(ValueError):
    pass


def _write_atomic(path: Path, text: str) -> None:
    """Never corrupt an existing file, even if the process dies mid-write."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # delete=False because the file must survive until the rename; a with block cannot wrap it.
    handle = tempfile.NamedTemporaryFile(  # noqa: SIM115
        "w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    )
    try:
        with handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(handle.name, path)
    except BaseException:
        Path(handle.name).unlink(missing_ok=True)
        raise


def _dump(model: Diagram | NormalizedResource | Inventory | IconScopes) -> str:
    return model.model_dump_json(indent=2, by_alias=True) + "\n"


class Store:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # Serialize read-modify-write operations within this Store.
        self._index_lock = threading.RLock()

    @contextmanager
    def _inventory_transaction(self) -> Iterator[None]:
        """Serialize API threads, independent Store instances and collector processes."""
        with self._index_lock:
            path = self.settings.inventory_index.with_suffix(".lock")
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a+b") as handle:
                if os.name == "nt":
                    import msvcrt

                    if path.stat().st_size == 0:
                        handle.write(b"0")
                        handle.flush()
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    if os.name == "nt":
                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    # -- Normalized resources -------------------------------------------

    def resource_path(self, arn: str) -> Path:
        return self.settings.resources_dir / arn_to_filename(arn)

    def read_resource(self, arn: str) -> NormalizedResource | None:
        path = self.resource_path(arn)
        if not path.exists():
            return None
        try:
            resource = NormalizedResource.model_validate_json(path.read_text(encoding="utf-8"))
        except ValueError:
            logger.exception("Resource JSON is corrupted: %s", path)
            return None
        # The file name comes from the ARN, but check the contents agree as well
        if resource.arn != arn:
            logger.warning("Skipped because the ARN does not match: %s", path)
            return None
        return resource

    def write_resource(self, resource: NormalizedResource) -> Path:
        path = self.resource_path(resource.arn)
        with self._inventory_transaction():
            _write_atomic(path, _dump(resource))
            self._refresh_index_entry(resource)
        return path

    def _refresh_index_entry(self, resource: NormalizedResource) -> None:
        """Update matching inventory entries while holding the inventory transaction lock."""
        path = self.settings.inventory_index
        if not path.exists():
            return

        inventory = self.read_inventory()
        updated = False
        entries = []
        for entry in inventory.entries:
            if entry.arn != resource.arn:
                entries.append(entry)
                continue
            entries.append(
                entry.model_copy(
                    update={
                        "account_id": resource.account_id,
                        "account_alias": resource.account_alias,
                        "region": resource.region,
                        "name": resource.name,
                        "tags": resource.tags,
                        "lifecycle": resource.lifecycle,
                        "fetched_at": resource.fetched_at,
                        "has_detail": True,
                    }
                )
            )
            updated = True

        if updated:
            _write_atomic(path, _dump(inventory.model_copy(update={"entries": entries})))

    def all_resources(self) -> list[NormalizedResource]:
        resources: list[NormalizedResource] = []
        for path in sorted(self.settings.resources_dir.glob("*.json")):
            try:
                resources.append(
                    NormalizedResource.model_validate_json(path.read_text(encoding="utf-8"))
                )
            except ValueError:
                logger.warning("Skipped (malformed): %s", path)
        return resources

    # -- Inventory -------------------------------------------------------

    def read_inventory(self) -> Inventory:
        path = self.settings.inventory_index
        if path.exists():
            try:
                return Inventory.model_validate_json(path.read_text(encoding="utf-8"))
            except ValueError:
                logger.exception("Inventory is corrupted: %s", path)

        # Even without index.json, an index can be built from the fetched resources.
        return self.inventory_from_resources()

    def inventory_from_resources(self) -> Inventory:
        entries = [
            InventoryEntry(
                arn=resource.arn,
                account_id=resource.account_id,
                account_alias=resource.account_alias,
                region=resource.region,
                resource_type=resource.resource_type,
                resource_id=resource.resource_id,
                service=resource.service,
                name=resource.name,
                tags=resource.tags,
                icon_key=resource.icon_key,
                lifecycle=resource.lifecycle,
                fetched_at=resource.fetched_at,
                has_detail=True,
            )
            for resource in self.all_resources()
        ]
        return Inventory(generated_at=datetime.now(UTC), source="describe", entries=entries)

    def read_icon_scopes(self) -> IconScopes:
        """The user's icon attributes. Empty when there are none."""
        path = self.settings.icon_scopes
        if path.exists():
            try:
                return IconScopes.model_validate_json(path.read_text(encoding="utf-8"))
            except ValueError:
                logger.exception("Icon attribute settings are corrupted: %s", path)
        return IconScopes()

    def write_icon_scopes(self, scopes: IconScopes) -> Path:
        path = self.settings.icon_scopes
        scopes = scopes.model_copy(update={"updated_at": datetime.now(UTC)})
        _write_atomic(path, _dump(scopes))
        return path

    def write_inventory(self, inventory: Inventory) -> Path:
        path = self.settings.inventory_index
        with self._inventory_transaction():
            # Collection may have started before a concurrent Refresh. Preserve
            # newer detail in the index instead of publishing an older snapshot.
            entries = []
            for entry in inventory.entries:
                detail = self.read_resource(entry.arn)
                if detail and (entry.fetched_at is None or detail.fetched_at >= entry.fetched_at):
                    entry = entry.model_copy(
                        update={
                            "name": detail.name,
                            "tags": detail.tags,
                            "lifecycle": detail.lifecycle,
                            "fetched_at": detail.fetched_at,
                            "has_detail": True,
                        }
                    )
                entries.append(entry)
            _write_atomic(path, _dump(inventory.model_copy(update={"entries": entries})))
        return path

    # -- Diagrams ---------------------------------------------------------

    @staticmethod
    def validate_diagram_id(diagram_id: str) -> str:
        """Reject path separators and relative references (no writing outside the workspace)."""
        if not _SAFE_NAME.match(diagram_id):
            raise InvalidDiagramIdError(
                f"Diagram id contains characters that are not allowed: {diagram_id!r}"
            )
        return diagram_id

    def diagram_path(self, diagram_id: str) -> Path:
        base = self.settings.diagrams_dir.resolve()
        path = (base / f"{self.validate_diagram_id(diagram_id)}{_DIAGRAM_SUFFIX}").resolve()
        # Even if some future path slips past the regex, this closes the door
        if not path.is_relative_to(base):
            raise InvalidDiagramIdError(f"Path points outside the workspace: {diagram_id!r}")
        return path

    def list_diagrams(self) -> list[dict[str, str]]:
        items: list[dict[str, str]] = []
        for path in sorted(self.settings.diagrams_dir.glob(f"*{_DIAGRAM_SUFFIX}")):
            diagram_id = path.name[: -len(_DIAGRAM_SUFFIX)]
            title = diagram_id
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    raise ValueError("Diagram must be an object")
                meta = raw.get("meta") or {}
                if not isinstance(meta, dict):
                    raise ValueError("Diagram meta must be an object")
                candidate = meta.get("title")
                title = candidate if isinstance(candidate, str) and candidate else diagram_id
            except (OSError, ValueError):
                logger.warning("Skipped: %s", path)
            items.append(
                {
                    "id": diagram_id,
                    "title": title,
                    "updatedAt": datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat(),
                }
            )
        return items

    def read_diagram(self, diagram_id: str) -> Diagram:
        path = self.diagram_path(diagram_id)
        if not path.exists():
            raise DiagramNotFoundError(f"Diagram not found: {diagram_id}")
        return Diagram.model_validate_json(path.read_text(encoding="utf-8"))

    def write_diagram(self, diagram_id: str, diagram: Diagram) -> Path:
        path = self.diagram_path(diagram_id)
        _write_atomic(path, _dump(diagram))
        return path

    def delete_diagram(self, diagram_id: str) -> None:
        path = self.diagram_path(diagram_id)
        if not path.exists():
            raise DiagramNotFoundError(f"Diagram not found: {diagram_id}")
        path.unlink()
