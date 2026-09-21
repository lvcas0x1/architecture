/**
 * The zoom slider on the right.
 *
 * An animation during a drag creates a d3 transition per input; they interrupt
 * one another and the motion stutters. While held, changes apply immediately.
 */
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const zoomTo = vi.fn();

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), zoomTo }),
  };
});

const { ZoomSlider } = await import("./ZoomSlider.js");

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => zoomTo.mockClear());
afterEach(cleanup);

const renderSlider = () =>
  render(
    <ReactFlowProvider>
      <ZoomSlider />
    </ReactFlowProvider>,
  );

describe("the zoom slider", () => {
  it("no animation while dragging", () => {
    renderSlider();
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "0.8" } });

    expect(zoomTo).toHaveBeenCalledWith(expect.any(Number), { duration: 0 });
  });

  it("the middle is 100%", () => {
    renderSlider();
    // The default viewport is 100%, so the thumb sits in the middle.
    expect((screen.getByLabelText("Zoom") as HTMLInputElement).value).toBe("0.5");
  });

  it("the top is 200% and the bottom 10%", () => {
    renderSlider();
    const slider = screen.getByLabelText("Zoom");

    fireEvent.change(slider, { target: { value: "1" } });
    expect(zoomTo).toHaveBeenLastCalledWith(2, expect.anything());

    fireEvent.change(slider, { target: { value: "0" } });
    expect(zoomTo).toHaveBeenLastCalledWith(0.1, expect.anything());
  });

  it("while held, the thumb follows the input value", () => {
    renderSlider();
    const slider = screen.getByLabelText("Zoom") as HTMLInputElement;

    // Even before the viewport catches up, the thumb is where it was released
    fireEvent.change(slider, { target: { value: "0.9" } });
    expect(slider.value).toBe("0.9");
  });

  it("on release it returns to the viewport's zoom", () => {
    renderSlider();
    const slider = screen.getByLabelText("Zoom") as HTMLInputElement;

    fireEvent.change(slider, { target: { value: "0.9" } });
    fireEvent.pointerUp(slider);

    // The default viewport is 100%, so it goes to the middle
    expect(slider.value).toBe("0.5");
  });

  it("double-clicking returns to 100%", async () => {
    const user = userEvent.setup();
    renderSlider();
    await user.dblClick(screen.getByLabelText("Zoom"));

    expect(zoomTo).toHaveBeenLastCalledWith(1, { duration: 120 });
  });

  it("shows no numbers (just the bar)", () => {
    const { container } = renderSlider();
    expect(container.textContent).toBe("");
  });

  it("near the middle it snaps to 100%", () => {
    renderSlider();
    const slider = screen.getByLabelText("Zoom") as HTMLInputElement;

    // Released just short of 100%, it lands exactly on it
    fireEvent.change(slider, { target: { value: "0.52" } });
    expect(zoomTo).toHaveBeenLastCalledWith(1, expect.anything());
    expect(slider.value).toBe("0.5");
  });

  it("past the snap range the zoom is left alone", () => {
    renderSlider();
    fireEvent.change(screen.getByLabelText("Zoom"), { target: { value: "0.6" } });

    const [zoomValue] = zoomTo.mock.calls.at(-1)!;
    expect(zoomValue).toBeGreaterThan(1);
  });

  it("at 100% the middle mark changes", () => {
    const { container } = renderSlider();
    // The default viewport is 100%
    expect(container.querySelector("[data-at-default]")).toBeTruthy();
  });

  it("is not operable from the keyboard", () => {
    renderSlider();
    expect(screen.getByLabelText("Zoom").getAttribute("tabindex")).toBe("-1");
  });
});
