import { describe, expect, it } from "vitest";
import {
  absolutePosition,
  centerOf,
  findGroupAt,
  isDescendantOf,
  toRelativePosition,
  withDescendants,
} from "./geometry.js";
import type { ArchNode } from "./types.js";

const group = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string,
): ArchNode =>
  ({
    id,
    type: "group",
    position: { x, y },
    width,
    height,
    ...(parentId ? { parentId } : {}),
    data: { label: id, style: "generic", origin: "user" },
  }) as ArchNode;

const resource = (id: string, x: number, y: number, parentId?: string): ArchNode =>
  ({
    id,
    type: "resource",
    position: { x, y },
    ...(parentId ? { parentId } : {}),
    data: { iconKey: "Architecture/Compute/Amazon-EC2", origin: "user" },
  }) as ArchNode;

describe("a node's centre", () => {
  // Where "jump to it" lands from a check result or a parameter-table link
  it("a box is the centre of its rectangle", () => {
    const nodes = [group("vpc", 100, 50, 800, 400)];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(centerOf(nodes[0]!, byId)).toEqual({ x: 500, y: 250 });
  });

  it("a nested box uses absolute coordinates", () => {
    const nodes = [group("vpc", 100, 50, 800, 400), group("sub", 40, 30, 300, 200, "vpc")];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(centerOf(nodes[1]!, byId)).toEqual({ x: 290, y: 180 });
  });

  it("a resource is the centre of the icon (unaffected by the label lines)", () => {
    const nodes = [group("vpc", 100, 50, 800, 400), resource("n1", 20, 20, "vpc")];
    const byId = new Map(nodes.map((n) => [n.id, n]));

    // More labels only stretch the node downwards, so the centre does not move
    const before = centerOf(nodes[1]!, byId);
    const tall = { ...nodes[1]!, measured: { width: 96, height: 140 } } as ArchNode;
    expect(centerOf(tall, new Map([["vpc", nodes[0]!], ["n1", tall]]))).toEqual(before);
  });
});

describe("absolute coordinates", () => {
  it("stacks up the parents' coordinates", () => {
    const nodes = [group("vpc", 100, 50, 800, 400), group("sub", 40, 30, 300, 200, "vpc")];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(absolutePosition(nodes[1]!, byId)).toEqual({ x: 140, y: 80 });
  });

  it("a broken parent chain does not loop forever", () => {
    const orphan = resource("n1", 10, 10, "missing");
    const byId = new Map([["n1", orphan]]);
    expect(absolutePosition(orphan, byId)).toEqual({ x: 10, y: 10 });
  });
});

describe("finding the box under a drop", () => {
  const nodes = [
    group("vpc", 0, 0, 800, 400),
    group("sub-a", 40, 40, 300, 300, "vpc"),
    group("sub-b", 400, 40, 300, 300, "vpc"),
  ];

  it("picks the inner one (smallest area)", () => {
    expect(findGroupAt(nodes, { x: 100, y: 100 })?.id).toBe("sub-a");
    expect(findGroupAt(nodes, { x: 500, y: 100 })?.id).toBe("sub-b");
  });

  it("outside the subnet but inside the VPC gives the VPC", () => {
    expect(findGroupAt(nodes, { x: 370, y: 380 })?.id).toBe("vpc");
  });

  it("a point inside nothing is undefined", () => {
    expect(findGroupAt(nodes, { x: 900, y: 900 })).toBeUndefined();
  });

  it("an excluded box is never picked (a node is not its own parent)", () => {
    const found = findGroupAt(nodes, { x: 100, y: 100 }, { exclude: new Set(["sub-a"]) });
    expect(found?.id).toBe("vpc");
  });
});

describe("converting to relative coordinates", () => {
  it("unchanged with no parent", () => {
    expect(toRelativePosition({ x: 5, y: 6 }, undefined, new Map())).toEqual({ x: 5, y: 6 });
  });

  it("subtracts the parent's absolute origin", () => {
    const nodes = [group("vpc", 100, 50, 800, 400), group("sub", 40, 30, 300, 200, "vpc")];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(toRelativePosition({ x: 200, y: 150 }, nodes[1], byId)).toEqual({
      x: 60,
      y: 70,
    });
  });
});

describe("descendants", () => {
  const nodes = [
    group("vpc", 0, 0, 800, 400),
    group("sub", 40, 40, 300, 300, "vpc"),
    resource("n1", 10, 10, "sub"),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  it("a grandchild counts as a descendant", () => {
    expect(isDescendantOf("n1", "vpc", byId)).toBe(true);
    expect(isDescendantOf("sub", "vpc", byId)).toBe(true);
  });

  it("a node is not its own descendant", () => {
    expect(isDescendantOf("vpc", "vpc", byId)).toBe(false);
  });

  it("the other direction is false", () => {
    expect(isDescendantOf("vpc", "n1", byId)).toBe(false);
  });

  it("deleting a box takes its contents", () => {
    expect(withDescendants(["vpc"], nodes)).toEqual(new Set(["vpc", "sub", "n1"]));
    expect(withDescendants(["sub"], nodes)).toEqual(new Set(["sub", "n1"]));
  });
});
