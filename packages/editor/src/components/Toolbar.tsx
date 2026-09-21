import type {
  ArrowStyle,
  EdgeData,
  LayoutOptions,
  LineStyle,
} from "@architecture/schema";
import clsx from "clsx";
import type { ReactNode } from "react";
import { GroupStylePicker } from "./GroupStylePicker.js";
import { TOOL_LABELS, type Tool, useEditorStore } from "../store/editor.js";

/** The hand icon for the select tool. An arrow read as the line tool's arrow. */
function HandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5" />
      <path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v6" />
      <path d="M17 12.5V9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-4.7-2.3l-3.2-4.1a1.6 1.6 0 0 1 2.4-2.1L8 14.5" />
    </svg>
  );
}

/** The box tool's icon, square and rounded like the box it places. */
function BoxIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.2" />
    </svg>
  );
}

const TOOLS: { tool: Tool; icon: ReactNode; hint: string }[] = [
  { tool: "select", icon: <HandIcon />, hint: "Select / move (V)" },
  { tool: "box", icon: <BoxIcon />, hint: "Box — click to place (B)" },
  { tool: "text", icon: "T", hint: "Text — click to place (T)" },
  { tool: "shape", icon: "◇", hint: "Shape — click to place (S)" },
  {
    tool: "connect",
    icon: "↗",
    hint: "Line — drag between connection points on icons, boxes and shapes (L)",
  },
];

const LINE_STYLES: { value: LineStyle; label: string; preview: string }[] = [
  { value: "solid", label: "Solid", preview: "──" },
  { value: "dashed", label: "Dashed", preview: "╌╌" },
  { value: "dotted", label: "Dotted", preview: "┄┄" },
];

const ARROWS: { value: ArrowStyle; label: string; preview: string }[] = [
  { value: "none", label: "None", preview: "──" },
  { value: "end", label: "Right", preview: "──▶" },
  { value: "start", label: "Left", preview: "◀──" },
  { value: "both", label: "Both", preview: "◀─▶" },
];

const ROUTERS: { value: EdgeData["router"]; label: string }[] = [
  { value: "smoothstep", label: "Rounded" },
  { value: "step", label: "Orthogonal" },
  { value: "straight", label: "Straight" },
  { value: "bezier", label: "Curved" },
];

function Segment<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; preview?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          title={`${label}: ${option.label}`}
          aria-pressed={value === option.value}
          className={clsx(
            "rounded px-1.5 py-1 text-[11px] leading-none transition",
            value === option.value
              ? "bg-accent text-white"
              : "text-ink-muted hover:bg-accent/10 hover:text-ink",
          )}
        >
          {option.preview ?? option.label}
        </button>
      ))}
    </div>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-border-subtle" />;

/** The toolbar above the drawing area. */
export function Toolbar({
  onSave,
  onOpen,
  onNew,
  onExport,
  onAutoLayout,
}: {
  onSave: () => void;
  onOpen: () => void;
  onNew: () => void;
  onExport: () => void;
  onAutoLayout: () => void;
}) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const edgeStyle = useEditorStore((s) => s.edgeStyle);
  const setEdgeStyle = useEditorStore((s) => s.setEdgeStyle);
  const groupStyle = useEditorStore((s) => s.groupStyle);
  const setGroupStyle = useEditorStore((s) => s.setGroupStyle);
  const title = useEditorStore((s) => s.meta.title);
  const setTitle = useEditorStore((s) => s.setTitle);
  const dirty = useEditorStore((s) => s.dirty);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const past = useEditorStore((s) => s.past.length);
  const future = useEditorStore((s) => s.future.length);
  const layoutRunning = useEditorStore((s) => s.layoutRunning);
  const direction = useEditorStore((s) => s.layout.direction);
  const setLayoutOptions = useEditorStore((s) => s.setLayoutOptions);

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border-subtle bg-panel px-2 py-1.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Diagram title"
        className="w-52 rounded border border-transparent px-1.5 py-1 text-sm font-semibold outline-none hover:border-border-subtle focus:border-accent"
      />
      {dirty && (
        <span title="Unsaved changes" className="text-[10px] text-warn">
          ●
        </span>
      )}

      <Divider />

      {TOOLS.map((item) => (
        <button
          key={item.tool}
          type="button"
          onClick={() => setTool(item.tool)}
          title={item.hint}
          aria-pressed={tool === item.tool}
          aria-label={TOOL_LABELS[item.tool]}
          className={clsx(
            "grid h-7 w-7 place-items-center rounded text-sm transition",
            tool === item.tool
              ? "bg-accent text-white"
              : "text-ink-muted hover:bg-accent/10 hover:text-ink",
          )}
        >
          {item.icon}
        </button>
      ))}

      {/* The style picker appears only with the box tool. Always visible, it goes unnoticed. */}
      {tool === "box" && (
        <GroupStylePicker value={groupStyle} onChange={setGroupStyle} />
      )}

      <Divider />

      <Segment
        label="Line style"
        options={LINE_STYLES}
        value={edgeStyle.line}
        onChange={(line) => setEdgeStyle({ line })}
      />
      <Segment
        label="Arrow"
        options={ARROWS}
        value={edgeStyle.arrow}
        onChange={(arrow) => setEdgeStyle({ arrow })}
      />
      <select
        aria-label="Line shape"
        value={edgeStyle.router}
        onChange={(e) => setEdgeStyle({ router: e.target.value as EdgeData["router"] })}
        className="rounded border border-border-subtle bg-white px-1 py-1 text-[11px] text-ink-muted outline-none focus:border-accent"
      >
        {ROUTERS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      <Divider />

      <button
        type="button"
        onClick={onAutoLayout}
        disabled={layoutRunning}
        title="Re-run ELK auto layout (undoable)"
        className="rounded border border-border-subtle px-2 py-1 text-xs text-ink-muted enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-40"
      >
        {layoutRunning ? "Arranging…" : "Auto layout"}
      </button>
      <select
        aria-label="Layout direction"
        value={direction}
        onChange={(e) =>
          setLayoutOptions({ direction: e.target.value as LayoutOptions["direction"] })
        }
        className="rounded border border-border-subtle bg-white px-1 py-1 text-[11px] text-ink-muted outline-none focus:border-accent"
      >
        <option value="RIGHT">Right</option>
        <option value="DOWN">Down</option>
        <option value="LEFT">Left</option>
        <option value="UP">Up</option>
      </select>

      <Divider />

      <button
        type="button"
        onClick={undo}
        disabled={past === 0}
        title="Undo (⌘Z)"
        className="rounded px-2 py-1 text-xs text-ink-muted enabled:hover:bg-accent/10 enabled:hover:text-ink disabled:opacity-35"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={future === 0}
        title="Redo (⇧⌘Z)"
        className="rounded px-2 py-1 text-xs text-ink-muted enabled:hover:bg-accent/10 enabled:hover:text-ink disabled:opacity-35"
      >
        Redo
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onNew}
          className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-accent/10 hover:text-ink"
        >
          New
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-accent/10 hover:text-ink"
        >
          Open
        </button>
        <button
          type="button"
          onClick={onExport}
          title="Export as a single HTML file"
          className="rounded border border-border-subtle px-2 py-1 text-xs text-ink-muted hover:border-accent hover:text-accent"
        >
          Export HTML
        </button>
        <button
          type="button"
          onClick={onSave}
          title="Save (⌘S)"
          className="rounded bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>
  );
}
