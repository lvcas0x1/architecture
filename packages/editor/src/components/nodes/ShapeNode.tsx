import { NodeResizer, type NodeProps } from "@xyflow/react";
import { SizeBadge, useSizeBadge } from "./SizeBadge.js";
import clsx from "clsx";
import { memo } from "react";
import { CORNER_RADIUS_CLASS, SHAPE_PRESET } from "../../lib/defaults.js";
import { resolveFill } from "../../lib/palette.js";
import type { ArchShapeNode } from "../../lib/types.js";
import { useNodeActions } from "./context.js";
import { ConnectHandles } from "./handles.js";

/** The corner radius matches a box (rect). The rest follow the shape. */
const SHAPE_CLASS: Record<ArchShapeNode["data"]["shape"], string> = {
  rect: CORNER_RADIUS_CLASS,
  rounded: "rounded-[1.25rem]",
  ellipse: "rounded-[50%]",
  diamond: "[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]",
};

/** Decorative shape; use a text node for captions. */
function ShapeNodeComponent({ id, data, selected }: NodeProps<ArchShapeNode>) {
  const { editable, canResize } = useNodeActions();

  const badge = useSizeBadge();

  return (
    <>
      <SizeBadge size={badge.size} />
      <NodeResizer
        {...badge.handlers}
        isVisible={editable && selected}
        minWidth={40}
        minHeight={40}
        shouldResize={(_event, next) => canResize(id, next)}
        lineClassName="!border-accent"
        handleClassName="!h-2 !w-2 !rounded-sm !border-white !bg-accent"
      />
      <ConnectHandles />
      <div
        className={clsx(
          "h-full w-full",
          SHAPE_CLASS[data.shape],
          selected && "ring-2 ring-accent",
        )}
        style={{
          background: resolveFill(SHAPE_PRESET, data),
          border: `1.5px solid ${data.stroke ?? SHAPE_PRESET.stroke}`,
        }}
        data-testid="shape-node"
      />
    </>
  );
}

export const ShapeNode = memo(ShapeNodeComponent);
