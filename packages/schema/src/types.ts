/** Shared helpers for generated schema types. */
import { RULES } from "./rules.js";
import type {
  Diagram,
  Edge,
  GroupNode,
  NormalizedResource,
  ResourceNode,
  ResourceNodeData,
  ShapeNode,
  TextNode,
} from "./generated/models.js";

/** A node in the diagram. Prefixed so it does not collide with the DOM's `Node`. */
export type DiagramNode = ResourceNode | GroupNode | TextNode | ShapeNode;

export type DiagramNodeType = DiagramNode["type"];

/** The lines that can appear under an icon. Elements of ResourceNodeData.showFields. */
export type ResourceField = ResourceNodeData["showFields"][number];

export const isResourceNode = (n: DiagramNode): n is ResourceNode =>
  n.type === "resource";
export const isGroupNode = (n: DiagramNode): n is GroupNode => n.type === "group";
export const isTextNode = (n: DiagramNode): n is TextNode => n.type === "text";
export const isShapeNode = (n: DiagramNode): n is ShapeNode => n.type === "shape";

/** Connectable node types from generated rules. */
export const CONNECTABLE_NODE_TYPES: readonly string[] = RULES.connectableNodeTypes;

export const canConnect = (nodeType: string): boolean =>
  CONNECTABLE_NODE_TYPES.includes(nodeType);

/** Node types that can be a parent (a container). Also from rules.json. */
export const CONTAINER_NODE_TYPES: readonly string[] = RULES.containerNodeTypes;

export const canContain = (nodeType: string): boolean =>
  CONTAINER_NODE_TYPES.includes(nodeType);

export const canConnectNode = (n: DiagramNode): boolean => canConnect(n.type);

/** Store of the resource JSON, keyed by ARN. */
export type ResourceStore = Readonly<Record<string, NormalizedResource>>;

/** Only deleted resources receive the Deleted badge. */
export const isDeleted = (r: NormalizedResource | undefined): boolean =>
  r?.lifecycle === "deleted";

export const isUnavailable = (r: NormalizedResource | undefined): boolean =>
  r === undefined || r.lifecycle !== "active";

/** Every ARN the diagram references (the scope of a refresh or an export). */
export function referencedArns(diagram: Diagram): Set<string> {
  const arns = new Set<string>();
  for (const node of diagram.nodes as DiagramNode[]) {
    const ref = "resourceRef" in node.data ? node.data.resourceRef : null;
    if (ref) arns.add(ref);
  }
  return arns;
}

/** Icon keys the diagram uses (only these are inlined as data URIs on export). */
export function referencedIconKeys(diagram: Diagram): Set<string> {
  const keys = new Set<string>();
  for (const node of diagram.nodes as DiagramNode[]) {
    const key = "iconKey" in node.data ? node.data.iconKey : null;
    if (key) keys.add(key);
  }
  return keys;
}

/** Turn an edge's line style into an SVG stroke-dasharray. */
export function dashArrayFor(line: Edge["data"]["line"], width = 1.5): string | undefined {
  switch (line) {
    case "dashed":
      return `${width * 5} ${width * 3}`;
    case "dotted":
      return `${width} ${width * 2.5}`;
    default:
      return undefined;
  }
}
