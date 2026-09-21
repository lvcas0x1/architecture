import { resourceScopeLabel, type IconEntry } from "@architecture/schema";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { groupByCategory, searchIcons } from "../lib/icons.js";
import { useCatalogStore } from "../store/catalog.js";
import { IconScopeMenu, type IconMenuState } from "./IconScopeMenu.js";

export const DND_MIME = "application/x-architecture-icon";

/** Short attribute marker shown at an icon's top-right. Space is tight, so 1-3 characters. */
const SCOPE_BADGES: Record<string, string> = {
  global: "G",
  region: "R",
  vpc: "VPC",
  zone: "AZ",
  subnet: "SN",
};

function IconButton({
  icon,
  onContextMenu,
}: {
  icon: IconEntry;
  onContextMenu: (state: IconMenuState) => void;
}) {
  // The attribute belongs to the icon, so the palette shows its current value.
  const scope = useCatalogStore((s) => s.scopeFor(icon.key));

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, icon.key);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu({ x: e.clientX, y: e.clientY, iconKey: icon.key });
      }}
      title={
        `${icon.label}\n${icon.key}\n` +
        `Attribute: ${resourceScopeLabel(scope)} (right-click to change)`
      }
      className="group relative flex cursor-grab flex-col items-center gap-1 rounded-md p-1.5 hover:bg-accent/8 active:cursor-grabbing"
    >
      <img
        src={icon.path}
        alt=""
        draggable={false}
        className="h-9 w-9 select-none"
        loading="lazy"
      />
      <span className="line-clamp-2 text-center text-[9px] leading-tight text-ink-muted group-hover:text-ink">
        {icon.label}
      </span>
      {scope !== "any" && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 rounded-sm bg-accent/15 px-1 text-[8px] font-semibold leading-[1.4] text-accent"
        >
          {SCOPE_BADGES[scope]}
        </span>
      )}
    </button>
  );
}

/** Search expands matching icon categories. */
export function Palette() {
  const { icons, byKey, status, error, isPlaceholder, scopeSaveError } = useCatalogStore();
  const [query, setQuery] = useState("");
  // Categories start collapsed. There are over 800 official icons, and leaving
  // them open means endless scrolling to reach the one you want.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<IconMenuState | null>(null);

  const filtered = useMemo(() => searchIcons(icons, query), [icons, query]);
  const categories = useMemo(() => groupByCategory(filtered), [filtered]);
  const searching = query.trim().length > 0;

  return (
    <aside className="flex w-[15%] min-w-[180px] max-w-[300px] shrink-0 flex-col border-r border-border-subtle bg-panel">
      {/* Height matches the toolbar on the right (min-h-11), so they line up. */}
      <div className="flex min-h-11 flex-col justify-center border-b border-border-subtle px-2 py-1.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search services"
          aria-label="Search icons"
          className="w-full rounded-md border border-border-subtle px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        {scopeSaveError && (
          <p className="mt-2 rounded bg-warn/10 px-2 py-1 text-[10px] leading-snug text-warn">
            {scopeSaveError}
          </p>
        )}
        {isPlaceholder && status === "ready" && (
          <p className="mt-2 rounded bg-warn/10 px-2 py-1 text-[10px] leading-snug text-warn">
            Placeholder icons for development. Import the official set with{" "}
            <code className="font-mono">npm run icons</code>.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-2">
        {status === "loading" && (
          <p className="p-2 text-xs text-ink-muted">Loading…</p>
        )}
        {status === "error" && (
          <p className="p-2 text-xs text-danger">{error}</p>
        )}
        {status === "ready" && filtered.length === 0 && (
          <p className="p-2 text-xs text-ink-muted">
            No icons match “{query}”.
          </p>
        )}

        {categories.map(([category, entries]) => {
          const isOpen = searching || expanded.has(category);
          return (
            <section key={category} className="mb-1">
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })
                }
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-semibold text-ink-muted hover:bg-accent/8"
              >
                <span
                  className={clsx(
                    "inline-block transition-transform",
                    isOpen && "rotate-90",
                  )}
                >
                  ▶
                </span>
                {category}
                <span className="ml-auto font-normal opacity-60">{entries.length}</span>
              </button>
              {isOpen && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-0.5 px-0.5">
                  {entries.map((icon) => (
                    <IconButton key={icon.key} icon={icon} onContextMenu={setMenu} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>


      {menu && (
        <IconScopeMenu
          state={menu}
          icon={byKey.get(menu.iconKey)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
