/**
 * The size readout during a resize.
 *
 * Lining two boxes up at the same size needs the numbers. It shows only while resizing.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { SizeBadge, useSizeBadge } from "./SizeBadge.js";

afterEach(cleanup);

/** A small harness that exposes the hook's return value. */
let api: ReturnType<typeof useSizeBadge>;
function Harness() {
  api = useSizeBadge();
  return <SizeBadge size={api.size} />;
}

const params = (width: number, height: number) =>
  ({ width, height, x: 0, y: 0 }) as never;

describe("the size readout", () => {
  it("nothing when not resizing", () => {
    render(<Harness />);
    expect(screen.queryByTestId("size-badge")).toBeNull();
  });

  it("shows the size at the moment it is grabbed", () => {
    render(<Harness />);
    act(() => api.handlers.onResizeStart({} as never, params(320, 240)));

    expect(screen.getByTestId("size-badge").textContent).toBe("320 × 240");
  });

  it("updates as it is dragged", () => {
    render(<Harness />);
    act(() => api.handlers.onResizeStart({} as never, params(320, 240)));
    act(() => api.handlers.onResize({} as never, params(410, 255)));

    expect(screen.getByTestId("size-badge").textContent).toBe("410 × 255");
  });

  it("rounds fractions", () => {
    render(<Harness />);
    act(() => api.handlers.onResize({} as never, params(199.6, 100.2)));

    expect(screen.getByTestId("size-badge").textContent).toBe("200 × 100");
  });

  it("disappears on release", () => {
    render(<Harness />);
    act(() => api.handlers.onResize({} as never, params(320, 240)));
    act(() => api.handlers.onResizeEnd({} as never, params(320, 240)));

    expect(screen.queryByTestId("size-badge")).toBeNull();
  });
});
