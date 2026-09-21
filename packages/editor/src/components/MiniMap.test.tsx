/**
 * Where the overview (minimap) sits and how big it is.
 *
 * It used to override only `left` in CSS rather than using `position`, so React
 * Flow's `right: 0` stayed and the panel stretched the full width, leaving a big
 * gap under the drawing area. This guards against that regression.
 */
import { MiniMap, ReactFlowProvider } from "@xyflow/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MINIMAP_SIZE } from "../lib/defaults.js";

beforeAll(() => {
  // React Flow expects a ResizeObserver
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

/** Render it exactly as Canvas.tsx does. */
function renderMiniMap() {
  return render(
    <ReactFlowProvider>
      <MiniMap
        pannable
        zoomable
        position="bottom-left"
        style={{ width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height }}
        offsetScale={2}
        className="!m-3 overflow-hidden !rounded-md !border !border-border-subtle !bg-panel/92 shadow-sm"
        ariaLabel="Diagram overview"
      />
    </ReactFlowProvider>,
  );
}

describe("the overview", () => {
  it("sits in the bottom-left", () => {
    const { container } = renderMiniMap();
    const panel = container.querySelector(".react-flow__minimap")!;

    expect(panel.classList.contains("bottom")).toBe(true);
    expect(panel.classList.contains("left")).toBe(true);
  });

  it("carries no right (so it does not stretch full width)", () => {
    const { container } = renderMiniMap();
    const panel = container.querySelector(".react-flow__minimap")!;

    // With both right and left in play the panel stretches and leaves empty space
    expect(panel.classList.contains("right")).toBe(false);
  });

  it("has an explicit size, smaller than the default 200x150", () => {
    const { container } = renderMiniMap();
    const svg = container.querySelector(".react-flow__minimap-svg")!;

    expect(svg.getAttribute("width")).toBe(String(MINIMAP_SIZE.width));
    expect(svg.getAttribute("height")).toBe(String(MINIMAP_SIZE.height));
    expect(MINIMAP_SIZE.width).toBeLessThan(200);
    expect(MINIMAP_SIZE.height).toBeLessThan(150);
  });

  it("has an accessible name", () => {
    const { container } = renderMiniMap();
    const svg = container.querySelector(".react-flow__minimap-svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(container.querySelector("title")?.textContent).toBe("Diagram overview");
  });
});
