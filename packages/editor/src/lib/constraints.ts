/** Parent insets, sibling gaps, and resize constraints. */
import { canOverlapGroups } from "@architecture/schema";
import { ICON_CENTER_OFFSET } from "./defaults.js";
import { absoluteRect, type Rect } from "./geometry.js";
import type { ArchNode } from "./types.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The inset a child always keeps from its parent. The same on all four sides. */
export const BOX_INNER_MARGIN = 30;

/** Minimum gap between boxes with the same parent. */
export const BOX_SIBLING_GAP = 20;

/** Message when boxes at the same level would overlap. */
export const SIBLING_OVERLAP_HINT =
  "This would overlap another box. Leave a gap between them.";

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The parent's inner inset, the same on all four sides. */
export function insetsFor(parent: ArchNode | undefined): Insets {
  // With a generic parent, the contents are not bound by an inset either
  if (!parent || isUnconstrained(parent)) return NO_INSETS;
  const margin = BOX_INNER_MARGIN;
  return { top: margin, right: margin, bottom: margin, left: margin };
}

/** Node types exempt from the spacing rules. Text is an annotation. */
export const UNCONSTRAINED_NODE_TYPES: ReadonlySet<ArchNode["type"]> = new Set([
  "text",
]);

/** Text and generic groups are exempt from spacing rules. */
export function isUnconstrained(node: ArchNode | undefined): boolean {
  if (!node) return false;
  if (UNCONSTRAINED_NODE_TYPES.has(node.type)) return true;
  return node.type === "group" && node.data.style === "generic";
}

const sizeOf = (node: ArchNode): { width: number; height: number } => ({
  width: node.width ?? node.measured?.width ?? 0,
  height: node.height ?? node.measured?.height ?? 0,
});

export type NodeExtent = [[number, number], [number, number]];

/** Parent-relative movement bounds; border icons remain unrestricted. */
export function parentExtentFor(
  node: ArchNode,
  parent: ArchNode | undefined,
): NodeExtent | "parent" | undefined {
  if (!parent) return undefined;
  // No restriction when either side is generic or text.
  // A resource on a border also needs to stick out, so it is unrestricted.
  if (isUnconstrained(node) || isUnconstrained(parent)) return undefined;
  if (node.type === "resource" && node.data.mount === "border") return undefined;

  const { width, height } = sizeOf(parent);
  if (!width || !height) return "parent";

  const insets = insetsFor(parent);
  const right = Math.max(insets.left, width - insets.right);
  const bottom = Math.max(insets.top, height - insets.bottom);
  return [
    [insets.left, insets.top],
    [right, bottom],
  ];
}

/** The rectangle grown by the gap. */
export const inflate = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + by * 2,
  height: rect.height + by * 2,
});

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/** Boxes with the same parent, excluding this one. */
export function siblingBoxes(
  nodes: ArchNode[],
  nodeId: string,
  parentId: string | undefined,
): ArchNode[] {
  return nodes.filter(
    (n) =>
      n.id !== nodeId &&
      n.type === "group" &&
      !n.hidden &&
      (n.parentId ?? undefined) === parentId,
  );
}

/** The sibling box this rectangle would overlap, in parent-relative coordinates. */
export function overlappingSibling(
  nodes: ArchNode[],
  nodeId: string,
  parentId: string | undefined,
  rect: Rect,
  options: { style?: string; gap?: number } = {},
): ArchNode | undefined {
  // The generic box is the unconstrained escape hatch, so skip when this node is generic
  if (options.style === "generic") return undefined;

  const gap = options.gap ?? BOX_SIBLING_GAP;
  const inflated = inflate(rect, gap / 2);

  return siblingBoxes(nodes, nodeId, parentId).find((sibling) => {
    // Skip when the other side is generic too
    if (isUnconstrained(sibling)) return false;
    // Skip pairs allowed to cross as bands, such as a VPC and an AZ
    const siblingStyle = sibling.type === "group" ? sibling.data.style : "";
    if (options.style && canOverlapGroups(options.style, siblingStyle)) {
      return false;
    }
    const size = sizeOf(sibling);
    const siblingRect = inflate(
      { x: sibling.position.x, y: sibling.position.y, ...size },
      gap / 2,
    );
    return rectsOverlap(inflated, siblingRect);
  });
}

