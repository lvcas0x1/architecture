/** Resolve resource and group placement using shared schema rules. */
import {
  canNestGroup,
  canOverlapGroups,
  canPlaceResource,
  explainNesting,
  explainScope,
  type ResourceScope,
} from "@architecture/schema";
import {
  insetsFor,
  isUnconstrained,
  overlappingSibling,
  SIBLING_OVERLAP_HINT,
} from "./constraints.js";
import {
  BORDER_SNAP_BAND,
  DEFAULT_GROUP_SIZE,
  ICON_CENTER_OFFSET,
  MIN_GROUP_SIZE,
} from "./defaults.js";
import {
  absolutePosition,
  findContainerAt,
  findGroupsAt,
  findNodeBorderAt,
  toRelativePosition,
  type BorderSide,
  type Point,
} from "./geometry.js";
import type { ArchNode } from "./types.js";

export interface ResourcePlacement {
  /** Id of the container (a box or a shape). */
  parentId: string;
  /** Position relative to the parent (the node's top-left corner). */
  position: Point;
  mount: "inside" | "border";
  borderSide: BorderSide | null;
}

export interface Rejected {
  reason: string;
}

export type PlacementResult<T> =
  { ok: true; value: T } | ({ ok: false } & Rejected);

/** Message when the parent is too small to hold a child. */
export const TOO_SMALL_HINT =
  "The surrounding box is too small to hold another box. Make it bigger first.";

/** Message when there is no container where the drop happened. */
export const PLACEMENT_HINT =
  "Nothing can be placed here. AWS resources go inside a box or a shape " +
  "(they may also straddle a border).";

const styleOf = (node: ArchNode | undefined): string | null =>
  node?.type === "group" ? node.data.style : null;

/** Decide a resource's placement from where its centre should land. */
export function resolveResourcePlacement(
  nodes: ArchNode[],
  iconCenter: Point,
  options: { exclude?: Set<string>; scope?: ResourceScope } = {},
): PlacementResult<ResourcePlacement> {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Try the border first. Near a border, it wins over the inside test.
  const border = findNodeBorderAt(
    nodes,
    iconCenter,
    ICON_CENTER_OFFSET,
    BORDER_SNAP_BAND,
    options,
  );
  if (border) {
    const container = byId.get(border.containerId);
    const style = styleOf(container);
    if (!canPlaceResource(options.scope, style)) {
      return { ok: false, reason: explainScope(options.scope!, style!) };
    }
    return {
      ok: true,
      value: {
        parentId: border.containerId,
        position: border.position,
        mount: "border",
        borderSide: border.side,
      },
    };
  }

  const container = findContainerAt(nodes, iconCenter, options);
  if (!container) return { ok: false, reason: PLACEMENT_HINT };

  const style = styleOf(container);
  if (!canPlaceResource(options.scope, style)) {
    return { ok: false, reason: explainScope(options.scope!, style!) };
  }

  const relative = toRelativePosition(iconCenter, container, byId);
  return {
    ok: true,
    value: {
      parentId: container.id,
      // Shift back to the top-left so the dropped point is the icon's centre
      position: {
        x: relative.x - ICON_CENTER_OFFSET.x,
        y: relative.y - ICON_CENTER_OFFSET.y,
      },
      mount: "inside",
      borderSide: null,
    },
  };
}

export interface GroupPlacement {
  parentId: string | undefined;
  position: Point;
  size: { width: number; height: number };
}

