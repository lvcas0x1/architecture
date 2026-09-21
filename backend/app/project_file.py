from contextlib import contextmanager
from pathlib import Path

from app.models.project import Project
from app.store import _write_atomic


@contextmanager
def project_file(path: Path):
    """Serialize CLI writers and detect external edits before replacement."""
    import os

    with path.with_suffix(path.suffix + ".lock").open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            original = path.read_text(encoding="utf-8")
            project = Project.model_validate_json(original)

            def save(updated):
                if path.read_text(encoding="utf-8") != original:
                    raise ValueError("Project changed during regeneration; reload and retry")
                _write_atomic(path, updated.model_dump_json(indent=2) + "\n")

            yield project, save
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
