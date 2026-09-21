import type { GroupNodeData } from "@architecture/schema";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchGroupNode } from "../../lib/types.js";
import { NodeActionsProvider, type NodeActions } from "./context.js";
import { GroupNode } from "./GroupNode.js";

const data = (over: Partial<GroupNodeData> = {}): GroupNodeData => ({
  label: "Generic group",
  labelColor: null,
  fillColor: null,
  fillOpacity: null,
  style: "generic",
  resourceRef: null,
  iconKey: null,
  collapsed: false,
  origin: "user",
  ...over,
});

/** The node being edited lives in the Context, so the test reproduces that state. */
function renderGroup(nodeData: GroupNodeData, over: Partial<NodeActions> = {}) {
  const actions: NodeActions = {
    updateNodeData: vi.fn(),
    editable: true,
    editingNodeId: null,
    setEditingNodeId: vi.fn(),
    canResize: () => true,
    ...over,
  };
  const result = render(
    <ReactFlowProvider>
      <NodeActionsProvider value={actions}>
        <GroupNode
          {...({
            id: "g1",
            data: nodeData,
            selected: false,
          } as unknown as NodeProps<ArchGroupNode>)}
        />
      </NodeActionsProvider>
    </ReactFlowProvider>,
  );
  return { ...result, actions };
}

afterEach(cleanup);

describe("a box's name", () => {
  it("shows the name it was given", () => {
    renderGroup(data());
    expect(screen.getByText("Generic group")).toBeTruthy();
  });

  it("falls back to the preset name when it is empty", () => {
    renderGroup(data({ label: "", style: "vpc" }));
    expect(screen.getByText("VPC")).toBeTruthy();
  });

  it("double-clicking starts editing", async () => {
    const user = userEvent.setup();
    const { actions } = renderGroup(data());

    await user.dblClick(screen.getByText("Generic group"));
    expect(actions.setEditingNodeId).toHaveBeenCalledWith("g1");
  });

  it("editing shows an input with the value selected", () => {
    renderGroup(data(), { editingNodeId: "g1" });

    const input = screen.getByLabelText("Box name") as HTMLInputElement;
    expect(input.value).toBe("Generic group");
    // Selected so typing straight away replaces it
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Generic group".length);
  });

  it("Enter commits what was typed", async () => {
    const user = userEvent.setup();
    const { actions } = renderGroup(data(), { editingNodeId: "g1" });

    const input = screen.getByLabelText("Box name");
    await user.clear(input);
    await user.type(input, "vpc-prod{Enter}");

    expect(actions.updateNodeData).toHaveBeenCalledWith("g1", { label: "vpc-prod" });
    expect(actions.setEditingNodeId).toHaveBeenCalledWith(null);
  });

  it("losing focus commits too", async () => {
    const user = userEvent.setup();
    const { actions } = renderGroup(data(), { editingNodeId: "g1" });

    const input = screen.getByLabelText("Box name");
    await user.clear(input);
    await user.type(input, "prod VPC");
    await user.tab();

    expect(actions.updateNodeData).toHaveBeenCalledWith("g1", { label: "prod VPC" });
  });

  it("Escape throws the change away", async () => {
    const user = userEvent.setup();
    const { actions } = renderGroup(data(), { editingNodeId: "g1" });

    const input = screen.getByLabelText("Box name");
    await user.clear(input);
    await user.type(input, "discard{Escape}");

    expect(actions.updateNodeData).not.toHaveBeenCalled();
    expect(actions.setEditingNodeId).toHaveBeenCalledWith(null);
  });

  it("an unchanged value is not written (it would dirty the history)", async () => {
    const user = userEvent.setup();
    const { actions } = renderGroup(data(), { editingNodeId: "g1" });

    await user.type(screen.getByLabelText("Box name"), "{Enter}");
    expect(actions.updateNodeData).not.toHaveBeenCalled();
  });

  it("it can be emptied (the preset name then shows)", async () => {
    const user = userEvent.setup();
    const { actions } = renderGroup(data({ style: "vpc" }), { editingNodeId: "g1" });

    const input = screen.getByLabelText("Box name");
    await user.clear(input);
    await user.type(input, "{Enter}");

    expect(actions.updateNodeData).toHaveBeenCalledWith("g1", { label: "" });
  });

  it("the input does not steal React Flow's drag or pan", () => {
    renderGroup(data(), { editingNodeId: "g1" });
    const input = screen.getByLabelText("Box name");
    expect(input.className).toContain("nodrag");
    expect(input.className).toContain("nopan");
  });

  it("editing another node leaves this one alone", () => {
    renderGroup(data(), { editingNodeId: "g2" });
    expect(screen.queryByLabelText("Box name")).toBeNull();
  });

  it("read-only (the viewer) cannot edit", async () => {
    const user = userEvent.setup();
    const { actions } = renderGroup(data(), { editable: false, editingNodeId: "g1" });

    // Even with the Context saying it is being edited, editable=false shows no input
    expect(screen.queryByLabelText("Box name")).toBeNull();
    await user.dblClick(screen.getByText("Generic group"));
    expect(actions.setEditingNodeId).not.toHaveBeenCalled();
  });
});

