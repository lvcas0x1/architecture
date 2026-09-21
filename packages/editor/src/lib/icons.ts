import { parseIconCatalogInput } from "@architecture/schema";
import type { IconCatalog, IconEntry } from "@architecture/schema";

export interface LoadedCatalog {
  catalog: IconCatalog;
  /** Whether the official icons are missing and the development placeholders are in use. */
  isPlaceholder: boolean;
}

const SOURCES = [
  { url: "/icons.json", isPlaceholder: false },
  { url: "/icons-placeholder.json", isPlaceholder: true },
] as const;

/** Use a valid official catalog, falling back to placeholders. */
export async function loadIconCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedCatalog> {
  for (const source of SOURCES) {
    try {
      const res = await fetchImpl(source.url);
      if (!res.ok) continue;
      const catalog = parseIconCatalogInput(await res.json());
      if (catalog?.icons?.length) {
        return { catalog, isPlaceholder: source.isPlaceholder };
      }
    } catch {
      // Try the next source
    }
  }
  throw new Error(
    "Could not load the icon catalog. Run `npm run icons:placeholder`.",
  );
}

/** Group icons belong to the box tool, not the palette. */
const HIDDEN_GROUPS = new Set(["Group"]);

/** Keep only the icons the palette shows. */
export function paletteIcons(icons: IconEntry[]): IconEntry[] {
  return icons.filter((icon) => !HIDDEN_GROUPS.has(icon.group));
}

/** Group by category for the palette. Keeps the catalog's order. */
export function groupByCategory(icons: IconEntry[]): [string, IconEntry[]][] {
  const groups = new Map<string, IconEntry[]>();
  for (const icon of paletteIcons(icons)) {
    const bucket = groups.get(icon.category);
    if (bucket) bucket.push(icon);
    else groups.set(icon.category, [icon]);
  }
  return [...groups.entries()];
}

/** Search labels, keys, and aliases; rank prefix matches first. */
export function searchIcons(icons: IconEntry[], query: string): IconEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return paletteIcons(icons);

  const scored: { icon: IconEntry; score: number }[] = [];
  for (const icon of paletteIcons(icons)) {
    const haystacks = [
      icon.label.toLowerCase(),
      icon.key.toLowerCase(),
      ...icon.aliases,
    ];
    let best = Infinity;
    for (const hay of haystacks) {
      if (hay.startsWith(q)) best = Math.min(best, 0);
      else if (hay.includes(q)) best = Math.min(best, 1);
    }
    if (best < Infinity) scored.push({ icon, score: best });
  }
  return scored
    .sort(
      (a, b) => a.score - b.score || a.icon.label.localeCompare(b.icon.label),
    )
    .map((s) => s.icon);
}

/** Find an icon from a resourceType (used when picking a resource in "Configure"). */
export function iconForResourceType(
  icons: IconEntry[],
  resourceType: string,
): IconEntry | undefined {
  return icons.find((i) => i.resourceTypes.includes(resourceType));
}
