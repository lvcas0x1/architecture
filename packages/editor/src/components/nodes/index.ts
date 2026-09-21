import type { NodeTypes } from "@xyflow/react";
import { GroupNode } from "./GroupNode.js";
import { ResourceNode } from "./ResourceNode.js";
import { ShapeNode } from "./ShapeNode.js";
import { TextNode } from "./TextNode.js";

export const nodeTypes = {
  resource: ResourceNode,
  group: GroupNode,
  text: TextNode,
  shape: ShapeNode,
} satisfies NodeTypes;
