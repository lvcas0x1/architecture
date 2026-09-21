import { describe, expect, it } from "vitest";
import { BOX_INNER_MARGIN } from "./constraints.js";
import { BORDER_SNAP_BAND, ICON_CENTER_OFFSET } from "./defaults.js";
import { findContainerAt, findNodeBorderAt } from "./geometry.js";
import { resolveGroupPlacement, resolveResourcePlacement } from "./placement.js";
import type { ArchNode } from "./types.js";

const group = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId?: string,
  style = "generic",
): ArchNode =>
  ({
    id,
    type: "group",
    position: { x, y },
    width: w,
    height: h,
    ...(parentId ? { parentId } : {}),
    data: { label: id, style, origin: "user" },
  }) as ArchNode;

const shape = (id: string, x: number, y: number, w: number, h: number): ArchNode =>
  ({
    id,
    type: "shape",
    position: { x, y },
    width: w,
    height: h,
    data: { shape: "rect", fillColor: null, fillOpacity: null, stroke: null, origin: "user" },
  }) as ArchNode;

const text = (id: string, x: number, y: number): ArchNode =>
  ({
    id,
    type: "text",
    position: { x, y },
    width: 200,
    height: 40,
    data: { text: "note", fontSize: 14, bold: false, italic: false, color: null, align: "left", origin: "user" },
  }) as ArchNode;

describe("finding the container", () => {
  const nodes = [group("vpc", 0, 0, 800, 400), shape("s1", 900, 0, 200, 120)];

  it("a box and a shape are both containers", () => {
    expect(findContainerAt(nodes, { x: 100, y: 100 })?.id).toBe("vpc");
    expect(findContainerAt(nodes, { x: 1000, y: 60 })?.id).toBe("s1");
  });

  it("text is not", () => {
    expect(findContainerAt([text("t1", 0, 0)], { x: 10, y: 10 })).toBeUndefined();
  });

  it("with nesting, the inner one wins", () => {
    const nested = [...nodes, group("sub", 40, 40, 200, 200, "vpc")];
    expect(findContainerAt(nested, { x: 100, y: 100 })?.id).toBe("sub");
  });

  it("a point inside nothing is undefined", () => {
    expect(findContainerAt(nodes, { x: 5000, y: 5000 })).toBeUndefined();
  });
});

describe("snapping to a border", () => {
  // The borders are x=100/300, y=100/200
  const nodes = [shape("s1", 100, 100, 200, 100)];
  const snap = (x: number, y: number) =>
    findNodeBorderAt(nodes, { x, y }, ICON_CENTER_OFFSET, BORDER_SNAP_BAND);

  it("snaps to the left edge", () => {
    expect(snap(102, 150)?.side).toBe("left");
  });

  it("and to the right, top and bottom edges", () => {
    expect(snap(298, 150)?.side).toBe("right");
    expect(snap(200, 102)?.side).toBe("top");
    expect(snap(200, 198)?.side).toBe("bottom");
  });

  it("snaps from outside the border too (it is meant to straddle)", () => {
    expect(snap(92, 150)?.side).toBe("left");
  });

  it("does not snap when far from the border", () => {
    expect(snap(200, 150)).toBeUndefined();
    expect(snap(500, 500)).toBeUndefined();
  });

  it("returns the position where the border runs through the icon's centre", () => {
    const result = snap(102, 150)!;
    // shape-relative position + the icon centre offset = the border (relative x=0)
    expect(result.position.x + ICON_CENTER_OFFSET.x).toBe(0);
    // Along the border, the dropped position is kept
    expect(result.position.y + ICON_CENTER_OFFSET.y).toBe(50);
  });

  it("on the right edge, the relative x is the shape's width", () => {
    const result = snap(298, 150)!;
    expect(result.position.x + ICON_CENTER_OFFSET.x).toBe(200);
  });

  it("on the bottom edge, the relative y is the shape's height", () => {
    const result = snap(200, 198)!;
    expect(result.position.y + ICON_CENTER_OFFSET.y).toBe(100);
  });

  it("keeps it within the shape along the border", () => {
    // Dropped above the left edge's top, it still stays on the edge
    const result = snap(100, 90)!;
    expect(result.position.y + ICON_CENTER_OFFSET.y).toBe(0);
  });

  it("picks the nearer edge", () => {
    // Near the top-left corner. The left edge is closer
    expect(snap(101, 110)?.side).toBe("left");
    expect(snap(110, 101)?.side).toBe("top");
  });

  it("a box's border snaps too", () => {
    const boxes = [group("vpc", 100, 100, 200, 100)];
    const snapped = findNodeBorderAt(
      boxes,
      { x: 102, y: 150 },
      ICON_CENTER_OFFSET,
      BORDER_SNAP_BAND,
    );
    expect(snapped?.side).toBe("left");
    expect(snapped?.containerId).toBe("vpc");
  });
});

