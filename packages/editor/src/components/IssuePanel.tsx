import clsx from "clsx";
import { useEffect, useState } from "react";
import type { Issue } from "../lib/validate.js";

/** The check-results panel. Every finding jumps to the elements in question. */
export function IssuePanel({
  issues,
  onFocus,
  onClose,
}: {
  issues: Issue[];
  onFocus: (nodeIds: string[]) => void;
  onClose: () => void;
}) {
  const errors = issues.filter((issue) => issue.level === "error").length;

  // Checks run only at set moments, so when there is something, show the detail.
  // It only collapses when the user presses the arrow.
  const [collapsed, setCollapsed] = useState(false);

  // Re-open when a new check changed the contents.
  // Collapsed, the next finding would be missed and exported anyway.
  useEffect(() => setCollapsed(false), [issues]);

  if (issues.length === 0) return null;

  return (
    <aside
      aria-label="Check results"
      className="absolute right-3 bottom-3 z-20 w-80 overflow-hidden rounded-lg border border-border-subtle bg-panel/97 shadow-lg backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-xs font-semibold">
          Check results
          <span className={clsx("ml-1.5 font-normal", errors > 0 ? "text-danger" : "text-warn")}>
            {errors > 0
              ? `${errors} error${errors > 1 ? "s" : ""}`
              : `${issues.length} to review`}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand" : "Collapse"}
          className="ml-auto rounded px-1.5 text-ink-muted hover:bg-ink/6"
        >
          {collapsed ? "▲" : "▼"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close check results"
          className="rounded px-1.5 text-ink-muted hover:bg-ink/6"
        >
          ✕
        </button>
      </header>

      {!collapsed && (
        <ul className="max-h-64 overflow-y-auto">
          {issues.map((issue) => (
            <li key={`${issue.level}-${issue.message}`}>
              <button
                type="button"
                onClick={() => onFocus(issue.nodeIds)}
                disabled={issue.nodeIds.length === 0}
                className="flex w-full items-start gap-2 border-b border-border-subtle/60 px-3 py-1.5 text-left last:border-b-0 hover:bg-accent/6 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className={clsx(
                    "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    issue.level === "error" ? "bg-danger" : "bg-warn",
                  )}
                />
                <span className="text-[11px] leading-snug text-ink">{issue.message}</span>
                {issue.nodeIds.length > 0 && (
                  <span className="ml-auto shrink-0 text-[10px] text-ink-muted">Focus</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
