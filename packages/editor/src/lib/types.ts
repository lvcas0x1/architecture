import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type {
  EdgeData,
  GroupNodeData,
  ResourceNodeData,
  ShapeNodeData,
  TextNodeData,
} from "@architecture/schema";

/** React Flow data must satisfy Record<string, unknown>. */
type Indexable = Record<string, unknown>;

export type ArchResourceNode = RFNode<ResourceNodeData & Indexable, "resource">;
export type ArchGroupNode = RFNode<GroupNodeData & Indexable, "group">;
export type ArchTextNode = RFNode<TextNodeData & Indexable, "text">;
export type ArchShapeNode = RFNode<ShapeNodeData & Indexable, "shape">;
export type ArchNode =
  | ArchResourceNode
  | ArchGroupNode
  | ArchTextNode
  | ArchShapeNode;

export type ArchEdge = RFEdge<EdgeData & Indexable>;

export const isArchGroupNode = (n: ArchNode): n is ArchGroupNode => n.type === "group";

/** Typed accessors for fields shared across node variants. */
export const iconKeyOf = (node: ArchNode): string | null => {
  if (node.type === "resource") return node.data.iconKey;
  if (node.type === "group") return node.data.iconKey;
  return null;
};

export const resourceRefOf = (node: ArchNode): string | null => {
  if (node.type === "resource" || node.type === "group") return node.data.resourceRef;
  return null;
};
export const isArchResourceNode = (n: ArchNode): n is ArchResourceNode =>
  n.type === "resource";
