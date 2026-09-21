import type { TextNodeData } from "@architecture/schema";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchTextNode } from "../../lib/types.js";
import { NodeActionsProvider, type NodeActions } from "./context.js";
import { TextNode } from "./TextNode.js";

const data = (over: Partial<TextNodeData> = {}): TextNodeData => ({
  text: "note",
  fontSize: 14,
  bold: false,
  italic: false,
  color: null,
  align: "left",
  origin: "user",
  ...over,
});

function renderText(nodeData: TextNodeData, over: Partial<NodeActions> = {}) {
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
        <TextNode
          {...({
            id: "t1",
            data: nodeData,
            selected: false,
          } as unknown as NodeProps<ArchTextNode>)}
        />
      </NodeActionsProvider>
    </ReactFlowProvider>,
  );
  return { ...result, actions };
}

afterEach(cleanup);

describe("how text looks", () => {
  it("the font size applies", () => {
    const { container } = renderText(data({ fontSize: 22 }));
    const body = container.querySelector(".break-words") as HTMLElement;
    expect(body.style.fontSize).toBe("22px");
  });

  it("the colour applies", () => {
    const { container } = renderText(data({ color: "#3f5bd9" }));
    const body = container.querySelector(".break-words") as HTMLElement;
    expect(body.style.color).toBe("rgb(63, 91, 217)");
  });

  it("no colour set means no colour declared (it inherits)", () => {
    const { container } = renderText(data({ color: null }));
    const body = container.querySelector(".break-words") as HTMLElement;
    expect(body.style.color).toBe("");
  });

  it("a small size is honoured too", () => {
    const { container } = renderText(data({ fontSize: 7 }));
    const body = container.querySelector(".break-words") as HTMLElement;
    expect(body.style.fontSize).toBe("7px");
  });

  it("the input carries the same colour and size while editing", () => {
    renderText(data({ fontSize: 20, color: "#c0504d" }), { editingNodeId: "t1" });
    const textarea = screen.getByLabelText("Text") as HTMLTextAreaElement;
    expect(textarea.style.fontSize).toBe("20px");
    expect(textarea.style.color).toBe("rgb(192, 80, 77)");
  });

  it("bold and italic apply", () => {
    const { container } = renderText(data({ bold: true, italic: true }));
    const body = container.querySelector(".break-words") as HTMLElement;
    expect(body.style.fontWeight).toBe("700");
    expect(body.style.fontStyle).toBe("italic");
  });
});

describe("text has no fill", () => {
  it("declares no background colour", () => {
    const { container } = renderText(data());
    const body = container.querySelector(".break-words") as HTMLElement;
    expect(body.style.background).toBe("");
  });
});
