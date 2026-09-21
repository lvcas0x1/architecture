/** Backend client with a distinct offline error. */
import type {
  Diagram,
  IconScopes,
  Inventory,
  InventoryEntry,
  NormalizedResource,
} from "@architecture/schema";

export class ApiUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Cannot reach the backend. Start it with `npm run api`.");
    this.name = "ApiUnavailableError";
    this.cause = cause;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    throw new ApiUnavailableError(err);
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Ignore an error body that is not JSON
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export interface ExportOptions {
  includeRaw: boolean;
  interactive: boolean;
  includeSearch: boolean;
  maskAccountIds: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeRaw: false,
  interactive: true,
  includeSearch: true,
  maskAccountIds: false,
};

export interface ExportSummary {
  resourceCount: number;
  iconCount: number;
  missingResources: string[];
  missingIcons: string[];
  bytesEstimate: number;
}

export const api = {
  /** The inventory index (the search source for "Configure"). */
  inventory: (): Promise<Inventory> => request<Inventory>("/api/inventory"),

  /** The icon attributes (placement layers) the user changed. */
  iconScopes: (): Promise<IconScopes> => request<IconScopes>("/api/icon-scopes"),

  /** Save the whole set of changes. */
  saveIconScopes: (scopes: IconScopes["scopes"]): Promise<IconScopes> =>
    request<IconScopes>("/api/icon-scopes", {
      method: "PUT",
      body: JSON.stringify({ schemaVersion: "1.0", scopes }),
    }),

  /** One normalized resource. */
  resource: (arn: string): Promise<NormalizedResource> =>
    request<NormalizedResource>(`/api/resources/${encodeURIComponent(arn)}`),

  /** "Refresh": re-run the Boto3 Describe and fetch the latest JSON. */
  refresh: (arn: string): Promise<NormalizedResource> =>
    request<NormalizedResource>(`/api/resources/${encodeURIComponent(arn)}/refresh`, {
      method: "POST",
    }),

  /** Refresh every ARN the diagram references. */
  refreshMany: (arns: string[]): Promise<{ resources: NormalizedResource[] }> =>
    request<{ resources: NormalizedResource[] }>("/api/resources/refresh-bulk", {
      method: "POST",
      body: JSON.stringify({ arns }),
    }),

  /** Include locally loaded details when requesting the export summary. */
  exportSummary: (
    diagram: Diagram,
    options: ExportOptions,
    resources: Record<string, NormalizedResource> = {},
  ): Promise<ExportSummary> =>
    request<ExportSummary>("/api/export/summary", {
      method: "POST",
      body: JSON.stringify({ diagram, options, resources }),
    }),

  /** Receive the diagram as a single HTML file. */
  exportHtml: async (
    diagram: Diagram,
    options: ExportOptions,
    resources: Record<string, NormalizedResource> = {},
  ): Promise<Blob> => {
    let response: Response;
    try {
      response = await fetch("/api/export/html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diagram, options, resources }),
      });
    } catch (err) {
      throw new ApiUnavailableError(err);
    }
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        // Ignore an error body that is not JSON
      }
      throw new ApiError(detail, response.status);
    }
    return response.blob();
  },
};

/** Search the inventory across ARN, name, id, tags and service. */
export function filterInventory(
  entries: InventoryEntry[],
  query: string,
  filters: { accountId?: string; region?: string; resourceType?: string } = {},
): InventoryEntry[] {
  const q = query.trim().toLowerCase();

  return entries.filter((entry) => {
    if (filters.accountId && entry.accountId !== filters.accountId) return false;
    if (filters.region && entry.region !== filters.region) return false;
    if (filters.resourceType && entry.resourceType !== filters.resourceType) return false;
    if (!q) return true;

    const haystacks = [
      entry.name ?? "",
      entry.resourceId,
      entry.arn,
      entry.service,
      entry.resourceType,
      ...entry.tags.map((t) => `${t.key}:${t.value}`),
    ];
    return haystacks.some((h) => h.toLowerCase().includes(q));
  });
}
