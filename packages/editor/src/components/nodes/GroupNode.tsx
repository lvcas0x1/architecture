import { NodeResizer, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { memo } from "react";
import { groupStyleLabel } from "@architecture/schema";
import { CORNER_RADIUS_CLASS, GROUP_STYLES } from "../../lib/defaults.js";
import { resolveFill } from "../../lib/palette.js";
import type { ArchGroupNode } from "../../lib/types.js";
import { SizeBadge, useSizeBadge } from "./SizeBadge.js";
import { useNodeActions } from "./context.js";
import { ConnectHandles } from "./handles.js";
import { useInlineEdit } from "./useInlineEdit.js";

/** Only the border and title capture pointer events. */
function GroupNodeComponent({ id, data, selected }: NodeProps<ArchGroupNode>) {
  const preset = GROUP_STYLES[data.style] ?? GROUP_STYLES.generic;
  // Unset uses the preset colour (purple for a VPC, and so on)
  const labelColor = data.labelColor ?? preset.stroke;
  const background = resolveFill(preset, data);
  const { editable, canResize } = useNodeActions();
  const edit = useInlineEdit<HTMLInputElement>(id, "label", data.label);

  const badge = useSizeBadge();

  return (
    <>
      <SizeBadge size={badge.size} />
      <NodeResizer
        {...badge.handlers}
        isVisible={editable && selected}
        minWidth={120}
        minHeight={80}
        // Stop just short of leaving the parent or hitting a sibling
        shouldResize={(_event, next) => canResize(id, next)}
        lineClassName="!border-accent"
        handleClassName="!h-2 !w-2 !rounded-sm !border-white !bg-accent"
      />
      <ConnectHandles />
      <div
        className={clsx(
          "h-full w-full",
          CORNER_RADIUS_CLASS,
          selected && "ring-2 ring-accent",
        )}
        style={{
          border: `1.5px ${preset.dashed ? "dashed" : "solid"} ${preset.stroke}`,
          background,
        }}
      >
        <div
          className={clsx(
            "absolute -top-px left-2 max-w-[calc(100%-1rem)] -translate-y-1/2 rounded bg-canvas px-1.5 text-[11px] font-semibold",
            // Take the click only when editing is allowed; in read-only it passes through.
            editable ? "pointer-events-auto" : "pointer-events-none",
          )}
          style={{ color: labelColor }}
        >
          {edit.editing ? (
            <input
              ref={edit.ref}
              value={edit.draft}
              onChange={(e) => edit.setDraft(e.target.value)}
              onBlur={edit.commit}
              onKeyDown={edit.onKeyDown}
              aria-label="Box name"
              placeholder={groupStyleLabel(data.style)}
              size={Math.max(edit.draft.length + 2, 8)}
              // Keep React Flow from stealing the drag or the pan
              className="nodrag nopan bg-transparent font-semibold outline-none"
              style={{ color: labelColor }}
            />
          ) : (
            <span
              onDoubleClick={edit.start}
              title={editable ? "Double-click to rename" : undefined}
              className={clsx("block truncate", editable && "cursor-text")}
            >
              {data.label || groupStyleLabel(data.style)}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export const GroupNode = memo(GroupNodeComponent);
