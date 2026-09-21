/**
 * What happens when a check result is clicked.
 *
 * It only brings the node to the centre of the screen; the zoom does not change.
 * React Flow's setCenter jumps to the maximum zoom when none is given, so this
 * pins down that the current value is passed.
 */
import { ReactFlowProvider } from "@xyflow/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const setCenter = vi.fn();
const getZoom = vi.fn(() => 0.45);

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      setCenter,
      getZoom,
    }),
  };
});

const { Canvas } = await import("./Canvas.js");
const { useEditorStore } = await import("../store/editor.js");

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  useEditorStore.getState().newDiagram();
  setCenter.mockClear();
  getZoom.mockClear();
});

afterEach(cleanup);

const renderCanvas = () =>
  render(
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>,
  );

/** Place one box with one icon inside it. */
const seed = () => {
  const s = useEditorStore.getState();
  s.setGroupStyle("generic");
  const boxId = s.addGroupNode({ x: 100, y: 100 })!;
  const nodeId = s.addResourceNode("Architecture/Compute/Amazon-EC2", { x: 200, y: 200 })!;
  return { boxId, nodeId };
};

describe("focusing from a check result", () => {
  it("brings the node to the centre", async () => {
    const user = userEvent.setup();
    renderCanvas();
    let ids = { nodeId: "" };
    act(() => {
      ids = seed();
      useEditorStore.setState({
        issues: [{ level: "error", message: "test finding", nodeIds: [ids.nodeId] }],
      });
    });

    await user.click(screen.getByText("test finding"));

    // The dropped point is the icon's centre, so that is where it goes
    expect(setCenter).toHaveBeenCalledWith(200, 200, expect.anything());
  });

  it("leaves the zoom at its current value", async () => {
    const user = userEvent.setup();
    renderCanvas();
    act(() => {
      const { nodeId } = seed();
      useEditorStore.setState({
        issues: [{ level: "error", message: "test finding", nodeIds: [nodeId] }],
      });
    });

    await user.click(screen.getByText("test finding"));

    expect(setCenter).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ zoom: 0.45 }),
    );
  });

  it("a finding about a box centres the box", async () => {
    const user = userEvent.setup();
    renderCanvas();
    act(() => {
      const { boxId } = seed();
      useEditorStore.setState({
        issues: [{ level: "warning", message: "empty box", nodeIds: [boxId] }],
      });
    });

    await user.click(screen.getByText("empty box"));

    // The default box is 360x260, so its centre is (280, 230)
    expect(setCenter).toHaveBeenCalledWith(280, 230, expect.anything());
  });

  it("selects the node that was clicked", async () => {
    const user = userEvent.setup();
    renderCanvas();
    let nodeId = "";
    act(() => {
      nodeId = seed().nodeId;
      useEditorStore.setState({
        issues: [{ level: "error", message: "test finding", nodeIds: [nodeId] }],
      });
    });

    await user.click(screen.getByText("test finding"));

    expect(useEditorStore.getState().nodes.find((n) => n.id === nodeId)?.selected).toBe(true);
  });
});
