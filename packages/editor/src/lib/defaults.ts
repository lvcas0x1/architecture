import type {
  DiagramMeta,
  DiagramNode,
  EdgeData,
  GroupNodeData,
  LayoutOptions,
  ResourceNodeData,
  ShapeNodeData,
  TextNodeData,
  Viewport,
} from "@architecture/schema";
import { groupStyleLabel } from "@architecture/schema";
import { DEFAULT_FONT_SIZE } from "./palette.js";

/** Fill in what a file left out, so an AI draft opens like a hand-saved one. */
export function nodeWithDefaults(node: DiagramNode): DiagramNode {
  const data = (node.data ?? {}) as Record<string, unknown>;
  switch (node.type) {
    case "resource":
      return {
        ...node,
        data: { ...defaultResourceData(String(data.iconKey ?? "")), ...data },
      } as DiagramNode;
    case "group":
      return {
        ...node,
        data: {
          ...defaultGroupData(data.style as GroupNodeData["style"]),
          label: "",
          ...data,
        },
      } as DiagramNode;
    case "text":
      return {
        ...node,
        data: { ...defaultTextData(), text: "", ...data },
      } as DiagramNode;
    case "shape":
      return {
        ...node,
        data: { ...defaultShapeData(), ...data },
      } as DiagramNode;
    default:
      return node;
  }
}

/** Document defaults matching Pydantic. */
export const defaultMeta = (): DiagramMeta => ({
  title: "Untitled architecture",
  description: null,
  generator: "user",
  createdAt: new Date().toISOString(),
  updatedAt: null,
  accountIds: [],
  regions: [],
});

export const defaultLayout = (): LayoutOptions => ({
  mode: "manual",
  algorithm: "layered",
  direction: "RIGHT",
  nodeSpacing: 48,
  layerSpacing: 96,
  padding: 32,
});

export const defaultViewport = (): Viewport => ({ x: 0, y: 0, zoom: 1 });

/** Rendered size of a resource icon (the label lines grow below, so height is excluded). */
export const ICON_SIZE = 64;
/** Width of the node that holds the icon and its labels. */
export const RESOURCE_NODE_WIDTH = 132;

/** Size of the overview shown in the bottom-left. */
export const MINIMAP_SIZE = { width: 168, height: 112 };

export const DEFAULT_GROUP_SIZE = { width: 360, height: 260 };
/** A box never gets smaller than this (matches the NodeResizer's lower bound). */
export const MIN_GROUP_SIZE = { width: 120, height: 80 };
export const DEFAULT_SHAPE_SIZE = { width: 160, height: 96 };
export const DEFAULT_TEXT_SIZE = { width: 200, height: 40 };

export const defaultResourceData = (iconKey: string): ResourceNodeData => ({
  iconKey,
  resourceRef: null,
  labelOverride: null,
  showFields: ["service", "name", "resourceId", "tags"],
  maxTags: 3,
  mount: "inside",
  borderSide: null,
  origin: "user",
});

/** Icon-center offset used for border placement. */
export const ICON_CENTER_OFFSET = {
  x: RESOURCE_NODE_WIDTH / 2,
  y: ICON_SIZE / 2,
} as const;

/** Snap distance to a shape's border (further away it goes inside). */
export const BORDER_SNAP_BAND = 18;

/** A new box. The title starts as the style's name (AWS Cloud, VPC and so on). */
export const defaultGroupData = (
  style: GroupNodeData["style"] = "generic",
): GroupNodeData => ({
  label: groupStyleLabel(style),
  // null uses the preset's colour and opacity (purple for a VPC, and so on)
  labelColor: null,
  fillColor: null,
  fillOpacity: null,
  style,
  resourceRef: null,
  iconKey: null,
  collapsed: false,
  origin: "user",
});

export const defaultTextData = (): TextNodeData => ({
  text: "Text",
  fontSize: DEFAULT_FONT_SIZE,
  bold: false,
  italic: false,
  color: null,
  align: "left",
  origin: "user",
});

export const defaultShapeData = (): ShapeNodeData => ({
  shape: "rect",
  fillColor: null,
  fillOpacity: null,
  stroke: null,
  origin: "user",
});

export const defaultEdgeData = (): EdgeData => ({
  line: "solid",
  arrow: "end",
  router: "smoothstep",
  label: null,
  color: null,
  width: 1.5,
  relationType: null,
  origin: "user",
});

export interface FillPreset {
  stroke: string;
  /** Base fill colour, used when the user has not picked one. */
  fillBase: string;
  /** Default fill opacity, used when the user has not picked one. */
  fillOpacity: number;
  dashed?: boolean;
}

/** Group presets ordered by nesting depth. */
export const GROUP_STYLES: Record<GroupNodeData["style"], FillPreset> = {
  global: {
    stroke: "#232f3e",
    fillBase: "#232f3e",
    fillOpacity: 0.03,
  },
  "on-premises": {
    stroke: "#6b7280",
    fillBase: "#6b7280",
    fillOpacity: 0.05,
    dashed: true,
  },
  account: { stroke: "#c0504d", fillBase: "#c0504d", fillOpacity: 0.04 },
  region: {
    stroke: "#2f8f8f",
    fillBase: "#2f8f8f",
    fillOpacity: 0.04,
    dashed: true,
  },
  vpc: { stroke: "#7a52c7", fillBase: "#7a52c7", fillOpacity: 0.05 },
  az: {
    stroke: "#4f6bed",
    fillBase: "#4f6bed",
    fillOpacity: 0.04,
    dashed: true,
  },
  "subnet-public": {
    stroke: "#3d8f5a",
    fillBase: "#3d8f5a",
    fillOpacity: 0.07,
  },
  "subnet-private": {
    stroke: "#2f6f9f",
    fillBase: "#2f6f9f",
    fillOpacity: 0.07,
  },
  "security-group": {
    stroke: "#c0504d",
    fillBase: "#c0504d",
    fillOpacity: 0.03,
    dashed: true,
  },
  "auto-scaling-group": {
    stroke: "#d86613",
    fillBase: "#d86613",
    fillOpacity: 0.04,
    dashed: true,
  },
  generic: { stroke: "#8b94a7", fillBase: "#8b94a7", fillOpacity: 0.05 },
};

/** Order shown in the picker (outermost layer first). */
export const GROUP_STYLE_ORDER: GroupNodeData["style"][] = [
  "global",
  "account",
  "region",
  "vpc",
  "az",
  "subnet-public",
  "subnet-private",
  "security-group",
  "auto-scaling-group",
  "on-premises",
  "generic",
];

/** Shapes share the generic group's colors and opacity. */
export const SHAPE_PRESET: FillPreset = GROUP_STYLES.generic;

/** Corner radius. The same value for boxes and shapes. */
export const CORNER_RADIUS_CLASS = "rounded-md";
