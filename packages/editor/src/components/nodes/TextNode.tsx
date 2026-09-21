import { NodeResizer, type NodeProps } from "@xyflow/react";
import { SizeBadge, useSizeBadge } from "./SizeBadge.js";
import clsx from "clsx";
import { memo } from "react";
import type { ArchTextNode } from "../../lib/types.js";
import { useNodeActions } from "./context.js";
import { useInlineEdit } from "./useInlineEdit.js";

/** Free-floating text. Double-click to edit it in place. */
function TextNodeComponent({ id, data, selected }: NodeProps<ArchTextNode>) {
  const { editable } = useNodeActions();
  const edit = useInlineEdit<HTMLTextAreaElement>(id, "text", data.text, {
    multiline: true,
  });

  const style = {
    fontSize: data.fontSize,
    fontWeight: data.bold ? 700 : 400,
    fontStyle: data.italic ? "italic" : "normal",
    color: data.color ?? undefined,
    textAlign: data.align,
  } as const;

  const badge = useSizeBadge();

  return (
    <>
      <SizeBadge size={badge.size} />
      <NodeResizer
        {...badge.handlers}
        isVisible={editable && selected}
        minWidth={60}
        minHeight={24}
        lineClassName="!border-accent"
        handleClassName="!h-2 !w-2 !rounded-sm !border-white !bg-accent"
      />
      <div
        className={clsx(
          "h-full w-full rounded px-1 py-0.5",
          selected && "ring-2 ring-accent",
        )}
        onDoubleClick={edit.start}
      >
        {edit.editing ? (
          <textarea
            ref={edit.ref}
            value={edit.draft}
            onChange={(e) => edit.setDraft(e.target.value)}
            onBlur={edit.commit}
            onKeyDown={edit.onKeyDown}
            aria-label="Text"
            // Keep React Flow from stealing the drag or the pan
            className="nodrag nopan h-full w-full resize-none bg-white/90 outline-none"
            style={style}
          />
        ) : (
          <div className="h-full w-full break-words whitespace-pre-wrap" style={style}>
            {data.text ||
              (editable && (
                <span className="text-ink-muted italic">Double-click to edit</span>
              ))}
          </div>
        )}
      </div>
    </>
  );
}

export const TextNode = memo(TextNodeComponent);
