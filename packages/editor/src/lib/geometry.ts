/** Coordinate maths that accounts for parent/child nesting. Used to find the box under a drop, and so on. */
import { ICON_CENTER_OFFSET } from "./defaults.js";
import { isArchGroupNode, type ArchGroupNode, type ArchNode } from "./types.js";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

const sizeOf = (node: ArchNode): { width: number; height: number } => ({
  width: node.width ?? node.measured?.width ?? 0,
  height: node.height ?? node.measured?.height ?? 0,
});

/** Absolute canvas coordinates. React Flow's position is parent-relative, so they stack up. */
export function absolutePosition(node: ArchNode, byId: Map<string, ArchNode>): Point {
  let { x, y } = node.position;
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

export function absoluteRect(node: ArchNode, byId: Map<string, ArchNode>): Rect {
  return { ...absolutePosition(node, byId), ...sizeOf(node) };
}

const contains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

/** Node types that can hold other nodes. Matches the backend's CONTAINER_NODE_TYPES. */
export const CONTAINER_TYPES: ReadonlySet<ArchNode["type"]> = new Set([
  "group",
  "shape",
]);

/** Choose the smallest containing node. */
function findInnermostAt(
  nodes: ArchNode[],
  point: Point,
  accept: (node: ArchNode) => boolean,
  exclude?: Set<string>,
): ArchNode | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: { node: ArchNode; area: number } | undefined;

  for (const node of nodes) {
    if (node.hidden || !accept(node)) continue;
    if (exclude?.has(node.id)) continue;
    const rect = absoluteRect(node, byId);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (!contains(rect, point)) continue;
    const area = rect.width * rect.height;
    // On equal area, the one added later (in front) counts as inner
    if (!best || area <= best.area) best = { node, area };
  }
  return best?.node;
}

/** The innermost box containing the point. Used when nesting boxes. */
export function findGroupAt(
  nodes: ArchNode[],
  point: Point,
  options: { exclude?: Set<string> } = {},
): ArchNode | undefined {
  return findInnermostAt(nodes, point, (n) => n.type === "group", options.exclude);
}

/** Containing boxes ordered from smallest to largest. */
export function findGroupsAt(
  nodes: ArchNode[],
  point: Point,
  options: { exclude?: Set<string> } = {},
): ArchGroupNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const matches: { node: ArchGroupNode; area: number }[] = [];

  for (const node of nodes) {
    if (!isArchGroupNode(node) || node.hidden) continue;
    if (options.exclude?.has(node.id)) continue;
    const rect = absoluteRect(node, byId);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (!contains(rect, point)) continue;
    matches.push({ node, area: rect.width * rect.height });
  }

  // Smaller area = further in
  return matches.sort((a, b) => a.area - b.area).map((m) => m.node);
}

/** Smallest group or shape containing the point. */
export function findContainerAt(
  nodes: ArchNode[],
  point: Point,
  options: { exclude?: Set<string> } = {},
): ArchNode | undefined {
  return findInnermostAt(nodes, point, (n) => CONTAINER_TYPES.has(n.type), options.exclude);
}

/** Absolute node center for focus navigation. */
export function centerOf(node: ArchNode, byId: Map<string, ArchNode>): Point {
  const origin = absolutePosition(node, byId);

  // For a resource, the centre of the icon. Using the whole node's centre would
  // drift up and down with the number of label lines (service / name / id / tags).
  if (node.type === "resource") {
    return { x: origin.x + ICON_CENTER_OFFSET.x, y: origin.y + ICON_CENTER_OFFSET.y };
  }

  const { width, height } = sizeOf(node);
  return { x: origin.x + width / 2, y: origin.y + height / 2 };
}

/** Convert absolute coordinates into coordinates relative to a given parent. */
export function toRelativePosition(
  point: Point,
  parent: ArchNode | undefined,
  byId: Map<string, ArchNode>,
): Point {
  if (!parent) return point;
  const origin = absolutePosition(parent, byId);
  return { x: point.x - origin.x, y: point.y - origin.y };
}

/** Whether node is a descendant of ancestorId (guards against making a node its own parent). */
export function isDescendantOf(
  nodeId: string,
  ancestorId: string,
  byId: Map<string, ArchNode>,
): boolean {
  const seen = new Set<string>();
  let cursor: string | undefined = nodeId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor === ancestorId && cursor !== nodeId) return true;
    cursor = byId.get(cursor)?.parentId;
  }
  return false;
}

/** A node's id plus all of its descendants. Used to delete them together. */
export function withDescendants(nodeIds: string[], nodes: ArchNode[]): Set<string> {
  const result = new Set(nodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

export type BorderSide = "top" | "right" | "bottom" | "left";

export interface BorderSnap {
  /** The container being straddled (a box or a shape). */
  containerId: string;
  side: BorderSide;
  /** Position relative to the shape (the node's top-left), with the border through the icon's centre. */
  position: Point;
}

/** How far the icon's centre sits from the node's top-left. */
export interface IconCenterOffset {
  x: number;
  y: number;
}

/** Align the icon center with a container border within `band`. */
export function findNodeBorderAt(
  nodes: ArchNode[],
  point: Point,
  iconCenter: IconCenterOffset,
  band: number,
  options: { exclude?: Set<string> } = {},
): BorderSnap | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: { snap: BorderSnap; distance: number } | undefined;

  for (const node of nodes) {
    if (!CONTAINER_TYPES.has(node.type) || node.hidden) continue;
    if (options.exclude?.has(node.id)) continue;

    const rect = absoluteRect(node, byId);
    if (rect.width <= 0 || rect.height <= 0) continue;

    const withinX = point.x >= rect.x - band && point.x <= rect.x + rect.width + band;
    const withinY = point.y >= rect.y - band && point.y <= rect.y + rect.height + band;

    const candidates: { side: BorderSide; distance: number }[] = [];
    if (withinY) {
      candidates.push({ side: "left", distance: Math.abs(point.x - rect.x) });
      candidates.push({
        side: "right",
        distance: Math.abs(point.x - (rect.x + rect.width)),
      });
    }
    if (withinX) {
      candidates.push({ side: "top", distance: Math.abs(point.y - rect.y) });
      candidates.push({
        side: "bottom",
        distance: Math.abs(point.y - (rect.y + rect.height)),
      });
    }

    for (const candidate of candidates) {
      if (candidate.distance > band) continue;
      if (best && candidate.distance >= best.distance) continue;

      // Along the border, keep where it was dropped; across it, sit exactly on the line
      const alongX = clamp(point.x, rect.x, rect.x + rect.width);
      const alongY = clamp(point.y, rect.y, rect.y + rect.height);

      const center =
        candidate.side === "left"
          ? { x: rect.x, y: alongY }
          : candidate.side === "right"
            ? { x: rect.x + rect.width, y: alongY }
            : candidate.side === "top"
              ? { x: alongX, y: rect.y }
              : { x: alongX, y: rect.y + rect.height };

      best = {
        distance: candidate.distance,
        snap: {
          containerId: node.id,
          side: candidate.side,
          // Relative to the shape, with the icon's centre on the border.
          position: {
            x: center.x - rect.x - iconCenter.x,
            y: center.y - rect.y - iconCenter.y,
          },
        },
      };
    }
  }

  return best?.snap;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
