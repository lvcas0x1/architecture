import type { LayoutOptions } from "@architecture/schema";
import { describe, expect, it } from "vitest";
import { autoLayout, collectPositions, sizeOf, toElkGraph } from "./layout.js";
import type { ArchEdge, ArchNode } from "./types.js";

const options: LayoutOptions = {
  mode: "auto",
  algorithm: "layered",
  direction: "RIGHT",
  nodeSpacing: 48,
  layerSpacing: 96,
  padding: 32,
};

const resource = (id: string, parentId?: string): ArchNode =>
  ({
    id,
    type: "resource",
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId } : {}),
    data: { iconKey: "Architecture/Compute/Amazon-EC2", origin: "ai" },
  }) as ArchNode;

const group = (id: string, parentId?: string): ArchNode =>
  ({
    id,
    type: "group",
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId } : {}),
    data: { label: id, style: "vpc", origin: "ai" },
  }) as ArchNode;

const shape = (id: string): ArchNode =>
  ({
    id,
    type: "shape",
    position: { x: 999, y: 999 },
    data: {
      shape: "rect",
      fillColor: null,
      fillOpacity: null,
      stroke: null,
      origin: "user",
    },
  }) as ArchNode;

const text = (id: string): ArchNode =>
  ({
    id,
    type: "text",
    position: { x: 500, y: 500 },
    data: { text: "note", origin: "user" },
  }) as ArchNode;

const edge = (id: string, source: string, target: string): ArchEdge =>
  ({ id, source, target, data: {} }) as ArchEdge;

describe("building the ELK graph", () => {
  it("nesting becomes a nested graph", () => {
    const graph = toElkGraph(
      [group("vpc"), group("sub", "vpc"), resource("n1", "sub")],
      [],
      options,
    );

    expect(graph.children).toHaveLength(1);
    const vpc = graph.children![0]!;
    expect(vpc.id).toBe("vpc");
    expect(vpc.children![0]!.id).toBe("sub");
    expect(vpc.children![0]!.children![0]!.id).toBe("n1");
  });

  it("decoration (text / shape) is left out of the layout", () => {
    const graph = toElkGraph(
      [resource("n1"), text("t1"), shape("s1")],
      [],
      options,
    );
    expect(graph.children!.map((c) => c.id)).toEqual(["n1"]);
  });

  it("edges touching an excluded node are left out", () => {
    const graph = toElkGraph(
      [resource("n1"), resource("n2"), shape("s1")],
      [edge("e1", "n1", "n2"), edge("e2", "n1", "s1")],
      options,
    );
    expect(graph.edges!.map((e) => e.id)).toEqual(["e1"]);
  });

  it("a node whose parent is missing is treated as a root", () => {
    const graph = toElkGraph([resource("n1", "missing")], [], options);
    expect(graph.children!.map((c) => c.id)).toEqual(["n1"]);
  });

  it("edges that cross levels are laid out too", () => {
    const graph = toElkGraph(
      [group("vpc"), resource("n1", "vpc")],
      [],
      options,
    );
    expect(graph.layoutOptions!["elk.hierarchyHandling"]).toBe(
      "INCLUDE_CHILDREN",
    );
  });

  it("the toolbar's spacing settings apply", () => {
    const graph = toElkGraph([resource("n1")], [], {
      ...options,
      nodeSpacing: 99,
    });
    expect(graph.layoutOptions!["elk.spacing.nodeNode"]).toBe("99");
  });
});

