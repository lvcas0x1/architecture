/**
 * The message shown when a line is drawn where one cannot go.
 *
 * A line always joins connection points on icons, boxes or shapes, so anywhere
 * else it says "a line cannot go here" and why.
 */
import { ReactFlowProvider } from "@xyflow/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Canvas } from "./Canvas.js";
import { CONNECT_HINT, useEditorStore } from "../store/editor.js";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Fill in the APIs React Flow measures with, for jsdom
  if (!Element.prototype.getBoundingClientRect.call) return;
});

beforeEach(() => useEditorStore.getState().newDiagram());
afterEach(cleanup);

const renderCanvas = () =>
  render(
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>,
  );

describe("the message when a line cannot be drawn", () => {
  it("no alert by default", () => {
    renderCanvas();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pointing somewhere impossible gives the reason", () => {
    renderCanvas();
    act(() => useEditorStore.getState().setAlert(CONNECT_HINT));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("cannot be drawn here");
    expect(alert.textContent).toContain("connection point");
  });

  it("connecting to a node that cannot be connected explains why", () => {
    renderCanvas();
    act(() => {
      const store = useEditorStore.getState();
      // A resource only goes inside a container
      store.addGroupNode({ x: 0, y: 0 });
      const n = store.addResourceNode("Architecture/Compute/Amazon-EC2", {
        x: 120,
        y: 120,
      })!;
      const t = store.addTextNode({ x: 900, y: 0 });
      store.onConnect({
        source: n,
        target: t,
        sourceHandle: null,
        targetHandle: null,
      });
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "cannot be drawn here",
    );
    expect(useEditorStore.getState().edges).toHaveLength(0);
  });

  it("line mode explains how to use it", () => {
    renderCanvas();
    act(() => useEditorStore.getState().setTool("connect"));

    expect(screen.getByText(/Drag a connection point/)).toBeTruthy();
  });

  it("line mode keeps the connection points visible", () => {
    const { container } = renderCanvas();
    act(() => useEditorStore.getState().setTool("connect"));
    expect(container.querySelector(".canvas-connecting")).toBeTruthy();
  });

  it("select mode does not", () => {
    const { container } = renderCanvas();
    expect(container.querySelector(".canvas-connecting")).toBeNull();
  });
});

describe("placing with a drawing tool", () => {
  /** Screen-to-flow conversion is 1:1 by default, so coordinates pass straight through. */
  const clickAt = (element: Element, x: number, y: number) =>
    fireEvent.click(element, { clientX: x, clientY: y });

  const pane = (container: HTMLElement) =>
    container.querySelector(".react-flow__pane")!;

  it("clicking empty canvas places a box", () => {
    const { container } = renderCanvas();
    act(() => useEditorStore.getState().setTool("box"));

    act(() => {
      clickAt(pane(container), 100, 100);
    });

    expect(useEditorStore.getState().nodes).toHaveLength(1);
    // Once placed, the tool goes back to select
    expect(useEditorStore.getState().tool).toBe("select");
  });

  it("a box the hierarchy forbids is refused, and the reason stays", () => {
    const { container } = renderCanvas();
    act(() => useEditorStore.getState().setGroupStyle("account"));
    act(() => useEditorStore.getState().setTool("box"));

    act(() => {
      clickAt(pane(container), 100, 100);
    });

    expect(useEditorStore.getState().nodes).toHaveLength(0);
    // Resetting the tool would clear the alert, so it is not reset on failure
    expect(useEditorStore.getState().tool).toBe("box");
    expect(screen.getByRole("alert").textContent).toContain(
      "cannot sit directly on the canvas",
    );
  });

  it("clicking inside a box places one there too (it works on top of a node)", () => {
    const { container } = renderCanvas();
    act(() => {
      const store = useEditorStore.getState();
      store.setGroupStyle("global");
      store.addGroupNode({ x: 0, y: 0 });
    });
    expect(useEditorStore.getState().nodes).toHaveLength(1);

    act(() => {
      const store = useEditorStore.getState();
      store.setGroupStyle("account");
      store.setTool("box");
    });

    // Click the box's own node directly
    const groupNode = container.querySelector(".react-flow__node-group")!;
    act(() => {
      clickAt(groupNode, 60, 60);
    });

    const nodes = useEditorStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[1]!.data.style).toBe("account");
    expect(nodes[1]!.parentId).toBe(nodes[0]!.id);
  });

  it("with the select tool, clicking a node places nothing", () => {
    const { container } = renderCanvas();
    act(() => {
      const store = useEditorStore.getState();
      store.setGroupStyle("global");
      store.addGroupNode({ x: 0, y: 0 });
    });

    const groupNode = container.querySelector(".react-flow__node-group")!;
    act(() => {
      clickAt(groupNode, 60, 60);
    });

    expect(useEditorStore.getState().nodes).toHaveLength(1);
  });
});

it("ignores deletion and undo while a dialog is open", () => {
  const id = useEditorStore.getState().addTextNode({ x: 100, y: 100 });
  renderCanvas();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const button = document.createElement("button");
  dialog.append(button);
  document.body.append(dialog);
  try {
    fireEvent.keyDown(button, { key: "Delete" });
    fireEvent.keyDown(button, { key: "z", metaKey: true });
    expect(useEditorStore.getState().nodes.some((n) => n.id === id)).toBe(true);
  } finally {
    dialog.remove();
  }
});
it("routes arrow keys through the editor history instead of React Flow's direct movement", () => {
  const id = useEditorStore.getState().addTextNode({ x: 100, y: 100 });
  const { container } = renderCanvas();
  act(() => useEditorStore.setState({ dirty: false, past: [] }));
  const node = container.querySelector(`[data-id="${id}"]`)!;
  fireEvent.keyDown(node, { key: "ArrowRight" });
  expect(
    useEditorStore.getState().nodes.find((n) => n.id === id)!.position.x,
  ).toBe(105);
  expect(useEditorStore.getState().dirty).toBe(true);
  expect(useEditorStore.getState().past).toHaveLength(1);
});
