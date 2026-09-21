import { describe, expect, it } from "vitest";
import { SNAP_THRESHOLD, snapDraggedNode, snapToNeighbors } from "./snapping.js";
import type { Rect } from "./geometry.js";
import type { ArchNode } from "./types.js";

const rect = (x: number, y: number, width = 100, height = 60): Rect => ({
  x,
  y,
  width,
  height,
});

describe("alignment snapping", () => {
  it("does nothing with no candidates", () => {
    const result = snapToNeighbors(rect(13, 27), []);
    expect(result.position).toEqual({ x: 13, y: 27 });
    expect(result.guides).toEqual([]);
  });

  it("left edges line up", () => {
    const result = snapToNeighbors(rect(103, 400), [rect(100, 0)]);
    expect(result.position.x).toBe(100);
  });

  it("right edges line up", () => {
    // The other's right edge is 200. Move so this rectangle's right edge is 200
    const result = snapToNeighbors(rect(97, 400), [rect(100, 0)]);
    expect(result.position.x + 100).toBe(200);
  });

  it("centres line up", () => {
    // The other's centre x is 150. A 60-wide rectangle centred there starts at 120
    const result = snapToNeighbors(rect(123, 400, 60, 40), [rect(100, 0)]);
    expect(result.position.x).toBe(120);
  });

  it("does not snap lines of different kinds", () => {
    // Snapping my left edge to your right edge would line boxes up flush, and the
    // 20px minimum gap at the same level would then make them impossible to release
    const result = snapToNeighbors(rect(203, 400), [rect(100, 0)]);
    expect(result.position.x).toBe(203);
  });

  it("snaps on both axes at once", () => {
    const result = snapToNeighbors(rect(103, 62), [rect(100, 60)]);
    expect(result.position).toEqual({ x: 100, y: 60 });
    expect(result.guides).toHaveLength(2);
  });

  it("does nothing past the threshold (deliberate offsets survive)", () => {
    const far = SNAP_THRESHOLD + 1;
    const result = snapToNeighbors(rect(100 + far, 400), [rect(100, 0)]);
    expect(result.position.x).toBe(100 + far);
    expect(result.guides).toEqual([]);
  });

  it("snaps to the nearest line", () => {
    // Candidates at 100 and 104. The moving left edge at 103 goes to 104
    const result = snapToNeighbors(rect(103, 400), [rect(100, 0), rect(104, 200)]);
    expect(result.position.x).toBe(104);
  });

  it("a threshold of 0 disables snapping", () => {
    const result = snapToNeighbors(rect(100, 400), [rect(100, 0)], 0);
    expect(result.guides).toEqual([]);
  });

  it("the guide spans both rectangles", () => {
    const result = snapToNeighbors(rect(103, 400), [rect(100, 0, 100, 60)]);
    const guide = result.guides.find((g) => g.axis === "x")!;

    expect(guide.position).toBe(100);
    expect(guide.start).toBe(0);
    expect(guide.end).toBe(460);
  });

  it("the guide is drawn from the snapped position", () => {
    const result = snapToNeighbors(rect(103, 62), [rect(100, 60)]);
    const horizontal = result.guides.find((g) => g.axis === "y")!;
    expect(horizontal.position).toBe(60);
  });
});

describe("snapping during a drag", () => {
  const box = (
    id: string,
    x: number,
    y: number,
    parentId?: string,
    size = { width: 200, height: 120 },
  ): ArchNode =>
    ({
      id,
      type: "group",
      position: { x, y },
      ...size,
      ...(parentId ? { parentId } : {}),
      data: { label: id, style: "generic", origin: "user" },
    }) as ArchNode;

  it("left edges line up with the neighbouring box", () => {
    const nodes = [box("a", 100, 0), box("b", 0, 0)];
    const result = snapDraggedNode("b", { x: 103, y: 400 }, nodes);

    expect(result.position.x).toBe(100);
    expect(result.guides.some((g) => g.axis === "x")).toBe(true);
  });

  it("a node with a parent comes back in relative coordinates", () => {
    // The parent is at (500, 300), so absolute 100 is relative -400
    const nodes = [
      box("parent", 500, 300, undefined, { width: 900, height: 700 }),
      box("a", 100, 0),
      box("child", 0, 0, "parent"),
    ];
    const result = snapDraggedNode("child", { x: -397, y: 100 }, nodes);

    expect(result.position.x).toBe(-400);
  });

  it("a node's own children are not snap targets", () => {
    // Children always move with the parent, so they would always line up
    const nodes = [
      box("parent", 0, 0, undefined, { width: 900, height: 700 }),
      box("child", 3, 3, "parent"),
    ];
    const result = snapDraggedNode("parent", { x: 50, y: 50 }, nodes);

    expect(result.position).toEqual({ x: 50, y: 50 });
    expect(result.guides).toEqual([]);
  });

  it("an unknown node does nothing", () => {
    const result = snapDraggedNode("missing", { x: 7, y: 9 }, [box("a", 0, 0)]);
    expect(result.position).toEqual({ x: 7, y: 9 });
  });

  it("a threshold of 0 turns snapping off (used while Alt is held)", () => {
    const nodes = [box("a", 100, 0), box("b", 0, 0)];
    const result = snapDraggedNode("b", { x: 103, y: 400 }, nodes, 0);

    expect(result.position.x).toBe(103);
  });
});
