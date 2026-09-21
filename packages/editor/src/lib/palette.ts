/** Text color and size choices. */

export interface TextColor {
  /** The value that is saved (hex). */
  value: string;
  label: string;
}

/** The seven text colours. */
export const TEXT_COLORS: readonly TextColor[] = [
  { value: "#1d2330", label: "Black" },
  { value: "#5b6478", label: "Gray" },
  { value: "#3f5bd9", label: "Blue" },
  { value: "#2f7d4f", label: "Green" },
  { value: "#c0504d", label: "Red" },
  { value: "#c2691e", label: "Orange" },
  { value: "#7a52c7", label: "Purple" },
] as const;

/** Default text size for a text box. It is also the largest that can be picked. */
export const DEFAULT_FONT_SIZE = 14;

export const MIN_FONT_SIZE = 7;
export const MAX_FONT_SIZE = DEFAULT_FONT_SIZE;

/** 7px to 14px (the upper bound is the default size). */
export const FONT_SIZES: readonly number[] = Array.from(
  { length: MAX_FONT_SIZE - MIN_FONT_SIZE + 1 },
  (_, index) => MIN_FONT_SIZE + index,
);

/** Fill opacity, 10% to 90% in steps of 10%. */
export const FILL_OPACITIES: readonly number[] = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
];

export const labelForOpacity = (opacity: number | null | undefined): string =>
  opacity === null || opacity === undefined ? "Default" : `${Math.round(opacity * 100)}%`;

/** Build an rgba() from a hex colour and an opacity, which are picked separately. */
export function rgbaFrom(hex: string, opacity: number): string {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return hex;

  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const alpha = Math.min(1, Math.max(0, opacity));
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

/** Decide the fill by layering the user's colour and opacity over the preset defaults. */
export function resolveFill(
  preset: { fillBase: string; fillOpacity: number },
  data: { fillColor?: string | null; fillOpacity?: number | null },
): string {
  return rgbaFrom(
    data.fillColor ?? preset.fillBase,
    data.fillOpacity ?? preset.fillOpacity,
  );
}

export const isKnownTextColor = (value: string | null | undefined): boolean =>
  value !== null && value !== undefined && TEXT_COLORS.some((c) => c.value === value);

export const labelForColor = (value: string | null | undefined): string =>
  TEXT_COLORS.find((c) => c.value === value)?.label ?? "Default";

export const labelForFontSize = (size: number | null | undefined): string =>
  size === null || size === undefined || size === DEFAULT_FONT_SIZE
    ? `Default (${DEFAULT_FONT_SIZE}px)`
    : `${size}px`;

/** Node types that have a fill. Text is glyphs only, so it is excluded. */
export const FILLABLE_NODE_TYPES = ["group", "shape"] as const;

export const hasFill = (nodeType: string): boolean =>
  (FILLABLE_NODE_TYPES as readonly string[]).includes(nodeType);

/** Groups use `labelColor`; text nodes use `color`. */
export const textColorFieldFor = (nodeType: string): "labelColor" | "color" =>
  nodeType === "group" ? "labelColor" : "color";
