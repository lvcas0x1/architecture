import type { InventoryEntry, NormalizedResource } from "@architecture/schema";
import { parseResourceInput } from "@architecture/schema";
import * as Dialog from "@radix-ui/react-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, filterInventory } from "../lib/api.js";
import { iconForResourceType } from "../lib/icons.js";
import { useCatalogStore } from "../store/catalog.js";
import { useResourceStore } from "../store/resources.js";

export interface BindResult {
  arn: string;
  /** The icon found from the resource type. Offered as a swap when it differs from the one placed. */
  suggestedIconKey: string | null;
}

type Mode = "inventory" | "file";

/** Validate and fill defaults using the generated Pydantic input schema. */
export function parseResourceFile(text: string): NormalizedResource {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseResourceInput(raw);
}

function InventoryRow({
  entry,
  selected,
  onSelect,
}: {
  entry: InventoryEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "flex w-full flex-col items-start gap-0.5 border-b border-border-subtle/60 px-3 py-1.5 text-left",
        selected ? "bg-accent/10" : "hover:bg-accent/5",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className="truncate text-xs font-medium text-ink">
          {entry.name ?? entry.resourceId}
        </span>
        <span className="shrink-0 rounded bg-ink/8 px-1 text-[9px] text-ink-muted">
          {entry.service}
        </span>
        {entry.lifecycle === "deleted" && (
          <span className="shrink-0 rounded bg-danger/15 px-1 text-[9px] font-semibold text-danger">
            Deleted
          </span>
        )}
        <span className="ml-auto shrink-0 text-[9px] text-ink-muted">
          {entry.accountAlias ?? entry.accountId} / {entry.region}
        </span>
      </span>
      <span className="truncate font-mono text-[10px] text-ink-muted">
        {entry.arn}
      </span>
    </button>
  );
}

