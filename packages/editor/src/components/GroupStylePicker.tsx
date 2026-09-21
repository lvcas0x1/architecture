import { groupStyleLabel, type GroupNodeData } from "@architecture/schema";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { GROUP_STYLE_ORDER, GROUP_STYLES } from "../lib/defaults.js";

/** Group styles ordered by nesting depth. */
export function GroupStylePicker({
  value,
  onChange,
}: {
  value: GroupNodeData["style"];
  onChange: (style: GroupNodeData["style"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointer, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointer, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative ml-1">
      <button
        type="button"
        aria-label="Box type"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-accent bg-white px-2 py-1 text-[11px] text-ink"
      >
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-ink/15"
          style={{ background: GROUP_STYLES[value].stroke }}
        />
        {groupStyleLabel(value)}
        <span aria-hidden className="text-ink-muted">
          ▾
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Box type"
          // Always open downwards
          className="absolute top-full left-0 z-30 mt-1 max-h-96 min-w-52 overflow-y-auto rounded-md border border-border-subtle bg-panel pt-1 pb-2 shadow-lg"
        >
          {GROUP_STYLE_ORDER.map((style) => (
            <li key={style}>
              <button
                type="button"
                role="option"
                aria-selected={style === value}
                onClick={() => {
                  onChange(style);
                  setOpen(false);
                }}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                  style === value ? "bg-accent/8 text-ink" : "text-ink hover:bg-accent/10",
                )}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-ink/15"
                  style={{ background: GROUP_STYLES[style].stroke }}
                />
                {groupStyleLabel(style)}
                {style === value && (
                  <span aria-hidden className="ml-auto text-[10px] text-ink-muted">
                    ✓
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
