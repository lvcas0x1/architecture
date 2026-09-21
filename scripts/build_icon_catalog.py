#!/usr/bin/env python3
"""Generate the catalog from the official AWS architecture icon package."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.models import IconCatalog, IconEntry, IconGroup  # noqa: E402

ICON_OUT_DIR = REPO_ROOT / "packages" / "editor" / "public" / "icons"
#: The one catalog. The editor fetches it over HTTP and the backend reads the same
#: file, so the screen and the server can never be judging different icons.
CATALOG_OUT = REPO_ROOT / "packages" / "editor" / "public" / "icons.json"
OVERRIDES = REPO_ROOT / "config" / "icon-overrides.json"

#: Preferred icon sizes, in order. 48px suits both the palette and the canvas.
SIZE_PRIORITY = ("64", "48", "32", "16")

#: Top-level folder in the package -> logical group.
GROUP_BY_DIR = (
    ("architecture-service-icons", IconGroup.ARCHITECTURE),
    ("architecture-group-icons", IconGroup.GROUP),
    ("category-icons", IconGroup.CATEGORY),
    ("resource-icons", IconGroup.RESOURCE),
)

#: Fallback display name for groups that have no category folder.
GROUP_DISPLAY = {
    IconGroup.ARCHITECTURE: "Architecture",
    IconGroup.GROUP: "Group",
    IconGroup.CATEGORY: "Category",
    IconGroup.RESOURCE: "Resource",
}

#: Prefixes and suffixes stripped from file names.
PREFIX_RE = re.compile(r"^(Arch-Category|Arch|Res)[_-]", re.IGNORECASE)
SUFFIX_RE = re.compile(r"[_-](16|32|48|64)(_(Light|Dark))?$", re.IGNORECASE)
SIZE_IN_NAME_RE = re.compile(r"[_-](16|32|48|64)[_-]", re.IGNORECASE)


def classify_group(path: Path, root: Path) -> tuple[IconGroup, int] | None:
    """Return the group and the depth of that group's root inside the package."""
    parts = [p.lower() for p in path.relative_to(root).parts]
    for index, part in enumerate(parts):
        for marker, group in GROUP_BY_DIR:
            if part.startswith(marker):
                return group, index
    return None


def detect_size(path: Path) -> str | None:
    """Pick the size out of the folder or file name."""
    for part in reversed(path.parts):
        m = re.search(r"(?:^|[_-])(16|32|48|64)(?:[_-]|$)", part)
        if m:
            return m.group(1)
    return None


def detect_theme(path: Path) -> str:
    joined = "/".join(path.parts).lower()
    if "_dark" in joined or "-dark" in joined:
        return "dark"
    return "light"