/** Decide a box's placement. Refused unless nesting and sibling gaps allow it. */
export function resolveGroupPlacement(
  nodes: ArchNode[],
  topLeft: Point,
  style: string,
  options: {
    exclude?: Set<string>;
    defaultSize?: { width: number; height: number };
    /** Id of the box being moved, so it is not tested against itself. */
    movingNodeId?: string;
    /** Current parent of the box being moved. */
    currentParentId?: string;
  } = {},
): PlacementResult<GroupPlacement> {
  const defaultSize = options.defaultSize ?? DEFAULT_GROUP_SIZE;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Look for a box that can hold this style, from the inside out.
  // In a diagram where a VPC and an AZ cross, the innermost is not always the right parent.
  const candidates = findGroupsAt(nodes, topLeft, options);
  const legal = candidates.filter((candidate) =>
    canNestGroup(style, candidate.data.style),
  );

  /** Avoid adopting crossing bands or generic groups during incidental overlap. */
  const absorbsOnDrag = (candidate: (typeof legal)[number]): boolean =>
    Boolean(options.movingNodeId) &&
    candidate.id !== options.currentParentId &&
    (canOverlapGroups(style, candidate.data.style) ||
      isUnconstrained(candidate));

  // Prefer any other box that can hold it.
  // With none (it can only go in that box), take it as the parent.
  const parent =
    legal.find((candidate) => !absorbsOnDrag(candidate)) ?? legal[0];

  if (!parent) {
    // Dropped on a box but none of them can hold it: an error.
    // Over no box at all: check whether it may sit on the bare canvas.
    const innermost = candidates[0];
    if (innermost || !canNestGroup(style, null)) {
      return {
        ok: false,
        reason: explainNesting(style as never, innermost?.data.style ?? null),
      };
    }
  }

  const moving = options.movingNodeId
    ? byId.get(options.movingNodeId)
    : undefined;
  const position = toRelativePosition(
    moving ? absolutePosition(moving, byId) : topLeft,
    parent,
    byId,
  );
  const insets = insetsFor(parent);

  // Refuse when the parent is so small that the insets leave no room for the
  // smallest child. Saying why before placing beats "it does not fit" afterwards.
  if (parent && !isUnconstrained(parent) && style !== "generic") {
    const width = parent.width ?? parent.measured?.width ?? 0;
    const height = parent.height ?? parent.measured?.height ?? 0;
    const innerWidth = width - insets.left - insets.right;
    const innerHeight = height - insets.top - insets.bottom;
    if (
      innerWidth < MIN_GROUP_SIZE.width ||
      innerHeight < MIN_GROUP_SIZE.height
    ) {
      return { ok: false, reason: TOO_SMALL_HINT };
    }
  }
  const parentSize = parent
    ? {
        width: parent.width ?? parent.measured?.width ?? 0,
        height: parent.height ?? parent.measured?.height ?? 0,
      }
    : null;

  // Keep it inside the parent, position first: sizing first would make a click near
  // the right or bottom edge jump to the top-left. Generic goes exactly where it was put.
  const unconstrained = style === "generic" || isUnconstrained(parent);
  const fitted =
    !unconstrained && parentSize && parentSize.width && parentSize.height
      ? (() => {
          const innerRight = parentSize.width - insets.right;
          const innerBottom = parentSize.height - insets.bottom;

          if (moving) {
            return {
              position: {
                x: clamp(
                  position.x,
                  insets.left,
                  innerRight - defaultSize.width,
                ),
                y: clamp(
                  position.y,
                  insets.top,
                  innerBottom - defaultSize.height,
                ),
              },
              size: defaultSize,
            };
          }
          // When not even the minimum size fits, move it in that far
          const x = clamp(
            position.x,
            insets.left,
            innerRight - MIN_GROUP_SIZE.width,
          );
          const y = clamp(
            position.y,
            insets.top,
            innerBottom - MIN_GROUP_SIZE.height,
          );

          return {
            position: { x, y },
            size: {
              width: clamp(
                defaultSize.width,
                MIN_GROUP_SIZE.width,
                innerRight - x,
              ),
              height: clamp(
                defaultSize.height,
                MIN_GROUP_SIZE.height,
                innerBottom - y,
              ),
            },
          };
        })()
      : { position, size: defaultSize };

  const finalPosition = fitted.position;
  const size = fitted.size;

  // Moving groups use the caller's overlap check with their actual dimensions.
  if (!options.movingNodeId) {
    const overlap = overlappingSibling(
      nodes,
      "",
      parent?.id,
      { x: finalPosition.x, y: finalPosition.y, ...size },
      { style },
    );
    if (overlap) return { ok: false, reason: SIBLING_OVERLAP_HINT };
  }

  return {
    ok: true,
    value: { parentId: parent?.id, position: finalPosition, size },
  };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));
