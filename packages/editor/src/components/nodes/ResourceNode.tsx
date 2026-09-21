import type { NormalizedResource, ResourceField, Tag } from "@architecture/schema";
import type { NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { memo } from "react";
import { ICON_SIZE, RESOURCE_NODE_WIDTH } from "../../lib/defaults.js";
import type { ArchResourceNode } from "../../lib/types.js";
import { useCatalogStore } from "../../store/catalog.js";
import { useResourceStore } from "../../store/resources.js";
import { ConnectHandles } from "./handles.js";

function TagChips({ tags, max }: { tags: Tag[]; max: number }) {
  if (tags.length === 0 || max === 0) return null;
  const shown = tags.slice(0, max);
  const hidden = tags.length - shown.length;
  const all = tags.map((t) => `${t.key}: ${t.value}`).join("\n");

  return (
    <div className="mt-0.5 flex flex-wrap justify-center gap-0.5" title={all}>
      {shown.map((tag) => (
        <span
          key={tag.key}
          className="max-w-full truncate rounded-sm bg-ink/8 px-1 text-[8px] leading-[13px] text-ink-muted"
        >
          {tag.key}: {tag.value}
        </span>
      ))}
      {hidden > 0 && (
        <span className="rounded-sm bg-ink/8 px-1 text-[8px] leading-[13px] text-ink-muted">
          +{hidden}
        </span>
      )}
    </div>
  );
}

/** The status badge. A deleted resource is called out explicitly. */
function StatusBadge({
  resource,
  bound,
}: {
  resource: NormalizedResource | undefined;
  bound: boolean;
}) {
  if (!bound) {
    return (
      <span className="inline-block rounded bg-warn/15 px-1 py-px text-[9px] font-medium text-warn">
        Not linked
      </span>
    );
  }
  if (!resource) {
    return (
      <span className="inline-block rounded bg-ink/10 px-1 py-px text-[9px] font-medium text-ink-muted">
        Not fetched
      </span>
    );
  }
  if (resource.lifecycle === "deleted") {
    return (
      <span className="inline-block rounded bg-danger/15 px-1 py-px text-[9px] font-semibold text-danger">
        Deleted
      </span>
    );
  }
  if (resource.lifecycle === "error") {
    return (
      <span
        title={resource.lastError ?? undefined}
        className="inline-block rounded bg-warn/15 px-1 py-px text-[9px] font-medium text-warn"
      >
        Fetch failed
      </span>
    );
  }
  if (resource.lifecycle === "unknown") {
    // Detail exists but the fetch state is unknown. Do not imply it is current.
    return (
      <span className="inline-block rounded bg-ink/10 px-1 py-px text-[9px] font-medium text-ink-muted">
        Not fetched
      </span>
    );
  }
  return null;
}

/** Render configured label fields and lifecycle status. */
function ResourceNodeComponent({ data, selected }: NodeProps<ArchResourceNode>) {
  const pathFor = useCatalogStore((s) => s.pathFor);
  const labelFor = useCatalogStore((s) => s.labelFor);
  const resource = useResourceStore((s) => s.get(data.resourceRef));
  const refreshing = useResourceStore((s) =>
    data.resourceRef ? s.refreshing[data.resourceRef] : undefined,
  );

  const iconPath = pathFor(data.iconKey);
  const bound = data.resourceRef !== null;
  const deleted = resource?.lifecycle === "deleted";
  const onBorder = data.mount === "border";

  const values: Record<ResourceField, string | null> = {
    service: resource?.service ?? labelFor(data.iconKey) ?? data.iconKey,
    name: data.labelOverride ?? resource?.name ?? null,
    resourceId: resource?.resourceId ?? null,
    tags: null,
  };

  return (
    <div
      className={clsx("flex flex-col items-center", deleted && "opacity-55")}
      style={{ width: RESOURCE_NODE_WIDTH }}
      data-testid="resource-node"
      data-lifecycle={resource?.lifecycle ?? (bound ? "unknown" : "unbound")}
    >
      <div
        className={clsx(
          "relative grid place-items-center rounded-lg transition",
          // The background is transparent by default. Only when straddling a border
          // does it become opaque, so the line does not cut across the icon.
          onBorder && "bg-white",
          selected && "ring-2 ring-accent",
          deleted && "ring-1 ring-dashed ring-danger/60",
        )}
        style={{ width: ICON_SIZE, height: ICON_SIZE }}
        data-testid="resource-icon"
      >
        {iconPath ? (
          <img
            src={iconPath}
            alt=""
            draggable={false}
            className={clsx("h-[52px] w-[52px] select-none", deleted && "grayscale")}
          />
        ) : (
          <span className="px-1 text-center text-[9px] leading-tight text-ink-muted">
            No icon
          </span>
        )}

        {refreshing === "loading" && (
          <span
            title="Refreshing"
            className="absolute -top-1 -right-1 h-3 w-3 animate-pulse rounded-full bg-accent ring-2 ring-white"
          />
        )}

        {/** Keep handles on the icon boundary, independent of label height. */}
        <ConnectHandles />
      </div>

      <div className="mt-1 w-full text-center leading-tight">
        {data.showFields.map((field) => {
          if (field === "tags") {
            return (
              <TagChips
                key={field}
                tags={resource?.tags ?? []}
                max={data.maxTags}
              />
            );
          }
          const value = values[field];
          if (!value) return null;
          return (
            <div
              key={field}
              title={value}
              className={clsx(
                "truncate",
                field === "service" && "text-[11px] font-semibold text-ink",
                field === "name" && "text-[10px] text-ink",
                field === "resourceId" &&
                  "font-mono text-[9px] text-ink-muted [font-variant-ligatures:none]",
                deleted && field === "service" && "line-through",
              )}
            >
              {value}
            </div>
          );
        })}

        <div className="mt-0.5">
          <StatusBadge resource={resource} bound={bound} />
        </div>
      </div>
    </div>
  );
}

export const ResourceNode = memo(ResourceNodeComponent);
