import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  formatZoom,
  sliderToZoom,
  zoomToSlider,
} from "./zoom.js";

describe("the zoom slider's mapping", () => {
  it("the bottom is 10%, the middle 100%, the top 200%", () => {
    expect(sliderToZoom(0)).toBeCloseTo(MIN_ZOOM, 10);
    expect(sliderToZoom(0.5)).toBeCloseTo(DEFAULT_ZOOM, 10);
    expect(sliderToZoom(1)).toBeCloseTo(MAX_ZOOM, 10);
  });

  it("increases monotonically", () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const zoom = sliderToZoom(t);
      expect(zoom).toBeGreaterThan(prev);
      prev = zoom;
    }
  });

  it("clamps a t outside the range", () => {
    expect(sliderToZoom(-3)).toBe(MIN_ZOOM);
    expect(sliderToZoom(9)).toBe(MAX_ZOOM);
  });

  it("round-trips back to the original value", () => {
    for (const zoom of [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]) {
      expect(sliderToZoom(zoomToSlider(zoom))).toBeCloseTo(zoom, 10);
    }
    for (const t of [0, 0.13, 0.37, 0.5, 0.62, 0.88, 1]) {
      expect(zoomToSlider(sliderToZoom(t))).toBeCloseTo(t, 10);
    }
  });

  it("each half is log-uniform (the factors form a geometric series)", () => {
    // Lower half: 10% -> 100% split in four gives a geometric series
    const lower = [0, 0.125, 0.25, 0.375, 0.5].map(sliderToZoom);
    const ratios = lower.slice(1).map((v, i) => v / lower[i]!);
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0]!, 10);
  });

  it("clamps a zoom outside the range too", () => {
    expect(zoomToSlider(0.001)).toBe(0);
    expect(zoomToSlider(50)).toBe(1);
  });

  it("the percentage string", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.1)).toBe("10%");
    expect(formatZoom(1.997)).toBe("200%");
  });
});
