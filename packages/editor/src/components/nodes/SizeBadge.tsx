/** The size readout shown while resizing, so two boxes can be made to match. */
import { useCallback, useState } from "react";
import type { OnResize, OnResizeEnd, OnResizeStart } from "@xyflow/react";

export interface SizeBadgeHandlers {
  onResizeStart: OnResizeStart;
  onResize: OnResize;
  onResizeEnd: OnResizeEnd;
}

export interface SizeBadgeState {
  size: { width: number; height: number } | null;
  handlers: SizeBadgeHandlers;
}

/** Returns the handlers for NodeResizer and the current size. */
export function useSizeBadge(): SizeBadgeState {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const onResizeStart = useCallback<OnResizeStart>((_event, params) => {
    setSize({ width: params.width, height: params.height });
  }, []);

  const onResize = useCallback<OnResize>((_event, params) => {
    setSize({ width: params.width, height: params.height });
  }, []);

  const onResizeEnd = useCallback<OnResizeEnd>(() => setSize(null), []);

  return { size, handlers: { onResizeStart, onResize, onResizeEnd } };
}

/** The `320 x 240` shown at the node's top-right. */
export function SizeBadge({ size }: { size: { width: number; height: number } | null }) {
  if (!size) return null;

  return (
    <div
      data-testid="size-badge"
      className="pointer-events-none absolute -top-6 right-0 z-10 rounded bg-accent px-1.5 py-0.5 text-[10px] leading-none font-semibold tabular-nums text-white shadow"
    >
      {Math.round(size.width)} × {Math.round(size.height)}
    </div>
  );
}