describe("deciding the size", () => {
  it("uses the measured value when there is one", () => {
    const node = { ...resource("n1"), width: 200, height: 300 } as ArchNode;
    expect(sizeOf(node)).toEqual({ width: 200, height: 300 });
  });

  it("an unmeasured resource takes the default size", () => {
    const { width, height } = sizeOf(resource("n1"));
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe("running the auto layout", () => {
  it("picks coordinates that do not overlap", async () => {
    const nodes = [resource("n1"), resource("n2"), resource("n3")];
    const edges = [edge("e1", "n1", "n2"), edge("e2", "n2", "n3")];

    const { nodes: laid, laidOut } = await autoLayout(nodes, edges, options);
    expect(laidOut).toBe(3);

    const positions = laid.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(3);
  });

  it("RIGHT lines them up rightwards in connection order", async () => {
    const nodes = [resource("n1"), resource("n2")];
    const { nodes: laid } = await autoLayout(
      nodes,
      [edge("e1", "n1", "n2")],
      options,
    );

    const byId = new Map(laid.map((n) => [n.id, n]));
    expect(byId.get("n2")!.position.x).toBeGreaterThan(
      byId.get("n1")!.position.x,
    );
  });

  it("DOWN lines them up downwards", async () => {
    const nodes = [resource("n1"), resource("n2")];
    const { nodes: laid } = await autoLayout(nodes, [edge("e1", "n1", "n2")], {
      ...options,
      direction: "DOWN",
    });

    const byId = new Map(laid.map((n) => [n.id, n]));
    expect(byId.get("n2")!.position.y).toBeGreaterThan(
      byId.get("n1")!.position.y,
    );
  });

  it("a box grows to hold its contents", async () => {
    const nodes = [group("vpc"), resource("n1", "vpc"), resource("n2", "vpc")];
    const { nodes: laid } = await autoLayout(
      nodes,
      [edge("e1", "n1", "n2")],
      options,
    );

    const vpc = laid.find((n) => n.id === "vpc")!;
    expect(vpc.width).toBeGreaterThan(200);
    expect(vpc.height).toBeGreaterThan(100);
  });

  it("a child's coordinates are relative to its parent (React Flow's convention)", async () => {
    const nodes = [group("vpc"), resource("n1", "vpc")];
    const { nodes: laid } = await autoLayout(nodes, [], options);

    const child = laid.find((n) => n.id === "n1")!;
    const parent = laid.find((n) => n.id === "vpc")!;
    // Relative, so it falls inside the parent's width
    expect(child.position.x).toBeGreaterThanOrEqual(0);
    expect(child.position.x).toBeLessThan(parent.width!);
  });

  it("decoration does not move", async () => {
    const nodes = [resource("n1"), text("t1"), shape("s1")];

    const { nodes: laid } = await autoLayout(nodes, [], options);
    expect(laid.find((n) => n.id === "t1")!.position).toEqual({
      x: 500,
      y: 500,
    });
    expect(laid.find((n) => n.id === "s1")!.position).toEqual({
      x: 999,
      y: 999,
    });
  });

  it("an empty diagram does not break it", async () => {
    const { laidOut } = await autoLayout([], [], options);
    expect(laidOut).toBe(0);
  });

  it("a diagram of only decoration does not break it either", async () => {
    const nodes = [text("t1")];
    const { nodes: laid, laidOut } = await autoLayout(nodes, [], options);
    expect(laidOut).toBe(0);
    expect(laid).toEqual(nodes);
  });

  it("deep nesting (VPC -> subnet -> resource) lays out too", async () => {
    const nodes = [
      group("vpc"),
      group("sub-a", "vpc"),
      group("sub-b", "vpc"),
      resource("n1", "sub-a"),
      resource("n2", "sub-b"),
    ];
    const { nodes: laid, laidOut } = await autoLayout(
      nodes,
      [edge("e1", "n1", "n2")],
      options,
    );

    expect(laidOut).toBe(5);
    const vpc = laid.find((n) => n.id === "vpc")!;
    // Big enough to hold both subnets
    expect(vpc.width! * vpc.height!).toBeGreaterThan(100000);
  });
});

describe("pulling out the positions", () => {
  it("picks up nested nodes as well", () => {
    const positions = collectPositions({
      id: "root",
      children: [{ id: "a", x: 1, y: 2, children: [{ id: "b", x: 3, y: 4 }] }],
    });
    expect(positions.get("a")).toEqual({ x: 1, y: 2 });
    expect(positions.get("b")).toEqual({ x: 3, y: 4 });
  });
});

describe("what the layout leaves alone", () => {
  it("preserves the size and contents of a box containing a locked child", async () => {
    const parent = { ...group("p"), width: 900, height: 600 } as ArchNode;
    const locked = {
      ...resource("fixed", "p"),
      draggable: false,
      position: { x: 650, y: 400 },
    } as ArchNode;
    const other = {
      ...resource("other", "p"),
      position: { x: 40, y: 60 },
    } as ArchNode;
    const { nodes: laid } = await autoLayout(
      [parent, locked, other],
      [],
      options,
    );
    expect(laid.find((n) => n.id === "p")).toMatchObject({
      width: 900,
      height: 600,
    });
    expect(laid.find((n) => n.id === "fixed")!.position).toEqual(
      locked.position,
    );
    expect(laid.find((n) => n.id === "other")!.position).toEqual(
      other.position,
    );
  });
  it("a locked node stays put (locked arrives as draggable:false)", () => {
    const nodes = [
      { ...group("g1"), draggable: false } as ArchNode,
      resource("n1", "g1"),
      group("g2"),
    ];
    const graph = toElkGraph(nodes, [], options);
    const ids = (graph.children ?? []).map((child) => child.id);

    expect(ids).toEqual(["g2"]);
  });

  it("a child of a hidden box is left out too, so it is not moved to a root coordinate", () => {
    const nodes = [
      { ...group("g1"), hidden: true } as ArchNode,
      resource("n1", "g1"),
    ];
    const graph = toElkGraph(nodes, [], options);

    expect(graph.children ?? []).toHaveLength(0);
  });
});