def clean_folder_name(part: str) -> str:
    """Strip release, family, size, and theme markers from folder names."""
    cleaned = re.sub(r"[_-]\d{6,8}$", "", part)  # release number (02062026)
    cleaned = PREFIX_RE.sub("", cleaned)  # Arch_ / Res_ / Arch-Category_
    cleaned = re.sub(
        r"(?:^|[_-])(?:16|32|48|64)(?:[_-](?:Light|Dark))?(?=$|[_-])",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = cleaned.replace("-", " ").replace("_", " ").strip()
    if not cleaned or cleaned.isdigit() or cleaned.lower() in {"light", "dark"}:
        return ""
    return cleaned


def detect_category(path: Path, root: Path, group: IconGroup, group_depth: int) -> str:
    """Find the nearest category folder within the icon family root."""
    parts = path.relative_to(root).parts[group_depth + 1 : -1]
    for part in reversed(parts):
        if cleaned := clean_folder_name(part):
            return cleaned
    return GROUP_DISPLAY[group]


def slugify(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def humanize(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").strip()


def build_alias(label: str) -> list[str]:
    """Search aliases. "Amazon EC2" -> ["amazon ec2", "ec2"]"""
    lower = label.lower()
    aliases = {lower}
    stripped = re.sub(r"^(amazon|aws)\s+", "", lower).strip()
    if stripped:
        aliases.add(stripped)
    compact = re.sub(r"[^a-z0-9]", "", stripped)
    if compact:
        aliases.add(compact)
    aliases.discard("")
    return sorted(aliases)


def collect(
    root: Path,
) -> tuple[list[IconEntry], Counter[str], dict[str, Path]]:
    stats: Counter[str] = Counter()
    # key -> (priority, source path, entry)
    best: dict[str, tuple[int, Path, IconEntry]] = {}

    for svg in sorted(root.rglob("*.svg")):
        if svg.name.startswith("."):
            continue
        classified = classify_group(svg, root)
        if classified is None:
            stats["unclassified (skipped)"] += 1
            continue
        group, group_depth = classified
        if detect_theme(svg) == "dark":
            stats["dark theme (skipped)"] += 1
            continue

        size = detect_size(svg)
        rank = SIZE_PRIORITY.index(size) if size in SIZE_PRIORITY else len(SIZE_PRIORITY)

        raw = SUFFIX_RE.sub("", svg.stem)
        raw = SIZE_IN_NAME_RE.sub("_", raw)
        raw = PREFIX_RE.sub("", raw)
        name_slug = slugify(raw)
        if not name_slug:
            stats["unresolvable name (skipped)"] += 1
            continue

        category = detect_category(svg, root, group, group_depth)
        key = f"{group.value}/{slugify(category)}/{name_slug}"

        entry = IconEntry(
            key=key,
            group=group,
            category=humanize(category),
            label=humanize(name_slug),
            path=f"/icons/{key}.svg",
            aliases=build_alias(humanize(name_slug)),
        )
        current = best.get(key)
        if current is None or rank < current[0]:
            best[key] = (rank, svg, entry)
            stats[f"{group.value}"] += 1 if current is None else 0

    entries = [v[2] for v in best.values()]
    entries.sort(key=lambda e: (e.group.value, e.category, e.label))
    return entries, stats, {k: v[1] for k, v in best.items()}


def apply_overrides(entries: list[IconEntry]) -> int:
    """Apply aliases and resourceTypes from config/icon-overrides.json."""
    if not OVERRIDES.exists():
        return 0
    data = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    applied = 0
    by_key = {e.key: e for e in entries}
    for key, patch in data.items():
        # Keys starting with "_" are notes, so skip them
        if key.startswith("_"):
            continue
        entry = by_key.get(key)
        if entry is None:
            print(f"  warning: no icon matches the override key: {key}", file=sys.stderr)
            continue
        if "label" in patch:
            entry.label = patch["label"]
        if "category" in patch:
            entry.category = patch["category"]
        entry.aliases = sorted(set(entry.aliases) | set(patch.get("aliases", [])))
        entry.resource_types = sorted(
            set(entry.resource_types) | set(patch.get("resourceTypes", []))
        )
        applied += 1
    return applied


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("package_dir", type=Path, help="the unzipped AWS icon package folder")
    ap.add_argument("--no-copy", action="store_true", help="build the catalog without copying SVGs")
    args = ap.parse_args()

    root: Path = args.package_dir.expanduser().resolve()
    if not root.is_dir():
        print(f"error: folder not found: {root}", file=sys.stderr)
        return 1

    entries, stats, sources = collect(root)
    if not entries:
        print(
            "error: no icons were recognised. The package layout may differ "
            "from what this script expects.",
            file=sys.stderr,
        )
        return 1

    applied = apply_overrides(entries)

    if not args.no_copy:
        if ICON_OUT_DIR.exists():
            shutil.rmtree(ICON_OUT_DIR)
        for entry in entries:
            dest = ICON_OUT_DIR / f"{entry.key}.svg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(sources[entry.key], dest)

    release = None
    if m := re.search(r"(\d{2}[-_]\d{2}[-_]\d{4}|\d{8})", root.name):
        release = m.group(1)

    catalog = IconCatalog(generated_at=datetime.now(UTC), package_release=release, icons=entries)
    serialized = catalog.model_dump_json(indent=2, by_alias=True) + "\n"
    CATALOG_OUT.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_OUT.write_text(serialized, encoding="utf-8")

    print(f"{len(entries)} icons / {len(catalog.categories())} categories")
    for name, count in stats.most_common():
        print(f"  {name}: {count}")
    if applied:
        print(f"  overrides applied: {applied}")
    print(f"wrote: {CATALOG_OUT.relative_to(REPO_ROOT)}")
    if not args.no_copy:
        print(f"wrote: {ICON_OUT_DIR.relative_to(REPO_ROOT)}/")
    print("\nNote: use the AWS icons unmodified, per the AWS trademark guidelines.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
