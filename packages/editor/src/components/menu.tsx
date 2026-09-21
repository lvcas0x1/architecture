/** Shared context menu components. */
import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

/** A menu that only carries the point that was right-clicked (a palette icon, say). */
export interface MenuAnchor {
  x: number;
  y: number;
}

export interface ActionItem {
  kind: "action";
  label: string;
  hint?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Marks the current value (the current colour or size). */
  checked?: boolean;
  /** Colour swatch shown at the start of the row. */
  swatch?: string;
  /** Draw the label at this size, so its real appearance is visible. */
  previewFontSize?: number;
}

export interface SubmenuItem {
  kind: "submenu";
  label: string;
  /** Show the current value on the right. */
  hint?: string;
  items: MenuItem[];
  disabled?: boolean;
}

export type MenuItem = ActionItem | SubmenuItem | { kind: "separator" };

const ROW_CLASS =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors";

/** Shared menu surface. */
export const MENU_SURFACE_CLASS =
  "rounded-md border border-border-subtle bg-panel pt-1 pb-2 shadow-lg";

const SUBMENU_CLASS = `absolute top-0 z-10 max-h-96 min-w-36 overflow-y-auto ${MENU_SURFACE_CLASS}`;

/** Nudge it so it stays on screen. */
export function useClampedPosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.min(x, Math.max(margin, window.innerWidth - width - margin)),
      top: Math.min(y, Math.max(margin, window.innerHeight - height - margin)),
    });
  }, [x, y]);

  return { ref, position };
}

export function MenuRow({
  item,
  onClose,
  depth,
}: {
  item: MenuItem;
  onClose: () => void;
  depth: number;
}) {
  const [openSub, setOpenSub] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const [flip, setFlip] = useState(false);
  const subRef = useRef<HTMLUListElement>(null);
  const [subTop, setSubTop] = useState(0);
  const closeTimer = useRef<number | undefined>(undefined);

  // Moving diagonally into the submenu can leave the row for a moment, so
  // closing is delayed and cancelled if the pointer comes back.
  const cancelClose = () => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpenSub(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpenSub(false), 180);
  };

  useEffect(() => cancelClose, []);

  useLayoutEffect(() => {
    if (!openSub || !rowRef.current) return;
    // Open to the left when opening right would go off screen
    const { right, top } = rowRef.current.getBoundingClientRect();
    const bounds = subRef.current?.getBoundingClientRect();
    setFlip(right + (bounds?.width ?? 200) > window.innerWidth - 8);
    setSubTop(
      Math.min(0, window.innerHeight - 8 - top - (bounds?.height ?? 0)),
    );
  }, [openSub]);

  if (item.kind === "separator") {
    return <li aria-hidden className="my-1 h-px bg-border-subtle" />;
  }

  if (item.kind === "submenu") {
    return (
      <li
        ref={rowRef}
        className="relative"
        onMouseEnter={() => !item.disabled && openNow()}
        onMouseLeave={closeSoon}
      >
        <button
          type="button"
          role="menuitem"
          aria-label={item.label}
          aria-haspopup="menu"
          aria-expanded={openSub}
          disabled={item.disabled}
          // Hovering already opened it, so this is not a toggle
          // (a toggle would close it immediately on hover-then-click)
          onClick={() => !item.disabled && openNow()}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              openNow();
            }
            if (event.key === "ArrowLeft" || event.key === "Escape") {
              if (!openSub) return;
              event.preventDefault();
              event.stopPropagation();
              cancelClose();
              setOpenSub(false);
            }
          }}
          className={clsx(
            ROW_CLASS,
            item.disabled
              ? "cursor-not-allowed text-ink-muted/45"
              : "text-ink hover:bg-accent/10",
          )}
        >
          <span>{item.label}</span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-ink-muted/80">
            {item.hint}
            <span aria-hidden>›</span>
          </span>
        </button>

        {openSub && (
          <ul
            ref={subRef}
            style={{ top: subTop, maxHeight: "calc(100vh - 16px)" }}
            role="menu"
            aria-label={item.label}
            onMouseEnter={openNow}
            className={clsx(
              SUBMENU_CLASS,
              flip ? "right-full mr-0.5" : "left-full ml-0.5",
            )}
          >
            {item.items.map((child, index) => (
              <MenuRow
                key={child.kind === "separator" ? `sep-${index}` : child.label}
                item={child}
                onClose={onClose}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        // Only items with a selected state (colour, size) act as radios
        role={item.checked === undefined ? "menuitem" : "menuitemradio"}
        {...(item.checked === undefined
          ? {}
          : { "aria-checked": item.checked })}
        aria-label={item.label}
        disabled={item.disabled}
        onClick={() => {
          item.onSelect();
          onClose();
        }}
        className={clsx(
          ROW_CLASS,
          item.disabled
            ? "cursor-not-allowed text-ink-muted/45"
            : item.danger
              ? "text-danger hover:bg-danger/8"
              : "text-ink hover:bg-accent/10",
          item.checked && "bg-accent/8",
        )}
      >
        {item.swatch && (
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-ink/15"
            style={{ background: item.swatch }}
          />
        )}
        <span
          style={
            item.previewFontSize
              ? {
                  fontSize: Math.min(item.previewFontSize, 20),
                  lineHeight: 1.3,
                }
              : undefined
          }
        >
          {item.label}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-ink-muted/80">
          {item.hint}
          {item.checked && <span aria-hidden>✓</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * The menu itself. Clamped on screen, closed by an outside click or Esc.
 */
export function ContextMenuSurface({
  anchor,
  label,
  items,
  onClose,
  className,
  header,
}: {
  anchor: MenuAnchor;
  label: string;
  items: MenuItem[];
  onClose: () => void;
  className?: string;
  /** Heading naming what this acts on (not clickable). */
  header?: string;
}) {
  const { ref, position } = useClampedPosition(anchor.x, anchor.y);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Without the capture phase, React Flow's panning gets there first
    window.addEventListener("pointerdown", handlePointer, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointer, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose, ref]);

  return (
    <div
      ref={ref}
      style={{ left: position.left, top: position.top }}
      className={clsx("fixed z-50 min-w-44", className)}
    >
      <ul
        role="menu"
        aria-label={label}
        className={clsx("overflow-visible", MENU_SURFACE_CLASS)}
      >
        {header && (
          <li
            aria-hidden
            className="truncate px-3 pb-1 pt-0.5 text-[10px] font-semibold text-ink-muted"
          >
            {header}
          </li>
        )}
        {items.map((item, index) => (
          <MenuRow
            key={item.kind === "separator" ? `sep-${index}` : item.label}
            item={item}
            onClose={onClose}
            depth={0}
          />
        ))}
      </ul>
    </div>
  );
}
