/** Resource cache shared by ARN. */
import type { InventoryEntry, NormalizedResource } from "@architecture/schema";
import { create } from "zustand";
import { ApiUnavailableError, api } from "../lib/api.js";

export type RefreshState = "idle" | "loading" | "error";

interface ResourceStoreState {
  byArn: Record<string, NormalizedResource>;
  inventory: InventoryEntry[];
  inventoryStatus: "idle" | "loading" | "ready" | "unavailable" | "error";
  inventoryError: string | null;
  /** Refresh state per ARN. Used to show a spinner on the node. */
  refreshing: Record<string, RefreshState>;
  lastError: string | null;

  get: (arn: string | null | undefined) => NormalizedResource | undefined;
  put: (resource: NormalizedResource) => void;
  putMany: (resources: NormalizedResource[]) => void;
  loadInventory: () => Promise<void>;
  /** Fetch the data for every referenced ARN, such as right after loading a diagram. */
  fetchMissing: (arns: string[]) => Promise<void>;
  /** "Refresh": re-run Describe. */
  refresh: (arn: string) => Promise<NormalizedResource | null>;
  clearError: () => void;
  reset: () => void;
}

let generation = 0;
const revisions = new Map<string, number>();
const advance = (arn: string): number => {
  const revision = (revisions.get(arn) ?? 0) + 1;
  revisions.set(arn, revision);
  return revision;
};

export const useResourceStore = create<ResourceStoreState>((set, get) => ({
  byArn: {},
  inventory: [],
  inventoryStatus: "idle",
  inventoryError: null,
  refreshing: {},
  lastError: null,

  get: (arn) => (arn ? get().byArn[arn] : undefined),

  put: (resource) => {
    advance(resource.arn);
    set({ byArn: { ...get().byArn, [resource.arn]: resource } });
  },

  putMany: (resources) => {
    if (resources.length === 0) return;
    const byArn = { ...get().byArn };
    for (const resource of resources) {
      advance(resource.arn);
      byArn[resource.arn] = resource;
    }
    set({ byArn });
  },

  loadInventory: async () => {
    if (get().inventoryStatus === "loading") return;
    const started = generation;
    set({ inventoryStatus: "loading", inventoryError: null });
    try {
      const inventory = await api.inventory();
      if (generation !== started) return;
      set({ inventory: inventory.entries, inventoryStatus: "ready" });
    } catch (err) {
      if (generation !== started) return;
      if (err instanceof ApiUnavailableError) {
        // Loading from a file works with the backend down, so this is
        // "unavailable" rather than an error.
        set({ inventoryStatus: "unavailable", inventoryError: err.message });
      } else {
        set({
          inventoryStatus: "error",
          inventoryError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },

  fetchMissing: async (arns) => {
    const { byArn } = get();
    const missing = [...new Set(arns)].filter((arn) => !byArn[arn]);
    if (missing.length === 0) return;

    const started = generation;
    const versions = new Map(
      missing.map((arn) => [arn, revisions.get(arn) ?? 0]),
    );
    const results = await Promise.allSettled(
      missing.map((arn) => api.resource(arn)),
    );
    if (generation !== started) return;
    const fetched = results
      .filter(
        (r): r is PromiseFulfilledResult<NormalizedResource> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value)
      .filter(
        (resource) =>
          (revisions.get(resource.arn) ?? 0) === versions.get(resource.arn),
      );
    get().putMany(fetched);
  },

  refresh: async (arn) => {
    const started = generation;
    const revision = advance(arn);
    const current = () =>
      generation === started && revisions.get(arn) === revision;
    set({
      refreshing: { ...get().refreshing, [arn]: "loading" },
      lastError: null,
    });
    try {
      const resource = await api.refresh(arn);
      if (!current()) return null;
      get().put(resource);
      set({ refreshing: { ...get().refreshing, [arn]: "idle" } });
      return resource;
    } catch (err) {
      if (!current()) return null;
      set({
        refreshing: { ...get().refreshing, [arn]: "error" },
        lastError: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  clearError: () => set({ lastError: null }),

  reset: () => {
    generation++;
    revisions.clear();
    set({
      byArn: {},
      inventory: [],
      inventoryStatus: "idle",
      inventoryError: null,
      refreshing: {},
      lastError: null,
    });
  },
}));
