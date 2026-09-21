import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SIZE,
  FILL_OPACITIES,
  FONT_SIZES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  TEXT_COLORS,
  isKnownTextColor,
  labelForColor,
  hasFill,
  labelForFontSize,
  labelForOpacity,
  resolveFill,
  rgbaFrom,
  textColorFieldFor,
} from "./palette.js";

describe("Text color", () => {
  it("has seven colours", () => {
    expect(TEXT_COLORS).toHaveLength(7);
  });

  it("all hex (matching the schema's Color)", () => {
    for (const color of TEXT_COLORS) {
      expect(color.value).toMatch(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    }
  });

  it("no duplicate values or names", () => {
    expect(new Set(TEXT_COLORS.map((c) => c.value)).size).toBe(7);
    expect(new Set(TEXT_COLORS.map((c) => c.label)).size).toBe(7);
  });

  it("recognises a known colour", () => {
    expect(isKnownTextColor(TEXT_COLORS[0]!.value)).toBe(true);
    expect(isKnownTextColor("#123456")).toBe(false);
    expect(isKnownTextColor(null)).toBe(false);
  });

  it("unset shows as Default", () => {
    expect(labelForColor(null)).toBe("Default");
    expect(labelForColor(TEXT_COLORS[2]!.value)).toBe("Blue");
  });
});

describe("Text size", () => {
  it("7px up to the default 14px", () => {
    expect(FONT_SIZES[0]).toBe(MIN_FONT_SIZE);
    expect(FONT_SIZES.at(-1)).toBe(MAX_FONT_SIZE);
    expect(MIN_FONT_SIZE).toBe(7);
    expect(MAX_FONT_SIZE).toBe(14);
  });

  it("the largest equals the default size (never larger)", () => {
    expect(MAX_FONT_SIZE).toBe(DEFAULT_FONT_SIZE);
    expect(Math.max(...FONT_SIZES)).toBe(DEFAULT_FONT_SIZE);
  });

  it("1px steps with no gaps", () => {
    expect(FONT_SIZES).toHaveLength(8);
    FONT_SIZES.forEach((size, index) => expect(size).toBe(MIN_FONT_SIZE + index));
  });

  it("the default size is one of the choices", () => {
    expect(FONT_SIZES).toContain(DEFAULT_FONT_SIZE);
  });

  it("stays inside the schema's range (6-96px)", () => {
    expect(MIN_FONT_SIZE).toBeGreaterThanOrEqual(6);
    expect(MAX_FONT_SIZE).toBeLessThanOrEqual(96);
  });

  it("the default size is labelled as the default", () => {
    expect(labelForFontSize(DEFAULT_FONT_SIZE)).toBe("Default (14px)");
    expect(labelForFontSize(null)).toBe("Default (14px)");
    expect(labelForFontSize(10)).toBe("10px");
  });
});

describe("where a colour is stored", () => {
  it("a box uses labelColor (kept apart from the border colour)", () => {
    expect(textColorFieldFor("group")).toBe("labelColor");
  });

  it("text uses color", () => {
    expect(textColorFieldFor("text")).toBe("color");
  });

  it("an unexpected type does not break it", () => {
    expect(textColorFieldFor("")).toBe("color");
  });
});

describe("fill opacity", () => {
  it("10% to 90% in steps of 10%", () => {
    expect(FILL_OPACITIES).toHaveLength(9);
    expect(FILL_OPACITIES[0]).toBeCloseTo(0.1, 5);
    expect(FILL_OPACITIES.at(-1)).toBeCloseTo(0.9, 5);
  });

  it("stays inside the schema's range (0.1-0.9)", () => {
    for (const opacity of FILL_OPACITIES) {
      expect(opacity).toBeGreaterThanOrEqual(0.1);
      expect(opacity).toBeLessThanOrEqual(0.9);
    }
  });

  it("unset shows as Default", () => {
    expect(labelForOpacity(null)).toBe("Default");
    expect(labelForOpacity(undefined)).toBe("Default");
    expect(labelForOpacity(0.3)).toBe("30%");
    expect(labelForOpacity(0.9)).toBe("90%");
  });
});

describe("combining colour and opacity", () => {
  it("builds rgba from hex", () => {
    expect(rgbaFrom("#3f5bd9", 0.5)).toBe("rgba(63, 91, 217, 0.5)");
  });

  it("handles the three-digit shorthand", () => {
    expect(rgbaFrom("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("reads it without the #", () => {
    expect(rgbaFrom("000000", 0.2)).toBe("rgba(0, 0, 0, 0.2)");
  });

  it("clamps an out-of-range opacity", () => {
    expect(rgbaFrom("#000", 5)).toContain(", 1)");
    expect(rgbaFrom("#000", -1)).toContain(", 0)");
  });

  it("returns an unreadable colour unchanged (never breaks rendering)", () => {
    expect(rgbaFrom("not-a-color", 0.5)).toBe("not-a-color");
  });
});

describe("deciding the fill", () => {
  const preset = { fillBase: "#7a52c7", fillOpacity: 0.05 };

  it("neither given keeps the preset", () => {
    expect(resolveFill(preset, {})).toBe("rgba(122, 82, 199, 0.05)");
  });

  it("colour alone uses the preset's opacity", () => {
    expect(resolveFill(preset, { fillColor: "#c0504d" })).toBe("rgba(192, 80, 77, 0.05)");
  });

  it("opacity alone applies to the preset's colour", () => {
    expect(resolveFill(preset, { fillOpacity: 0.4 })).toBe("rgba(122, 82, 199, 0.4)");
  });

  it("both given uses both", () => {
    expect(resolveFill(preset, { fillColor: "#2f7d4f", fillOpacity: 0.9 })).toBe(
      "rgba(47, 125, 79, 0.9)",
    );
  });
});

describe("node types with a fill", () => {
  it("boxes and shapes have one", () => {
    expect(hasFill("group")).toBe(true);
    expect(hasFill("shape")).toBe(true);
  });

  it("text and resources do not", () => {
    expect(hasFill("text")).toBe(false);
    expect(hasFill("resource")).toBe(false);
  });
});

describe("a shape holds no text", () => {
  it("it has a fill, but no text colour", () => {
    expect(hasFill("shape")).toBe(true);
  });
});
