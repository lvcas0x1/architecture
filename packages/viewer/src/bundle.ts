/** Read the embedded ExportBundle. */
import type { Diagram, IconEntry, NormalizedResource } from "@architecture/schema";

export interface ExportOptions {
  includeRaw: boolean;
  interactive: boolean;
  includeSearch: boolean;
  maskAccountIds: boolean;
}

export interface ExportBundle {
  schemaVersion: string;
  exportedAt: string;
  options: ExportOptions;
  diagram: Diagram;
  /** ARN -> normalized resource. Only what the diagram references. */
  resources: Record<string, NormalizedResource>;
  /** iconKey -> data URI. Only the icons the diagram uses. */
  icons: Record<string, string>;
}

export const DEFAULT_OPTIONS: ExportOptions = {
  includeRaw: false,
  interactive: true,
  includeSearch: true,
  maskAccountIds: false,
};

export class BundleError extends Error {}

/** Read JSON out of ``<script type="application/json" id="...">``. */
export function readEmbedded<T>(id: string, doc: Document = document): T | null {
  const element = doc.getElementById(id);
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as T;
  } catch (err) {
    throw new BundleError(
      `Could not read embedded data #${id}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export function loadBundle(doc: Document = document): ExportBundle {
  const bundle = readEmbedded<ExportBundle>("arch-bundle", doc);
  if (!bundle) {
    throw new BundleError("Embedded data #arch-bundle was not found.");
  }
  if (!bundle.diagram?.nodes) {
    throw new BundleError("The diagram data is corrupted.");
  }
  return {
    ...bundle,
    options: { ...DEFAULT_OPTIONS, ...(bundle.options ?? {}) },
    resources: bundle.resources ?? {},
    icons: bundle.icons ?? {},
  };
}


/** Adapt embedded icons to the shared catalog format. */
export function catalogFromBundle(icons: Record<string, string>): IconEntry[] {
  return Object.entries(icons).map(([key, path]) => {
    const parts = key.split("/");
    const name = parts.at(-1) ?? key;
    return {
      key,
      group: (parts[0] ?? "Architecture") as IconEntry["group"],
      category: parts.length > 1 ? (parts.at(-2) ?? "") : "",
      label: name.replace(/-/g, " "),
      path,
      aliases: [],
      resourceTypes: [],
    } satisfies IconEntry;
  });
}
