/** Loading state for the icon catalog. Fetched once at start-up. */
import type { IconEntry, ResourceScope } from "@architecture/schema";
import { create } from "zustand";
import { api } from "../lib/api.js";
import { loadIconCatalog } from "../lib/icons.js";

interface CatalogState {
  icons: IconEntry[];
  byKey: Map<string, IconEntry>;
  /** Icon attributes. No shipped defaults: only what the user assigned is here. */
  scopeOverrides: Map<string, ResourceScope>;
  /** Why saving an attribute to the server failed (valid for this session only). */
  scopeSaveError: string | null;
  scopesLoaded: boolean;
  scopeEdits: Map<string, ResourceScope>;
  /** Whether the official icons are missing and the development placeholders are in use. */
  isPlaceholder: boolean;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  load: () => Promise<void>;
  /** Find the served path for an icon key. Returns null for unknown keys so the diagram survives. */
  pathFor: (key: string | null | undefined) => string | null;
  labelFor: (key: string | null | undefined) => string | null;
  /** The layer an icon belongs to. "any" when unset (it goes anywhere). */
  scopeFor: (key: string | null | undefined) => ResourceScope;
  /** Change an attribute. "any" means none (the setting is removed). Immediate on screen, saved in the background. */
  setScope: (key: string, scope: ResourceScope) => Promise<void>;
}

/** Serialize scope saves to preserve edit order. */
let savingScopes: Promise<unknown> = Promise.resolve();

export const useCatalogStore = create<CatalogState>((set, get) => ({
  icons: [],
  byKey: new Map(),
  scopeOverrides: new Map(),
  scopeSaveError: null,
  scopesLoaded: false,
  scopeEdits: new Map(),
  isPlaceholder: false,
  status: "idle",
  error: null,

  load: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      const { catalog, isPlaceholder } = await loadIconCatalog();
      set({
        icons: catalog.icons,
        byKey: new Map(catalog.icons.map((i) => [i.key, i])),
        isPlaceholder,
        status: "ready",
      });
    } catch (err) {
      set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Attributes live only on the server. Without them everything is "no attribute",
    // so a failure here does not stop the editor.
    try {
      const saved = await api.iconScopes();
      if (!get().scopesLoaded) {
        const merged = new Map(Object.entries(saved.scopes ?? {}));
        for (const [key, scope] of get().scopeEdits) {
          if (scope === "any") merged.delete(key);
          else merged.set(key, scope);
        }
        set({ scopeOverrides: merged, scopesLoaded: true });
      }
    } catch {
      // Backend is down. Carry on with no attributes.
    }
  },

  pathFor: (key) => (key ? (get().byKey.get(key)?.path ?? null) : null),
  labelFor: (key) => (key ? (get().byKey.get(key)?.label ?? null) : null),

  scopeFor: (key) => (key ? (get().scopeOverrides.get(key) ?? "any") : "any"),

  setScope: async (key, scope) => {
    const next = new Map(get().scopeOverrides);
    // "No attribute" is the same as removing the setting. Keeping it would mix
    // attribute-less entries into the list of icons that were given one.
    if (scope === "any") next.delete(key);
    else next.set(key, scope);

    // Reflect it on screen first. Placement follows the new attribute from now on.
    const edits = new Map(get().scopeEdits).set(key, scope);
    set({ scopeOverrides: next, scopeEdits: edits, scopeSaveError: null });

    const send = savingScopes.then(async () => {
      if (!get().scopesLoaded) {
        // Retry failed initial reads before ever replacing the server's full set.
        const saved = await api.iconScopes();
        if (!get().scopesLoaded) {
          const merged = new Map(Object.entries(saved.scopes ?? {}));
          for (const [changedKey, changedScope] of get().scopeEdits) {
            if (changedScope === "any") merged.delete(changedKey);
            else merged.set(changedKey, changedScope);
          }
          set({ scopeOverrides: merged, scopesLoaded: true });
        }
      }
      await api.saveIconScopes(Object.fromEntries(get().scopeOverrides));
    });
    // A failure does not stall the queue (the next change can still be sent)
    savingScopes = send.catch(() => undefined);

    try {
      await send;
      if (get().scopeEdits === edits)
        set({ scopeEdits: new Map(), scopeSaveError: null });
    } catch (err) {
      if (get().scopeEdits !== edits) return;
      set({
        scopeSaveError:
          err instanceof Error
            ? `Could not save the attribute (${err.message}). It applies to this session only.`
            : "Could not save the attribute. It applies to this session only.",
      });
    }
  },
}));