describe("a box's text colour", () => {
  it("unset uses the preset colour", () => {
    const { container } = renderGroup(data({ style: "vpc" }));
    const label = container.querySelector("span.block")!;
    // The VPC preset's purple
    expect((label.parentElement as HTMLElement).style.color).toBe("rgb(122, 82, 199)");
  });

  it("the chosen colour is used", () => {
    const { container } = renderGroup(data({ style: "vpc", labelColor: "#c0504d" }));
    const label = container.querySelector("span.block")!;
    expect((label.parentElement as HTMLElement).style.color).toBe("rgb(192, 80, 77)");
  });

  it("the input carries the same colour while editing", () => {
    renderGroup(data({ labelColor: "#2f7d4f" }), { editingNodeId: "g1" });
    const input = screen.getByLabelText("Box name") as HTMLInputElement;
    expect(input.style.color).toBe("rgb(47, 125, 79)");
  });
})

describe("a box's fill", () => {
  const backgroundOf = (container: HTMLElement) =>
    (container.querySelector(".h-full.w-full") as HTMLElement).style.background;

  it("unset uses the preset colour and opacity", () => {
    const { container } = renderGroup(data({ style: "vpc" }));
    expect(backgroundOf(container)).toBe("rgba(122, 82, 199, 0.05)");
  });

  it("changing only the colour keeps the preset's opacity", () => {
    const { container } = renderGroup(data({ style: "vpc", fillColor: "#2f7d4f" }));
    expect(backgroundOf(container)).toBe("rgba(47, 125, 79, 0.05)");
  });

  it("changing only the opacity applies it to the preset's colour", () => {
    const { container } = renderGroup(data({ style: "vpc", fillOpacity: 0.6 }));
    expect(backgroundOf(container)).toBe("rgba(122, 82, 199, 0.6)");
  });

  it("both apply when both are given", () => {
    const { container } = renderGroup(
      data({ style: "vpc", fillColor: "#c0504d", fillOpacity: 0.9 }),
    );
    expect(backgroundOf(container)).toBe("rgba(192, 80, 77, 0.9)");
  });

  it("changing the fill leaves the border colour alone", () => {
    const { container } = renderGroup(data({ style: "vpc", fillColor: "#c0504d" }));
    const box = container.querySelector(".h-full.w-full") as HTMLElement;
    expect(box.style.border).toContain("rgb(122, 82, 199)");
  });
});

describe("how a box's title looks", () => {
  const labelOf = (container: HTMLElement) =>
    container.querySelector("span.block")!.parentElement as HTMLElement;

  it("sits on a canvas-coloured backing so it does not clash with the border", () => {
    const { container } = renderGroup(data());
    expect(labelOf(container).className).toContain("bg-canvas");
  });

  it("stays on the border line (not nudged inside)", () => {
    const { container } = renderGroup(data());
    const label = labelOf(container);
    expect(label.className).toContain("-top-px");
    expect(label.className).toContain("-translate-y-1/2");
  });
});
