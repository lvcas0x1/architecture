import { useReactFlow, useStore } from "@xyflow/react";
import clsx from "clsx";
import { DEFAULT_ZOOM, formatZoom, sliderToZoom, zoomToSlider } from "@architecture/schema";
import { useCallback, useState } from "react";

/** Snap within 7 px of the slider midpoint. */
const SNAP_RANGE = 0.035;

/** Piecewise logarithmic zoom: 10%, 100%, 200%. */
export function ZoomSlider() {
  // Watch only the zoom, so panning does not re-render this
  const zoom = useStore((state) => state.transform[2]);
  const { zoomTo } = useReactFlow();

  /** Use the pointer value during dragging to avoid viewport update lag. */
  const [dragging, setDragging] = useState<number | null>(null);

  const handleChange = useCallback(
    (value: number) => {
      // Near the middle, snap to exactly 100%
      const snapped = Math.abs(value - 0.5) < SNAP_RANGE ? 0.5 : value;
      setDragging(snapped);
      // Disable animation during dragging to avoid interrupted transitions.
      void zoomTo(sliderToZoom(snapped), { duration: 0 });
    },
    [zoomTo],
  );

  const t = dragging ?? zoomToSlider(zoom);
  // The mark's colour says whether it is snapped, so 100% reads without a number.
  const atDefault = Math.abs(zoom - DEFAULT_ZOOM) < 0.005;

  return (
    <div className="pointer-events-auto absolute top-1/2 right-3 z-10 flex -translate-y-1/2 flex-col items-center rounded-lg border border-border-subtle bg-panel/95 px-1.5 py-2 shadow-sm backdrop-blur">
      <div className="relative flex h-52 items-center">
        {/* The 100% position. A mark instead of a number. */}
        <span
          aria-hidden
          data-at-default={atDefault || undefined}
          className={clsx(
            "pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-all",
            atDefault ? "h-0.5 w-4 rounded-full bg-accent" : "h-px w-3 bg-ink-muted/45",
          )}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={t}
          onChange={(e) => handleChange(Number(e.target.value))}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
          onBlur={() => setDragging(null)}
          onDoubleClick={() => {
            setDragging(null);
            void zoomTo(DEFAULT_ZOOM, { duration: 120 });
          }}
          // Not operable from the keyboard (it has no step like + / - would)
          tabIndex={-1}
          aria-label="Zoom"
          aria-valuetext={formatZoom(zoom)}
          title={`${formatZoom(zoom)} — double-click for 100%`}
          className="zoom-slider h-52 w-4"
        />
      </div>
    </div>
  );
}