/** Link an inventory resource or load local resource JSON. */
export function ResourceBindDialog({
  open,
  onOpenChange,
  currentArn,
  onBind,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentArn: string | null;
  onBind: (result: BindResult) => void;
}) {
  const { inventory, inventoryStatus, inventoryError, loadInventory, put } =
    useResourceStore();
  const icons = useCatalogStore((s) => s.icons);

  const [mode, setMode] = useState<Mode>("inventory");
  const [query, setQuery] = useState("");
  const [accountId, setAccountId] = useState("");
  const [region, setRegion] = useState("");
  const [selected, setSelected] = useState<string | null>(currentArn);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSelected(currentArn);
      setFileError(null);
      void loadInventory();
    }
  }, [open, currentArn, loadInventory]);

  useEffect(() => {
    if (inventoryStatus === "unavailable") setMode("file");
  }, [inventoryStatus]);

  const accounts = useMemo(
    () => [...new Set(inventory.map((e) => e.accountId))].sort(),
    [inventory],
  );
  const regions = useMemo(
    () => [...new Set(inventory.map((e) => e.region))].sort(),
    [inventory],
  );

  const results = useMemo(
    () =>
      filterInventory(inventory, query, {
        accountId: accountId || undefined,
        region: region || undefined,
      }),
    [inventory, query, accountId, region],
  );

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 46,
    overscan: 12,
  });

  const suggestFor = (resourceType: string): string | null =>
    iconForResourceType(icons, resourceType)?.key ?? null;

  const confirmFromInventory = async () => {
    if (!selected) return;
    const entry =
      results.find((e) => e.arn === selected) ??
      inventory.find((e) => e.arn === selected);
    setBusy(true);
    try {
      // Fetch the detail JSON, then link it to the node
      const resource = await api.resource(selected);
      put(resource);
      onBind({
        arn: selected,
        suggestedIconKey: suggestFor(resource.resourceType),
      });
      onOpenChange(false);
    } catch (err) {
      // Link the ARN even when the detail cannot be fetched ("Refresh" gets it later)
      onBind({
        arn: selected,
        suggestedIconKey: entry ? suggestFor(entry.resourceType) : null,
      });
      onOpenChange(false);
      useResourceStore.setState({
        lastError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    setFileError(null);
    try {
      const resource = parseResourceFile(await file.text());
      put(resource);
      onBind({
        arn: resource.arn,
        suggestedIconKey: suggestFor(resource.resourceType),
      });
      onOpenChange(false);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(620px,86vh)] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xl"
        >
          <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">
              Configure resource
            </Dialog.Title>
            <div className="ml-auto flex gap-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "inventory"}
                onClick={() => setMode("inventory")}
                className={clsx(
                  "rounded px-2 py-1 text-[11px]",
                  mode === "inventory"
                    ? "bg-accent text-white"
                    : "text-ink-muted hover:bg-accent/10",
                )}
              >
                Search the inventory
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "file"}
                onClick={() => setMode("file")}
                className={clsx(
                  "rounded px-2 py-1 text-[11px]",
                  mode === "file"
                    ? "bg-accent text-white"
                    : "text-ink-muted hover:bg-accent/10",
                )}
              >
                Load from a file
              </button>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="rounded px-1.5 py-1 text-ink-muted hover:bg-ink/6"
            >
              ✕
            </Dialog.Close>
          </header>

          {mode === "inventory" ? (
            <>
              <div className="flex gap-2 border-b border-border-subtle px-4 py-2">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, resource ID, ARN or tag"
                  aria-label="Search resources"
                  className="min-w-0 flex-1 rounded border border-border-subtle px-2 py-1.5 text-xs outline-none focus:border-accent"
                />
                <select
                  aria-label="Account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="rounded border border-border-subtle px-1 text-[11px] text-ink-muted"
                >
                  <option value="">All accounts</option>
                  {accounts.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="rounded border border-border-subtle px-1 text-[11px] text-ink-muted"
                >
                  <option value="">All regions</option>
                  {regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {inventoryStatus === "loading" && (
                  <p className="p-4 text-center text-xs text-ink-muted">
                    Loading…
                  </p>
                )}
                {(inventoryStatus === "unavailable" ||
                  inventoryStatus === "error") && (
                  <p className="p-4 text-center text-xs text-ink-muted">
                    {inventoryError}
                    <br />
                    Use “Load from a file” instead.
                  </p>
                )}
                {inventoryStatus === "ready" && results.length === 0 && (
                  <p className="p-4 text-center text-xs text-ink-muted">
                    No matching resources.
                  </p>
                )}
                {inventoryStatus === "ready" && results.length > 0 && (
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((item) => {
                      const entry = results[item.index];
                      if (!entry) return null;
                      return (
                        <div
                          key={entry.arn}
                          data-index={item.index}
                          ref={virtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${item.start}px)`,
                          }}
                        >
                          <InventoryRow
                            entry={entry}
                            selected={selected === entry.arn}
                            onSelect={() => setSelected(entry.arn)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <footer className="flex items-center gap-2 border-t border-border-subtle px-4 py-2.5">
                <span className="text-[11px] text-ink-muted">
                  {inventoryStatus === "ready" && `${results.length} found`}
                </span>
                <div className="ml-auto flex gap-2">
                  <Dialog.Close className="rounded border border-border-subtle px-3 py-1.5 text-xs text-ink-muted hover:bg-ink/5">
                    Cancel
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={confirmFromInventory}
                    disabled={!selected || busy}
                    className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {busy ? "Fetching…" : "Apply"}
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
              <p className="max-w-md text-center text-xs leading-relaxed text-ink-muted">
                Pick a <b className="text-ink">single-resource JSON file</b>{" "}
                that has already been fetched and normalized through the Boto3
                Describe API.
              </p>
              <input
                type="file"
                accept=".json,application/json"
                aria-label="Resource JSON file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="text-xs"
              />
              {fileError && (
                <p
                  role="alert"
                  className="max-w-md text-center text-xs text-danger"
                >
                  {fileError}
                </p>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
