import { describe, expect, it } from "vitest";
import {
  resnapBorderChildren,
  BOX_INNER_MARGIN,
  BOX_SIBLING_GAP,
  canResizeTo,
  insetsFor,
  minimumSizeForChildren,
  overlappingSibling,
  parentExtentFor,
  rectsOverlap,
} from "./constraints.js";
import { ICON_CENTER_OFFSET } from "./defaults.js";
import type { ArchNode } from "./types.js";

/** The default is a styled box. Generic is exempt from the rules, so it is not used here. */
const group = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId?: string,
  style = "vpc",
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

const resource = (
  id: string,
  x: number,
  y: number,
  parentId: string,
  mount: "inside" | "border" = "inside",
): ArchNode =>
  ({
    id,
    type: "resource",
    position: { x, y },
    width: 132,
    height: 118,
    parentId,
    data: {
      iconKey: "Architecture/Compute/Amazon-EC2",
      mount,
      borderSide: mount === "border" ? "left" : null,
      origin: "user",
    },
  }) as ArchNode;

describe("the parent's inner inset", () => {
  it("is the same on all four sides (the title sits on the border, not inside)", () => {
    const insets = insetsFor(group("g", 0, 0, 100, 100));
    expect(insets).toEqual({
      top: BOX_INNER_MARGIN,
      right: BOX_INNER_MARGIN,
      bottom: BOX_INNER_MARGIN,
      left: BOX_INNER_MARGIN,
    });
  });

  it("a shape is the same", () => {
    expect(insetsFor(shape("s", 0, 0, 100, 100)).top).toBe(BOX_INNER_MARGIN);
  });

  it("no parent means no inset", () => {
    expect(insetsFor(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("extent (the inset from the parent)", () => {
  it("returns the parent-relative range that keeps the inset on all four sides", () => {
    const parent = group("p", 0, 0, 400, 300);
    const child = group("c", 20, 40, 100, 100, "p");

    const extent = parentExtentFor(child, parent);
    expect(extent).toEqual([
      [BOX_INNER_MARGIN, BOX_INNER_MARGIN],
      [400 - BOX_INNER_MARGIN, 300 - BOX_INNER_MARGIN],
    ]);
  });

  it("no parent means no restriction", () => {
    expect(parentExtentFor(group("c", 0, 0, 100, 100), undefined)).toBeUndefined();
  });

  it("a resource on a border is unrestricted (it has to stick out)", () => {
    const parent = group("p", 0, 0, 400, 300);
    expect(parentExtentFor(resource("n", 0, 0, "p", "border"), parent)).toBeUndefined();
  });

  it("a resource placed inside is restricted", () => {
    const parent = group("p", 0, 0, 400, 300);
    expect(parentExtentFor(resource("n", 0, 0, "p"), parent)).not.toBeUndefined();
  });

  it("falls back when the parent's size has not been measured", () => {
    const parent = { ...group("p", 0, 0, 0, 0) } as ArchNode;
    expect(parentExtentFor(group("c", 0, 0, 10, 10, "p"), parent)).toBe("parent");
  });
});

describe("overlap at the same level", () => {
  it("apart, they do not overlap", () => {
    const nodes = [group("a", 0, 0, 100, 100, "p"), group("b", 200, 0, 100, 100, "p")];
    expect(overlappingSibling(nodes, "a", "p", { x: 0, y: 0, width: 100, height: 100 })).toBeUndefined();
  });

  it("overlapping returns the other one", () => {
    const nodes = [group("a", 0, 0, 100, 100, "p"), group("b", 50, 50, 100, 100, "p")];
    expect(overlappingSibling(nodes, "a", "p", { x: 0, y: 0, width: 100, height: 100 })?.id).toBe("b");
  });

  it("touching still counts as overlapping when the gap is not met", () => {
    const nodes = [group("a", 0, 0, 100, 100, "p"), group("b", 105, 0, 100, 100, "p")];
    // Only 5px apart (the minimum is 10px)
    expect(overlappingSibling(nodes, "a", "p", { x: 0, y: 0, width: 100, height: 100 })?.id).toBe("b");
  });

  it("meeting the gap is allowed", () => {
    const nodes = [group("a", 0, 0, 100, 100, "p"), group("b", 100 + BOX_SIBLING_GAP + 1, 0, 100, 100, "p")];
    expect(overlappingSibling(nodes, "a", "p", { x: 0, y: 0, width: 100, height: 100 })).toBeUndefined();
  });

  it("different parents are not compared", () => {
    const nodes = [group("a", 0, 0, 100, 100, "p"), group("b", 0, 0, 100, 100, "q")];
    expect(overlappingSibling(nodes, "a", "p", { x: 0, y: 0, width: 100, height: 100 })).toBeUndefined();
  });

  it("a node is never compared with itself", () => {
    const nodes = [group("a", 0, 0, 100, 100, "p")];
    expect(overlappingSibling(nodes, "a", "p", { x: 0, y: 0, width: 100, height: 100 })).toBeUndefined();
  });

  it("rectangle overlap", () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("whether a resize is allowed", () => {
  const parent = group("p", 0, 0, 400, 300);

  const M = BOX_INNER_MARGIN;

  it("allowed while the parent's inset is respected", () => {
    const child = group("c", M, M, 100, 100, "p");
    expect(
      canResizeTo([parent, child], child, {
        x: M,
        y: M,
        width: 400 - M * 2,
        height: 300 - M * 2,
      }),
    ).toBe(true);
  });

  it("refused when it eats the parent's right inset", () => {
    const child = group("c", M, M, 100, 100, "p");
    expect(
      canResizeTo([parent, child], child, {
        x: M,
        y: M,
        width: 400 - M * 2 + 1,
        height: 100,
      }),
    ).toBe(false);
  });

  it("refused when it eats the parent's top inset", () => {
    const child = group("c", M, M, 100, 100, "p");
    expect(
      canResizeTo([parent, child], child, { x: M, y: M - 1, width: 100, height: 100 }),
    ).toBe(false);
  });

  it("refused at a size that would overlap a sibling", () => {
    const a = group("a", M, M, 100, 100, "p");
    const b = group("b", 200, M, 100, 100, "p");
    expect(canResizeTo([parent, a, b], a, { x: M, y: M, width: 100, height: 100 })).toBe(true);
    // Too wide to keep the 10px gap to b's left edge (200)
    expect(canResizeTo([parent, a, b], a, { x: M, y: M, width: 200 - M, height: 100 })).toBe(
      false,
    );
  });

  it("refused when it would shrink below what the children need", () => {
    const box = group("b", 0, 0, 400, 300);
    const child = group("c", M, M, 200, 150, "b");
    expect(canResizeTo([box, child], box, { x: 0, y: 0, width: 400, height: 300 })).toBe(true);
    expect(canResizeTo([box, child], box, { x: 0, y: 0, width: 150, height: 100 })).toBe(false);
  });

  it("a resource on a border does not block shrinking", () => {
    const box = group("b", 0, 0, 400, 300);
    const straddling = resource("n", -66, 100, "b", "border");
    expect(canResizeTo([box, straddling], box, { x: 0, y: 0, width: 200, height: 200 })).toBe(true);
  });

  it("with no parent it grows freely", () => {
    const box = group("b", 0, 0, 400, 300);
    expect(canResizeTo([box], box, { x: 0, y: 0, width: 5000, height: 5000 })).toBe(true);
  });
});

describe("the size the children need", () => {
  it("the outermost child plus the inset", () => {
    const parent = group("p", 0, 0, 400, 300);
    const child = group("c", BOX_INNER_MARGIN, BOX_INNER_MARGIN, 200, 150, "p");
    expect(minimumSizeForChildren([parent, child], parent)).toEqual({
      width: BOX_INNER_MARGIN + 200 + BOX_INNER_MARGIN,
      height: BOX_INNER_MARGIN + 150 + BOX_INNER_MARGIN,
    });
  });

  it("zero with no children", () => {
    const parent = group("p", 0, 0, 400, 300);
    expect(minimumSizeForChildren([parent], parent)).toEqual({ width: 0, height: 0 });
  });
});

describe("what the rules exempt", () => {
  const parent = group("p", 0, 0, 400, 300);

  it("a generic box is not bound by the parent's inset", () => {
    const generic = group("g", 0, 0, 100, 100, "p", "generic");
    expect(parentExtentFor(generic, parent)).toBeUndefined();
  });

  it("a generic box ignores the sibling gap too", () => {
    const a = group("a", 0, 0, 100, 100, "p", "generic");
    const b = group("b", 50, 50, 100, 100, "p");
    const rect = { x: 0, y: 0, width: 100, height: 100 };

    // This node is generic
    expect(overlappingSibling([a, b], "a", "p", rect, { style: "generic" })).toBeUndefined();
    // The other one is generic
    expect(
      overlappingSibling([a, b], "b", "p", { x: 0, y: 0, width: 100, height: 100 }, { style: "vpc" }),
    ).toBeUndefined();
  });

  it("a generic box is unrestricted when resizing too", () => {
    const generic = group("g", 0, 0, 100, 100, "p", "generic");
    expect(
      canResizeTo([parent, generic], generic, { x: 0, y: 0, width: 5000, height: 5000 }),
    ).toBe(true);
  });

  it("text is just as free", () => {
    const text = {
      id: "t",
      type: "text",
      position: { x: 0, y: 0 },
      width: 200,
      height: 40,
      parentId: "p",
      data: { text: "note", fontSize: 14, bold: false, italic: false, color: null, align: "left", origin: "user" },
    } as unknown as ArchNode;

    expect(parentExtentFor(text, parent)).toBeUndefined();
    expect(canResizeTo([parent, text], text, { x: -500, y: -500, width: 9000, height: 9000 })).toBe(true);
  });

  it("freely placed children do not count when shrinking the parent", () => {
    const box = group("b", 0, 0, 400, 300);
    const generic = group("g", 10, 10, 380, 280, "b", "generic");
    expect(minimumSizeForChildren([box, generic], box)).toEqual({ width: 0, height: 0 });
  });
});

describe("the rules are skipped when the other side is generic", () => {
  const genericParent = group("gp", 0, 0, 600, 400, undefined, "generic");

  it("with a generic parent, the contents are not bound by an inset", () => {
    const child = group("c", 0, 0, 100, 100, "gp");
    expect(parentExtentFor(child, genericParent)).toBeUndefined();
    expect(insetsFor(genericParent)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("with a generic parent, the contents grow freely", () => {
    const child = group("c", 0, 0, 100, 100, "gp");
    expect(
      canResizeTo([genericParent, child], child, {
        x: -100,
        y: -100,
        width: 5000,
        height: 5000,
      }),
    ).toBe(true);
  });

  it("with a generic parent, there is no lower bound on shrinking it", () => {
    const child = group("c", 10, 10, 500, 300, "gp");
    expect(minimumSizeForChildren([genericParent, child], genericParent)).toEqual({
      width: 0,
      height: 0,
    });
  });

  it("even a styled box may overlap a generic one", () => {
    const generic = group("g", 50, 50, 200, 200, "p", "generic");
    const vpc = group("v", 0, 0, 200, 200, "p");
    expect(
      overlappingSibling([generic, vpc], "v", "p", { x: 0, y: 0, width: 200, height: 200 }, {
        style: "vpc",
      }),
    ).toBeUndefined();
  });

  it("two styled boxes are judged as before", () => {
    const a = group("a", 0, 0, 200, 200, "p");
    const b = group("b", 100, 100, 200, 200, "p", "subnet-private");
    expect(
      overlappingSibling([a, b], "a", "p", { x: 0, y: 0, width: 200, height: 200 }, {
        style: "vpc",
      }),
    ).toBeDefined();
  });
});

describe("re-snapping an icon that straddles a border", () => {
  // Changing the parent's size moves only the border and leaves the icon behind
  const parent = (width: number, height: number): ArchNode =>
    ({
      id: "s1",
      type: "shape",
      position: { x: 0, y: 0 },
      width,
      height,
      data: { shape: "rounded", origin: "user" },
    }) as ArchNode;

  const onBorder = (side: string, x: number, y: number): ArchNode =>
    ({
      id: "n1",
      type: "resource",
      parentId: "s1",
      position: { x, y },
      data: {
        iconKey: "Architecture/Compute/Amazon-EC2",
        mount: "border",
        borderSide: side,
        origin: "user",
      },
    }) as ArchNode;

  it("an icon on the right edge moves to the new right edge", () => {
    const nodes = [parent(400, 300), onBorder("right", 400 - ICON_CENTER_OFFSET.x, 100)];
    const next = resnapBorderChildren([parent(600, 300), nodes[1]!], new Set(["s1"]));

    // The icon's centre lands on the right edge of a 600-wide parent
    expect(next[1]!.position.x).toBe(600 - ICON_CENTER_OFFSET.x);
  });

  it("an icon on the bottom edge moves to the new bottom edge", () => {
    const next = resnapBorderChildren(
      [parent(400, 500), onBorder("bottom", 100, 300 - ICON_CENTER_OFFSET.y)],
      new Set(["s1"]),
    );
    expect(next[1]!.position.y).toBe(500 - ICON_CENTER_OFFSET.y);
  });

  it("resizing an unrelated parent moves nothing", () => {
    const nodes = [parent(400, 300), onBorder("right", 400 - ICON_CENTER_OFFSET.x, 100)];
    expect(resnapBorderChildren(nodes, new Set(["other"]))).toBe(nodes);
  });

  it("an icon that is not on a border is left alone", () => {
    const inside = {
      ...onBorder("right", 100, 100),
      data: { iconKey: "x", mount: "inside", borderSide: null, origin: "user" },
    } as ArchNode;
    const nodes = [parent(400, 300), inside];
    expect(resnapBorderChildren(nodes, new Set(["s1"]))).toBe(nodes);
  });
});
