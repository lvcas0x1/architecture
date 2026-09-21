/** Snap matching edges and centers within the threshold; Alt disables snapping. */
import { absolutePosition, absoluteRect, withDescendants } from "./geometry.js";
import type { Point, Rect } from "./geometry.js";
import type { ArchNode } from "./types.js";

/** Snap once within this distance (canvas coordinates). */
export const SNAP_THRESHOLD = 6;

/** The guide drawn when something snaps. */
export interface Guide {
  axis: "x" | "y";
  /** Where the guide sits (absolute canvas coordinates). */
  position: number;
  /** The span to draw, covering both the moving rectangle and the other one. */
  start: number;
  end: number;
}

export interface SnapResult {
  /** Top-left after snapping (absolute canvas coordinates). */
  position: Point;
  guides: Guide[];
}

/** The three reference lines taken from a rectangle: not just edges, centres too. */
const xLinesOf = (rect: Rect): number[] => [
  rect.x,
  rect.x + rect.width / 2,
  rect.x + rect.width,
];

const yLinesOf = (rect: Rect): number[] => [
  rect.y,
  rect.y + rect.height / 2,
  rect.y + rect.height,
];

interface Candidate {
  /** How far the moving rectangle has to move. */
  delta: number;
  /** Where the line it snaps to sits. */
  line: number;
  /** The other rectangle. Used to size the guide. */
  other: Rect;
}

/** Compare matching edge types to preserve sibling spacing. */
function bestOn(
  movingLines: number[],
  others: Rect[],
  linesOf: (rect: Rect) => number[],
  threshold: number,
): Candidate | null {
  let best: Candidate | null = null;

  for (const other of others) {
    const otherLines = linesOf(other);
    for (const [index, movingLine] of movingLines.entries()) {
      const line = otherLines[index]!;
      const delta = line - movingLine;
      if (Math.abs(delta) > threshold) continue;
      if (best && Math.abs(best.delta) <= Math.abs(delta)) continue;
      best = { delta, line, other };
    }
  }
  return best;
}

/** Snap absolute rectangles; exclude the dragged node and its descendants. */
export function snapToNeighbors(
  moving: Rect,
  others: Rect[],
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  if (others.length === 0 || threshold <= 0) {
    return { position: { x: moving.x, y: moving.y }, guides: [] };
  }

  const x = bestOn(xLinesOf(moving), others, xLinesOf, threshold);
  const y = bestOn(yLinesOf(moving), others, yLinesOf, threshold);

  const position = {
    x: moving.x + (x?.delta ?? 0),
    y: moving.y + (y?.delta ?? 0),
  };
  const snapped: Rect = { ...position, width: moving.width, height: moving.height };

  const guides: Guide[] = [];
  if (x) {
    guides.push({
      axis: "x",
      position: x.line,
      start: Math.min(snapped.y, x.other.y),
      end: Math.max(snapped.y + snapped.height, x.other.y + x.other.height),
    });
  }
  if (y) {
    guides.push({
      axis: "y",
      position: y.line,
      start: Math.min(snapped.x, x?.other.x ?? y.other.x, y.other.x),
      end: Math.max(
        snapped.x + snapped.width,
        y.other.x + y.other.width,
      ),
    });
  }

  return { position, guides };
}


/** Snap in absolute coordinates, then restore parent-relative coordinates. */
export function snapDraggedNode(
  nodeId: string,
  /** The parent-relative position React Flow produced. */
  position: Point,
  nodes: ArchNode[],
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const moving = byId.get(nodeId);
  if (!moving) return { position, guides: [] };

  const parent = moving.parentId ? byId.get(moving.parentId) : undefined;
  const origin = parent ? absolutePosition(parent, byId) : { x: 0, y: 0 };

  const movingRect: Rect = {
    x: position.x + origin.x,
    y: position.y + origin.y,
    width: moving.width ?? moving.measured?.width ?? 0,
    height: moving.height ?? moving.measured?.height ?? 0,
  };

  // Never snap to this node or its descendants (they move along, so they always line up)
  const family = withDescendants([nodeId], nodes);
  const others = nodes
    .filter((node) => !family.has(node.id) && !node.hidden)
    .map((node) => absoluteRect(node, byId))
    .filter((rect) => rect.width > 0 && rect.height > 0);

  const snapped = snapToNeighbors(movingRect, others, threshold);
  return {
    position: {
      x: snapped.position.x - origin.x,
      y: snapped.position.y - origin.y,
    },
    guides: snapped.guides,
  };
}
