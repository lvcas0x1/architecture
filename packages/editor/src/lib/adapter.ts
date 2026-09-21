/** Convert between diagram JSON and React Flow. */
import { MarkerType, type EdgeMarker } from "@xyflow/react";
import type {
  Diagram,
  DiagramMeta,
  DiagramNode,
  Edge as SchemaEdge,
  EdgeData,
  LayoutOptions,
  Viewport,
} from "@architecture/schema";
import { dashArrayFor } from "@architecture/schema";
import {
  DEFAULT_GROUP_SIZE,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_TEXT_SIZE,
  RESOURCE_NODE_WIDTH,
  nodeWithDefaults,
} from "./defaults.js";
import type { ArchEdge, ArchNode } from "./types.js";

const DEFAULT_EDGE_COLOR = "#5b6478";

/** Default node sizes, used when size is not given. */
export function defaultSizeFor(type: ArchNode["type"]): { width: number; height: number } | null {
  switch (type) {
    case "group":
      return DEFAULT_GROUP_SIZE;
    case "shape":
      return DEFAULT_SHAPE_SIZE;
    case "text":
      return DEFAULT_TEXT_SIZE;
    case "resource":
      return { width: RESOURCE_NODE_WIDTH, height: 0 }; // height grows with the label lines
  }
}

/** React Flow requires parents before children. */
export function sortParentsFirst(nodes: DiagramNode[]): DiagramNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sorted: DiagramNode[] = [];
  const placed = new Set<string>();

  const place = (node: DiagramNode, seen: Set<string>): void => {
    if (placed.has(node.id) || seen.has(node.id)) return;
    seen.add(node.id);
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent) place(parent, seen);
    }
    if (!placed.has(node.id)) {
      placed.add(node.id);
      sorted.push(node);
    }
  };

  for (const node of nodes) place(node, new Set());
  return sorted;
}

export function toReactFlowNodes(
  diagram: Diagram,
  options: { readOnly?: boolean } = {},
): ArchNode[] {
  return sortParentsFirst(diagram.nodes).map((node) => {
    const size = node.size ?? defaultSizeFor(node.type);
    const sized = node.type === "group" || node.type === "shape" || node.type === "text";
    // An icon straddling a border is meant to stick out of its parent.
    // Confining it here would hide half of it.
    const onBorder = node.type === "resource" && node.data.mount === "border";

    return {
      id: node.id,
      type: node.type,
      position: node.position ?? { x: 0, y: 0 },
      // Fill in the defaults. The backend (Pydantic) accepts omissions, so the
      // editor has to open the same JSON for the two to agree.
      data: nodeWithDefaults(node).data,
      ...(node.parentId
        ? { parentId: node.parentId, ...(onBorder ? {} : { extent: "parent" as const }) }
        : {}),
      ...(sized && size ? { width: size.width, height: size.height } : {}),
      zIndex: node.zIndex,
      // In read-only mode (the HTML export), per-node settings must not override this
      draggable: options.readOnly ? false : !node.locked,
      selectable: options.readOnly ? true : !node.locked,
      hidden: node.hidden,
    } as ArchNode;
  });
}

/** Turn line style and arrows into React Flow styles and markers. */
export function edgeVisuals(data: EdgeData): {
  style: Record<string, unknown>;
  markerStart?: EdgeMarker;
  markerEnd?: EdgeMarker;
} {
  const color = data.color ?? DEFAULT_EDGE_COLOR;
  const marker: EdgeMarker = {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color,
  };
  return {
    style: {
      stroke: color,
      strokeWidth: data.width,
      strokeDasharray: dashArrayFor(data.line, data.width),
    },
    ...(data.arrow === "start" || data.arrow === "both" ? { markerStart: marker } : {}),
    ...(data.arrow === "end" || data.arrow === "both" ? { markerEnd: marker } : {}),
  };
}

/** Map a router name onto React Flow's built-in edge types. */
export const routerToEdgeType = (router: EdgeData["router"]): string =>
  router === "bezier" ? "default" : router;

export function toReactFlowEdges(diagram: Diagram): ArchEdge[] {
  return diagram.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    type: routerToEdgeType(edge.data.router),
    label: edge.data.label ?? undefined,
    data: edge.data,
    ...edgeVisuals(edge.data),
  })) as ArchEdge[];
}

export interface DocumentState {
  meta: DiagramMeta;
  layout: LayoutOptions;
  viewport: Viewport;
  nodes: ArchNode[];
  edges: ArchEdge[];
}

/** Build the saved diagram file from React Flow's state. */
export function toDiagram(state: DocumentState): Diagram {
  const nodes: DiagramNode[] = state.nodes.map((node) => {
    const width = node.width ?? node.measured?.width;
    const height = node.height ?? node.measured?.height;
    const keepsSize = node.type === "group" || node.type === "shape" || node.type === "text";

    return {
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      size: keepsSize && width && height ? { width, height } : null,
      parentId: node.parentId ?? null,
      zIndex: node.zIndex ?? 0,
      locked: node.draggable === false,
      hidden: node.hidden ?? false,
      data: node.data,
    } as DiagramNode;
  });

  const edges: SchemaEdge[] = state.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    data: edge.data as EdgeData,
  }));

  return {
    schemaVersion: "1.0",
    meta: { ...state.meta, updatedAt: new Date().toISOString() },
    viewport: state.viewport,
    // Saved with coordinates settled, so the mode drops to manual
    layout: { ...state.layout, mode: "manual" },
    nodes,
    edges,
  };
}
