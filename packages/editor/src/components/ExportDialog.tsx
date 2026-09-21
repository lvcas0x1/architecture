import type { Diagram } from "@architecture/schema";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useState } from "react";
import {
  ApiUnavailableError,
  DEFAULT_EXPORT_OPTIONS,
  api,
  type ExportOptions,
  type ExportSummary,
} from "../lib/api.js";
import { fileNameFor } from "../lib/file.js";
import { useResourceStore } from "../store/resources.js";

const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const OPTION_LABELS: {
  key: keyof ExportOptions;
  label: string;
  hint: string;
}[] = [
  {
    key: "interactive",
    label: "Enable the parameter view",
    hint: "Clicking an icon opens its table",
  },
  {
    key: "includeSearch",
    label: "Include a search box",
    hint: "Search by ARN, name or tag",
  },
  {
    key: "includeRaw",
    label: "Include the raw Describe response",
    hint: "Off by default — it may contain sensitive values",
  },
  {
    key: "maskAccountIds",
    label: "Mask account IDs",
    hint: "For sharing outside the company",
  },
];

/** Export the diagram as a single HTML file. */
export function ExportDialog({
  open,
  onOpenChange,
  getDiagram,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getDiagram: () => Diagram;
  onNotice: (message: string) => void;
}) {
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    setSummary(null);
    api
      .exportSummary(getDiagram(), options, useResourceStore.getState().byArn)
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch(
        (err: unknown) =>
          active && setError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      active = false;
    };
  }, [open, options, getDiagram]);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const diagram = getDiagram();
      const blob = await api.exportHtml(
        diagram,
        options,
        useResourceStore.getState().byArn,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFor(diagram.meta.title).replace(
        /\.arch\.json$/,
        ".html",
      );
      link.click();
      URL.revokeObjectURL(url);

      onNotice("Exported the HTML file.");
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  }, [getDiagram, options, onNotice, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xl"
        >
          <header className="flex items-center border-b border-border-subtle px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">
              Export as HTML
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="ml-auto rounded px-1.5 py-1 text-ink-muted hover:bg-ink/6"
            >
              ✕
            </Dialog.Close>
          </header>

          <div className="px-4 py-3">
            <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
              The diagram and its resource data are embedded in a single HTML
              file. It references no external files, so it opens anywhere you
              share it.
            </p>

            <ul className="space-y-1.5">
              {OPTION_LABELS.map((item) => (
                <li key={item.key}>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={options[item.key]}
                      onChange={(e) =>
                        setOptions((prev) => ({
                          ...prev,
                          [item.key]: e.target.checked,
                        }))
                      }
                      className="mt-0.5 accent-accent"
                    />
                    <span>
                      {item.label}
                      <span className="ml-1.5 text-[10px] text-ink-muted">
                        {item.hint}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {options.maskAccountIds && (
              <p
                data-testid="mask-scope"
                className="mt-2 text-[10px] leading-relaxed text-ink-muted"
              >
                Masking covers the data embedded in the page, ARNs and reference
                keys included. The diagram title and the download file name are
                left as they are — rename the diagram if one of them carries an
                account ID.
              </p>
            )}

            <div className="mt-3 rounded border border-border-subtle bg-canvas/60 px-3 py-2 text-[11px] text-ink-muted">
              {summary ? (
                <>
                  <div>
                    {summary.resourceCount} resources · {summary.iconCount}{" "}
                    icons · about {formatBytes(summary.bytesEstimate)} of data
                  </div>
                  {summary.missingResources.length > 0 && (
                    <div className="mt-1 text-warn">
                      {summary.missingResources.length} resource(s) are not
                      fetched yet and will be left out (right-click, then
                      Refresh, to fetch them)
                    </div>
                  )}
                  {summary.missingIcons.length > 0 && (
                    <p className="mt-1 text-[11px] leading-snug text-warn">
                      {summary.missingIcons.length} icon file(s) are missing and
                      will not be embedded (run{" "}
                      <code className="font-mono">npm run icons</code>)
                    </p>
                  )}
                </>
              ) : (
                "Checking the contents…"
              )}
            </div>

            {/* Export errors stay visible even after the contents have been checked */}
            {error && (
              <p
                role="alert"
                className="mt-2 rounded border border-danger/30 bg-danger/8 px-3 py-2 text-[11px] text-danger"
              >
                {error}
              </p>
            )}
          </div>

          <footer className="flex justify-end gap-2 border-t border-border-subtle px-4 py-2.5">
            <Dialog.Close className="rounded border border-border-subtle px-3 py-1.5 text-xs text-ink-muted hover:bg-ink/5">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={handleExport}
              disabled={busy || summary === null}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Exporting…" : "Export"}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
