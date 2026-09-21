#!/usr/bin/env python3
"""Check a diagram file, an AI-generated one in particular."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.config import get_settings  # noqa: E402
from app.models import Diagram  # noqa: E402
from app.store import Store  # noqa: E402
from app.validation import load_known_icon_keys, validate_diagram  # noqa: E402


def check(path: Path, store: Store, strict: bool) -> tuple[int, int]:
    """Returns (error count, warning count)."""
    print(f"\n== {path.name} ==")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"  [error] not readable as JSON: {exc}")
        return 1, 0
    except OSError as exc:
        print(f"  [error] cannot read: {exc}")
        return 1, 0

    try:
        diagram = Diagram.model_validate(raw)
    except ValidationError as exc:
        print(f"  [error] schema violations: {exc.error_count()}")
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"]) or "(root)"
            print(f"    {loc}: {err['msg']}")
        return exc.error_count(), 0

    inventory = store.read_inventory()
    known_arns = {entry.arn for entry in inventory.entries} or None
    known_icons = load_known_icon_keys()

    if known_arns is None:
        print("  [info] inventory is empty — skipped the ARN existence check")
    if known_icons is None:
        print("  [info] no icon catalog — skipped the iconKey check")

    # Passing the store also applies the icon attributes the user set
    report = validate_diagram(
        diagram,
        store,
        known_arns=known_arns,
        known_icon_keys=known_icons,
        check_arns=known_arns is not None,
    )
    errors: list[str] = report["errors"]  # type: ignore[assignment]
    warnings: list[str] = report["warnings"]  # type: ignore[assignment]

    for message in errors:
        print(f"  [error] {message}")
    for message in warnings:
        print(f"  [warning] {message}")

    if diagram.layout.mode == "auto":
        print("  [info] layout.mode=auto — coordinates are decided by ELK on load")

    ai_nodes = sum(1 for node in diagram.nodes if node.data.origin == "ai")
    print(
        f"  nodes {len(diagram.nodes)} (AI-generated {ai_nodes}) / "
        f"edges {len(diagram.edges)} / referenced ARNs {len(diagram.referenced_arns())}"
    )
    if not errors and (not warnings or not strict):
        print("  OK")
    return len(errors), len(warnings) if strict else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    args = parser.parse_args()

    store = Store(get_settings())
    total_errors = total_warnings = 0
    for path in args.paths:
        errors, warnings = check(path, store, args.strict)
        total_errors += errors
        total_warnings += warnings

    print(f"\nTotal: {total_errors} error(s) / {total_warnings} warning(s)")
    return 1 if total_errors or total_warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
