/** Piecewise logarithmic zoom with 100% at the midpoint. */

export const MIN_ZOOM = 0.1;
export const DEFAULT_ZOOM = 1.0;
export const MAX_ZOOM = 2.0;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** Slider position t (0..1) -> zoom factor. */
export function sliderToZoom(t: number): number {
  const clamped = clamp(t, 0, 1);
  const zoom =
    clamped < 0.5
      ? MIN_ZOOM * Math.pow(DEFAULT_ZOOM / MIN_ZOOM, clamped / 0.5)
      : DEFAULT_ZOOM * Math.pow(MAX_ZOOM / DEFAULT_ZOOM, (clamped - 0.5) / 0.5);
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/** Zoom factor -> slider position t (0..1). Reflects wheel zooming on the slider. */
export function zoomToSlider(zoom: number): number {
  const clamped = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const t =
    clamped < DEFAULT_ZOOM
      ? (0.5 * Math.log(clamped / MIN_ZOOM)) / Math.log(DEFAULT_ZOOM / MIN_ZOOM)
      : 0.5 + (0.5 * Math.log(clamped / DEFAULT_ZOOM)) / Math.log(MAX_ZOOM / DEFAULT_ZOOM);
  return clamp(t, 0, 1);
}

/** The percentage string for display. */
export const formatZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`;