describe("deciding the placement", () => {
  const nodes = [group("vpc", 0, 0, 800, 400), shape("s1", 900, 0, 200, 100)];
  const place = (point: { x: number; y: number }, options = {}) =>
    resolveResourcePlacement(nodes, point, options);

  it("inside a container means inside", () => {
    const result = place({ x: 400, y: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parentId).toBe("vpc");
    expect(result.value.mount).toBe("inside");
    expect(result.value.borderSide).toBeNull();
  });

  it("the dropped point becomes the icon's centre", () => {
    const result = place({ x: 400, y: 200 });
    if (!result.ok) throw new Error("it should be placeable");
    expect(result.value.position.x + ICON_CENTER_OFFSET.x).toBe(400);
    expect(result.value.position.y + ICON_CENTER_OFFSET.y).toBe(200);
  });

  it("near a border, border wins", () => {
    const result = place({ x: 902, y: 50 });
    if (!result.ok) throw new Error("it should be placeable");
    expect(result.value.parentId).toBe("s1");
    expect(result.value.mount).toBe("border");
    expect(result.value.borderSide).toBe("left");
  });

  it("outside a container it is refused, with a reason", () => {
    const result = place({ x: 5000, y: 5000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("inside a box or a shape");
  });

  it("an empty canvas takes nothing", () => {
    expect(resolveResourcePlacement([], { x: 0, y: 0 }).ok).toBe(false);
  });

  it("a node is never its own container (while dragging)", () => {
    expect(place({ x: 400, y: 200 }, { exclude: new Set(["vpc"]) }).ok).toBe(false);
  });

  it("with nesting, the inner container becomes the parent", () => {
    const nested = [...nodes, group("sub", 40, 40, 200, 200, "vpc")];
    const result = resolveResourcePlacement(nested, { x: 100, y: 100 });
    if (!result.ok) throw new Error("it should be placeable");
    expect(result.value.parentId).toBe("sub");
    // The position is relative to the parent
    expect(result.value.position.x + ICON_CENTER_OFFSET.x).toBe(60);
  });
});

describe("fitting when placed at the parent's edge", () => {
  // The parent is 600x400 with a 20px inset, so the usable range is 20..580 / 20..380
  // Generic is exempt from the rules, so a styled box is used
  const parent = group("p", 0, 0, 600, 400, undefined, "vpc");
  const INNER_RIGHT = 600 - BOX_INNER_MARGIN;
  const INNER_BOTTOM = 400 - BOX_INNER_MARGIN;
  const place = (x: number, y: number) =>
    resolveGroupPlacement([parent], { x, y }, "subnet-private");

  it("with room, it takes the default size at the clicked position", () => {
    const result = place(50, 50);
    if (!result.ok) throw new Error("it should be placeable");
    expect(result.value.position).toEqual({ x: 50, y: 50 });
    expect(result.value.size).toEqual({ width: 360, height: 260 });
  });

  it("placed to the right, the width shrinks rather than jumping left", () => {
    const result = place(400, 50);
    if (!result.ok) throw new Error("it should be placeable");
    // The clicked position stays the top-left (it used to jump far to the left)
    expect(result.value.position.x).toBe(400);
    expect(result.value.size.width).toBe(INNER_RIGHT - 400);
  });

  it("the same at the bottom, where the height shrinks", () => {
    const result = place(50, 250);
    if (!result.ok) throw new Error("it should be placeable");
    expect(result.value.position.y).toBe(250);
    expect(result.value.size.height).toBe(INNER_BOTTOM - 250);
  });

  it("where not even the minimum fits, it moves in that far", () => {
    const result = place(580, 380);
    if (!result.ok) throw new Error("it should be placeable");
    // Back to where the minimum 120 wide / 80 tall fits
    expect(result.value.position).toEqual({
      x: INNER_RIGHT - 120,
      y: INNER_BOTTOM - 80,
    });
  });

  it("it never goes past the parent's inset", () => {
    const result = place(0, 0);
    if (!result.ok) throw new Error("it should be placeable");
    expect(result.value.position).toEqual({
      x: BOX_INNER_MARGIN,
      y: BOX_INNER_MARGIN,
    });
  });

  it("wherever it is placed, it stays inside the parent", () => {
    for (const x of [20, 100, 300, 450, 520, 570]) {
      const result = place(x, 50);
      if (!result.ok) throw new Error("it should be placeable");
      expect(result.value.position.x + result.value.size.width).toBeLessThanOrEqual(
        INNER_RIGHT,
      );
    }
  });
});

describe("a generic box goes anywhere", () => {
  const parent = group("p", 0, 0, 600, 400, undefined, "vpc");

  it("keeps the position and size it was given, ignoring the parent's inset", () => {
    const result = resolveGroupPlacement([parent], { x: 560, y: 380 }, "generic");
    if (!result.ok) throw new Error("it should be placeable");
    expect(result.value.position).toEqual({ x: 560, y: 380 });
    expect(result.value.size).toEqual({ width: 360, height: 260 });
  });

  it("it may overlap other boxes", () => {
    const sibling = group("s", 20, 20, 300, 200, "p", "subnet-private");
    const result = resolveGroupPlacement([parent, sibling], { x: 50, y: 50 }, "generic");
    expect(result.ok).toBe(true);
  });
});