/** The smallest size that still holds the children (so a parent is not shrunk too far). */
export function minimumSizeForChildren(
  nodes: ArchNode[],
  parent: ArchNode,
): { width: number; height: number } {
  // With a generic parent, the contents are free, so there is no lower bound
  if (isUnconstrained(parent)) return { width: 0, height: 0 };

  const children = nodes.filter(
    (n) =>
      n.parentId === parent.id &&
      !n.hidden &&
      // Freely placed things (text, generic boxes, resources on a border) do not count
      !isUnconstrained(n) &&
      !(n.type === "resource" && n.data.mount === "border"),
  );
  if (children.length === 0) return { width: 0, height: 0 };

  const insets = insetsFor(parent);
  let right = 0;
  let bottom = 0;
  for (const child of children) {
    const size = sizeOf(child);
    right = Math.max(right, child.position.x + size.width);
    bottom = Math.max(bottom, child.position.y + size.height);
  }
  return { width: right + insets.right, height: bottom + insets.bottom };
}

/** Whether the size stays inside the parent and clear of the siblings. */
export function canResizeTo(
  nodes: ArchNode[],
  node: ArchNode,
  next: Rect,
): boolean {
  if (isUnconstrained(node)) return true;

  const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;

  // With a generic parent, it can grow freely inside
  if (parent && !isUnconstrained(parent)) {
    const insets = insetsFor(parent);
    const { width, height } = sizeOf(parent);
    if (next.x < insets.left || next.y < insets.top) return false;
    if (next.x + next.width > width - insets.right) return false;
    if (next.y + next.height > height - insets.bottom) return false;
  }

  // A container (box or shape) cannot shrink below what its contents need
  if (node.type === "group" || node.type === "shape") {
    const needed = minimumSizeForChildren(nodes, node);
    if (next.width < needed.width || next.height < needed.height) return false;
    // The sibling gap rule is about boxes. A shape has no style.
    const overlap =
      node.type === "group"
        ? overlappingSibling(nodes, node.id, node.parentId ?? undefined, next, {
            style: node.data.style,
          })
        : null;
    if (overlap) return false;
  }

  return true;
}

/** The node's current rectangle (relative to the parent). */
export const relativeRect = (node: ArchNode): Rect => ({
  x: node.position.x,
  y: node.position.y,
  ...sizeOf(node),
});

export { absoluteRect };

/** Keep border icons on the resized parent boundary. */
export function resnapBorderChildren(
  nodes: ArchNode[],
  resizedIds: Set<string>,
): ArchNode[] {
  if (resizedIds.size === 0) return nodes;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  let changed = false;

  const next = nodes.map((node) => {
    if (node.type !== "resource" || node.data.mount !== "border") return node;
    if (!node.parentId || !resizedIds.has(node.parentId)) return node;

    const parent = byId.get(node.parentId);
    if (!parent) return node;
    const { width, height } = sizeOf(parent);
    if (!width || !height) return node;

    const side = node.data.borderSide;
    const size = sizeOf(node);
    const position = { ...node.position };
    // Put the centre on the edge, and keep the other axis inside the parent:
    // shrinking the parent would otherwise leave the icon beyond the corner.
    if (side === "left") position.x = -ICON_CENTER_OFFSET.x;
    if (side === "right") position.x = width - ICON_CENTER_OFFSET.x;
    if (side === "top") position.y = -ICON_CENTER_OFFSET.y;
    if (side === "bottom") position.y = height - ICON_CENTER_OFFSET.y;
    if (side === "left" || side === "right") {
      position.y = clamp(position.y, 0, Math.max(0, height - size.height));
    } else {
      position.x = clamp(position.x, 0, Math.max(0, width - size.width));
    }

    if (position.x === node.position.x && position.y === node.position.y) return node;
    changed = true;
    return { ...node, position } as ArchNode;
  });

  return changed ? next : nodes;
}
