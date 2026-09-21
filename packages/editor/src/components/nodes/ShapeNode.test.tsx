import type { ShapeNodeData } from "@architecture/schema";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CORNER_RADIUS_CLASS, GROUP_STYLES, SHAPE_PRESET } from "../../lib/defaults.js";
import type { ArchShapeNode } from "../../lib/types.js";
import { ShapeNode } from "./ShapeNode.js";

const data = (over: Partial<ShapeNodeData> = {}): ShapeNodeData => ({
  shape: "rect",
  fillColor: null,
  fillOpacity: null,
  stroke: null,
  origin: "user",
  ...over,
});

function renderShape(nodeData: ShapeNodeData) {
  return render(
    <ReactFlowProvider>
      <ShapeNode
        {...({
          id: "s1",
          data: nodeData,
          selected: false,
        } as unknown as NodeProps<ArchShapeNode>)}
      />
    </ReactFlowProvider>,
  );
}

const shapeOf = () => screen.getByTestId("shape-node");

afterEach(cleanup);

describe("a shape holds no text", () => {
  it("draws no text (overlay a text node for a caption)", () => {
    const { container } = renderShape(data());
    expect(container.textContent).toBe("");
  });

  it("and shows no input", () => {
    renderShape(data());
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("a shape's default look", () => {
  it("the same colour and opacity as the generic box preset", () => {
    expect(SHAPE_PRESET).toEqual(GROUP_STYLES.generic);
  });

  it("unset gives the same fill as a box", () => {
    renderShape(data());
    expect(shapeOf().style.background).toBe("rgba(139, 148, 167, 0.05)");
  });

  it("the border matches the generic box too", () => {
    renderShape(data());
    expect(shapeOf().style.border).toContain("rgb(139, 148, 167)");
  });
});

describe("a shape's corners", () => {
  it("a rectangle uses the same radius as a box", () => {
    renderShape(data({ shape: "rect" }));
    expect(shapeOf().className).toContain(CORNER_RADIUS_CLASS);
  });

  it("an ellipse and a diamond follow their own shape", () => {
    renderShape(data({ shape: "ellipse" }));
    expect(shapeOf().className).toContain("rounded-[50%]");
    cleanup();
    renderShape(data({ shape: "diamond" }));
    expect(shapeOf().className).toContain("clip-path");
  });
});

describe("a shape's fill", () => {
  it("changing only the colour keeps the default opacity", () => {
    renderShape(data({ fillColor: "#3f5bd9" }));
    expect(shapeOf().style.background).toBe("rgba(63, 91, 217, 0.05)");
  });

  it("changing only the opacity applies it to the default colour", () => {
    renderShape(data({ fillOpacity: 0.3 }));
    expect(shapeOf().style.background).toBe("rgba(139, 148, 167, 0.3)");
  });

  it("both apply when both are given", () => {
    renderShape(data({ fillColor: "#c0504d", fillOpacity: 0.5 }));
    expect(shapeOf().style.background).toBe("rgba(192, 80, 77, 0.5)");
  });

  it("changing the fill leaves the border alone", () => {
    renderShape(data({ fillColor: "#c0504d" }));
    expect(shapeOf().style.border).toContain("rgb(139, 148, 167)");
  });
});
