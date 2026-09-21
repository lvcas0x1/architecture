import type { Row, Section } from "@architecture/schema";
import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { useResourceStore } from "../store/resources.js";

const TONE_CLASS: Record<string, string> = {
  ok: "bg-emerald-500/12 text-emerald-700",
  warn: "bg-warn/15 text-warn",
  error: "bg-danger/15 text-danger",
  muted: "bg-ink/8 text-ink-muted",
};

function RowValue({
  row,
  onJump,
  canJump,
}: {
  row: Row;
  onJump?: (arn: string) => void;
  canJump?: (arn: string) => boolean;
}) {
  if (row.value === null || row.value === undefined || row.value === "") {
    return <span className="text-ink-muted/60">—</span>;
  }

  // A reference wins over the row's own kind, so a badge or a code value can be
  // clicked through as well. Only when the target is actually in the diagram.
  const jumpTo =
    row.ref && onJump && (canJump?.(row.ref) ?? true) ? row.ref : null;
  if (jumpTo) {
    return (
      <button
        type="button"
        onClick={() => onJump!(jumpTo)}
        title={jumpTo}
        className="text-left font-mono text-[11px] text-accent underline decoration-dotted underline-offset-2 hover:opacity-80"
      >
        {Array.isArray(row.value) ? row.value.join(", ") : String(row.value)}
      </button>
    );
  }

  if (row.kind === "list" || Array.isArray(row.value)) {
    const items = Array.isArray(row.value) ? row.value : [row.value];
    return (
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => (
          <li
            key={item}
            className="rounded bg-ink/6 px-1.5 py-0.5 font-mono text-[11px] text-ink"
          >
            {item}
          </li>
        ))}
      </ul>
    );
  }

  const text = String(row.value);

  if (row.kind === "badge") {
    return (
      <span
        className={clsx(
          "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium",
          TONE_CLASS[row.tone ?? "muted"],
        )}
      >
        {text}
      </span>
    );
  }

  if (row.kind === "link" && row.href) {
    return (
      <a
        href={row.href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent underline decoration-dotted underline-offset-2"
      >
        {text}
      </a>
    );
  }

  return (
    <span className={row.kind === "code" ? "font-mono text-[11px]" : undefined}>
      {text}
    </span>
  );
}

function SectionTable({
  section,
  onJump,
  canJump,
}: {
  section: Section;
  onJump?: (arn: string) => void;
  canJump?: (arn: string) => boolean;
}) {
  const [open, setOpen] = useState(!section.collapsed);

  return (
    <section className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 bg-canvas/60 px-3 py-1.5 text-left text-xs font-semibold text-ink"
      >
        <span className={clsx("transition-transform", open && "rotate-90")}>
          ▶
        </span>
        {section.title}
        <span className="ml-auto text-[10px] font-normal text-ink-muted">
          {section.rows.length}
        </span>
      </button>
      {open && (
        <table className="w-full table-fixed border-collapse">
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.label} className="border-t border-border-subtle/60">
                <th
                  scope="row"
                  className="w-[38%] px-3 py-1.5 text-left align-top text-[11px] font-medium text-ink-muted"
                >
                  {row.label}
                </th>
                <td className="px-3 py-1.5 align-top text-xs break-words text-ink">
                  <RowValue row={row} onJump={onJump} canJump={canJump} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Render resource sections in their stored order. */
export function ParameterDialog({
  arn,
  open,
  onOpenChange,
  onRefresh,
  onJump,
  canJump,
}: {
  arn: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh?: (arn: string) => void;
  onJump?: (arn: string) => void;
  /** Whether a referenced ARN is in the diagram. Rows for missing ones stay plain text. */
  canJump?: (arn: string) => boolean;
}) {
  const resource = useResourceStore((s) => s.get(arn));
  const refreshing = useResourceStore((s) =>
    arn ? s.refreshing[arn] : undefined,
  );
  const [showRaw, setShowRaw] = useState(false);

  const fetchedAt = useMemo(() => {
    if (!resource) return null;
    const date = new Date(resource.fetchedAt);
    return Number.isNaN(date.getTime())
      ? resource.fetchedAt
      : date.toLocaleString();
  }, [resource]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(620px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xl"
        >
          <header className="flex items-start gap-3 border-b border-border-subtle px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-sm font-semibold">
                {resource
                  ? (resource.name ?? resource.resourceId)
                  : "Resource not fetched"}
              </Dialog.Title>
              <p
                className="mt-0.5 truncate font-mono text-[10px] text-ink-muted"
                title={arn ?? ""}
              >
                {arn}
              </p>
            </div>
            {arn && onRefresh && (
              <button
                type="button"
                onClick={() => onRefresh(arn)}
                disabled={refreshing === "loading"}
                className="shrink-0 rounded border border-border-subtle px-2 py-1 text-[11px] text-ink-muted hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {refreshing === "loading" ? "Refreshing…" : "Refresh"}
              </button>
            )}
            <Dialog.Close
              aria-label="Close"
              className="shrink-0 rounded px-1.5 py-1 text-ink-muted hover:bg-ink/6"
            >
              ✕
            </Dialog.Close>
          </header>

          {resource ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-2 text-[11px] text-ink-muted">
                <span>
                  <b className="font-semibold text-ink">{resource.service}</b> /{" "}
                  {resource.resourceType}
                </span>
                <span>{resource.accountAlias ?? resource.accountId}</span>
                <span>{resource.region}</span>
                {resource.lifecycle === "deleted" && (
                  <span className="rounded bg-danger/15 px-1.5 py-0.5 font-semibold text-danger">
                    Deleted
                  </span>
                )}
                {resource.lifecycle === "error" && (
                  <span className="rounded bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">
                    Fetch failed
                  </span>
                )}
                <span className="ml-auto">Fetched: {fetchedAt}</span>
              </div>

              {resource.lastError && (
                <p className="border-b border-border-subtle bg-warn/8 px-4 py-2 text-[11px] text-warn">
                  {resource.lastError}
                </p>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {resource.sections.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-ink-muted">
                    No parameters to show.
                  </p>
                ) : (
                  resource.sections.map((section) => (
                    <SectionTable
                      key={section.title}
                      section={section}
                      onJump={onJump}
                      canJump={canJump}
                    />
                  ))
                )}

                {resource.raw && (
                  <div className="border-t border-border-subtle">
                    <button
                      type="button"
                      onClick={() => setShowRaw((v) => !v)}
                      className="w-full bg-canvas/60 px-3 py-1.5 text-left text-xs font-semibold text-ink-muted"
                    >
                      {showRaw ? "▼" : "▶"} Raw Describe response
                    </button>
                    {showRaw && (
                      <pre className="max-h-64 overflow-auto bg-ink/3 px-3 py-2 font-mono text-[10px] leading-relaxed">
                        {JSON.stringify(resource.raw, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="px-4 py-8 text-center text-xs text-ink-muted">
              The JSON for this resource has not been loaded yet.
              <br />
              Right-click, then Refresh, to fetch it.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
