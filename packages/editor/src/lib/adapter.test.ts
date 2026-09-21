import type { Diagram } from "@architecture/schema";
import { describe, expect, it } from "vitest";
import {
  edgeVisuals,
  routerToEdgeType,
  sortParentsFirst,
  toReactFlowEdges,
  toReactFlowNodes,
} from "./adapter.js";

const diagram = (over: Partial<Diagram> = {}): Diagram =>
  ({
    schemaVersion: "1.0",
    meta: { title: "t", generator: "user", accountIds: [], regions: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
    layout: { mode: "manual", algorithm: "layered", direction: "RIGHT" },
    nodes: [],
    edges: [],
    ...over,
  }) as Diagram;

describe("sorting parents first", () => {
  it("a parent comes before its child (React Flow's requirement)", () => {
    const nodes = [
      { id: "child", type: "resource", parentId: "parent", data: {} },
      { id: "parent", type: "group", data: {} },
      { id: "grandchild", type: "resource", parentId: "child", data: {} },
    ] as never as Diagram["nodes"];

    const ids = sortParentsFirst(nodes).map((n) => n.id);
    expect(ids.indexOf("parent")).toBeLessThan(ids.indexOf("child"));
    expect(ids.indexOf("child")).toBeLessThan(ids.indexOf("grandchild"));
  });

  it("returns every node even when a parent is missing", () => {
    const nodes = [
      { id: "orphan", type: "resource", parentId: "missing", data: {} },
    ] as never as Diagram["nodes"];
    expect(sortParentsFirst(nodes)).toHaveLength(1);
  });

  it("terminates on a cycle", () => {
    const nodes = [
      { id: "a", type: "group", parentId: "b", data: {} },
      { id: "b", type: "group", parentId: "a", data: {} },
    ] as never as Diagram["nodes"];
    expect(sortParentsFirst(nodes)).toHaveLength(2);
  });
});

describe("how an edge looks", () => {
  const base = {
    kind: "resource",
    line: "solid",
    arrow: "end",
    router: "smoothstep",
    label: null,
    color: null,
    width: 1.5,
    relationType: null,
    origin: "user",
  } as const;

  it("the arrow direction changes the markers", () => {
    expect(edgeVisuals({ ...base, arrow: "none" }).markerStart).toBeUndefined();
    expect(edgeVisuals({ ...base, arrow: "none" }).markerEnd).toBeUndefined();
    expect(edgeVisuals({ ...base, arrow: "start" }).markerStart).toBeDefined();
    expect(edgeVisuals({ ...base, arrow: "start" }).markerEnd).toBeUndefined();
    expect(edgeVisuals({ ...base, arrow: "both" }).markerStart).toBeDefined();
    expect(edgeVisuals({ ...base, arrow: "both" }).markerEnd).toBeDefined();
  });

  it("the line style becomes a dasharray", () => {
    expect(edgeVisuals({ ...base, line: "solid" }).style.strokeDasharray).toBeUndefined();
    expect(edgeVisuals({ ...base, line: "dashed" }).style.strokeDasharray).toBeTruthy();
    expect(edgeVisuals({ ...base, line: "dotted" }).style.strokeDasharray).not.toEqual(
      edgeVisuals({ ...base, line: "dashed" }).style.strokeDasharray,
    );
  });

  it("only bezier maps to React Flow's default type", () => {
    expect(routerToEdgeType("bezier")).toBe("default");
    expect(routerToEdgeType("smoothstep")).toBe("smoothstep");
    expect(routerToEdgeType("straight")).toBe("straight");
    expect(routerToEdgeType("step")).toBe("step");
  });
});

describe("converting for React Flow", () => {
  it("a locked node cannot be dragged", () => {
    const doc = diagram({
      nodes: [
        {
          id: "n1",
          type: "resource",
          position: { x: 0, y: 0 },
          size: null,
          parentId: null,
          zIndex: 0,
          locked: true,
          hidden: false,
          data: { iconKey: "Architecture/Compute/Amazon-EC2", origin: "user" },
        },
      ] as never as Diagram["nodes"],
    });
    const [node] = toReactFlowNodes(doc);
    expect(node!.draggable).toBe(false);
    expect(node!.selectable).toBe(false);
  });

  it("no position (an AI's auto layout) lands at the origin without breaking", () => {
    const doc = diagram({
      layout: { mode: "auto" } as never,
      nodes: [
        { id: "n1", type: "resource", data: { iconKey: "x/y/z", origin: "ai" } },
      ] as never as Diagram["nodes"],
    });
    expect(toReactFlowNodes(doc)[0]!.position).toEqual({ x: 0, y: 0 });
  });

  it("an edge's label and handles carry over", () => {
    const doc = diagram({
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          sourceHandle: "right",
          targetHandle: "left",
          data: {
            kind: "resource",
            line: "dashed",
            arrow: "both",
            router: "step",
            label: "HTTPS",
            color: null,
            width: 2,
            relationType: null,
            origin: "ai",
          },
        },
      ] as never as Diagram["edges"],
    });
    const [edge] = toReactFlowEdges(doc);
    expect(edge!.label).toBe("HTTPS");
    expect(edge!.sourceHandle).toBe("right");
    expect(edge!.type).toBe("step");
  });
});
