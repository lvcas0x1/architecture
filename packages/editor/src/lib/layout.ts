/** Hierarchical layout using ELK. */
import type { LayoutOptions as SchemaLayoutOptions } from "@architecture/schema";
import type {
  ELK as ElkEngine,
  ElkNode,
  LayoutOptions as ElkOptions,
} from "elkjs";
import { resnapBorderChildren } from "./constraints.js";
import {
  DEFAULT_SHAPE_SIZE,
  DEFAULT_TEXT_SIZE,
  RESOURCE_NODE_WIDTH,
} from "./defaults.js";
import type { ArchEdge, ArchNode } from "./types.js";

/** Rough height of an icon plus four label lines. */
export const RESOURCE_NODE_HEIGHT = 118;

/** The box title sits on the top border, so the inset there is larger. */
const GROUP_LABEL_SPACE = 28;

/** Node types the layout moves. Decoration (text / shape) stays put. */
const LAYOUTABLE = new Set<ArchNode["type"]>(["resource", "group"]);

let engine: ElkEngine | null = null;

/** Load the ELK API and worker on demand. */
async function getEngine(): Promise<ElkEngine> {
  if (!engine) {
    const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
      import("elkjs/lib/elk-api.js"),
      import("elkjs/lib/elk-worker.min.js?url"),
    ]);
    engine ??= new ELK({ workerUrl });
  }
  return engine;
}

export function sizeOf(node: ArchNode): { width: number; height: number } {
  const width = node.width ?? node.measured?.width;
  const height = node.height ?? node.measured?.height;
  if (width && height) return { width, height };

  switch (node.type) {
    case "resource":
      return { width: RESOURCE_NODE_WIDTH, height: RESOURCE_NODE_HEIGHT };
    case "shape":
      return DEFAULT_SHAPE_SIZE;
    case "text":
      return DEFAULT_TEXT_SIZE;
    case "group":
      // ELK computes this from the children, so only a lower bound is given
      return { width: 160, height: 120 };
  }
}

function elkOptions(options: SchemaLayoutOptions): ElkOptions {
  return {
    "elk.algorithm": options.algorithm,
    "elk.direction": options.direction,
    "elk.spacing.nodeNode": String(options.nodeSpacing),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(options.layerSpacing),
    // Place edges that cross levels too (a resource inside a VPC to an ALB outside it)
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.padding": `[top=${options.padding + GROUP_LABEL_SPACE},left=${options.padding},bottom=${options.padding},right=${options.padding}]`,
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.edgeRouting": "ORTHOGONAL",
  };
}

/** Build ELK's nested graph from React Flow's flat array. */
export function toElkGraph(
  nodes: ArchNode[],
  edges: ArchEdge[],
  options: SchemaLayoutOptions,
): ElkNode {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  /** Locked nodes do not move; a border icon is tied to its parent's edge. */
  const movable = (node: ArchNode): boolean =>
    LAYOUTABLE.has(node.type) &&
    !node.hidden &&
    node.draggable !== false &&
    !(node.type === "resource" && node.data.mount === "border");

  // Preserve the contents of containers with fixed visible children. ELK sees
  // each such container as an opaque box, so it cannot overlap or clip them.
  const fixedContainers = new Set(
    nodes
      .filter(
        (node) =>
          node.parentId &&
          !node.hidden &&
          !movable(node) &&
          !(node.type === "resource" && node.data.mount === "border"),
      )
      .map((node) => node.parentId!),
  );

  /** Exclude nodes with excluded ancestors to preserve relative coordinates. */
  const included = (node: ArchNode): boolean => {
    const seen = new Set<string>();
    let current: ArchNode | undefined = node;
    while (current && !seen.has(current.id)) {
      if (!movable(current)) return false;
      seen.add(current.id);
      if (current.parentId && fixedContainers.has(current.parentId))
        return false;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  };

  const targets = nodes.filter(included);
  const ids = new Set(targets.map((node) => node.id));

  const elkNodes = new Map<string, ElkNode>();
  for (const node of targets) {
    const { width, height } = sizeOf(node);
    elkNodes.set(node.id, {
      id: node.id,
      width,
      height,
      children: [],
      ...(node.type === "group"
        ? {
            layoutOptions: {
              "elk.padding": elkOptions(options)["elk.padding"]!,
            },
          }
        : {}),
    });
  }

  const roots: ElkNode[] = [];
  for (const node of targets) {
    const elkNode = elkNodes.get(node.id)!;
    const parent = node.parentId ? elkNodes.get(node.parentId) : undefined;
    if (parent) parent.children!.push(elkNode);
    else roots.push(elkNode);
  }

  // Leaving empty children in makes ELK size the node to zero
  for (const elkNode of elkNodes.values()) {
    if (elkNode.children?.length === 0) delete elkNode.children;
  }

  const elkEdges = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));

  return {
    id: "root",
    layoutOptions: elkOptions(options),
    children: roots,
    edges: elkEdges,
  };
}

/** Pull "node id -> parent-relative position" out of ELK's result. */
export function collectPositions(
  graph: ElkNode,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const walk = (node: ElkNode): void => {
    for (const child of node.children ?? []) {
      positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
      walk(child);
    }
  };
  walk(graph);
  return positions;
}

/** Pull the box sizes ELK computed. */
export function collectSizes(
  graph: ElkNode,
): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>();

  const walk = (node: ElkNode): void => {
    for (const child of node.children ?? []) {
      if (child.width && child.height) {
        sizes.set(child.id, { width: child.width, height: child.height });
      }
      walk(child);
    }
  };
  walk(graph);
  return sizes;
}

export interface LayoutResult {
  nodes: ArchNode[];
  /** How many nodes the layout covered. 0 means nothing moved. */
  laidOut: number;
}

/** Apply layout coordinates while preserving fixed nodes. */
export async function autoLayout(
  nodes: ArchNode[],
  edges: ArchEdge[],
  options: SchemaLayoutOptions,
): Promise<LayoutResult> {
  const graph = toElkGraph(nodes, edges, options);
  if ((graph.children?.length ?? 0) === 0) return { nodes, laidOut: 0 };

  const laidOutGraph = await (await getEngine()).layout(graph);
  const positions = collectPositions(laidOutGraph);
  const sizes = collectSizes(laidOutGraph);

  const resized = new Set<string>();
  const next = nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position) return node;

    const size = node.type === "group" ? sizes.get(node.id) : undefined;
    if (size) resized.add(node.id);
    return {
      ...node,
      position,
      ...(size ? { width: size.width, height: size.height } : {}),
    } as ArchNode;
  });

  // ELK resizes boxes, which leaves border icons off the new edge.
  return {
    nodes: resnapBorderChildren(next, resized),
    laidOut: positions.size,
  };
}
