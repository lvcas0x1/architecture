/* eslint-disable */
/**
 * This file is generated. Do not edit it by hand.
 * Source: backend/app/models/*.py
 * Regenerate: npm run gen
 */

export type LayoutMode = "manual" | "auto";
/**
 * How a resource icon sits in its container.
 */
export type ResourceMount = "inside" | "border";
export type BorderSide = "top" | "right" | "bottom" | "left";
/**
 * Element authorship.
 */
export type Origin = "ai" | "user";
/**
 * Box presets. Border colour, corner label and pale fill follow the AWS diagram conventions.
 */
export type GroupStyle =
  | "global"
  | "on-premises"
  | "account"
  | "region"
  | "vpc"
  | "az"
  | "subnet-public"
  | "subnet-private"
  | "security-group"
  | "auto-scaling-group"
  | "generic";
/**
 * Element authorship.
 */

export type TextAlign = "left" | "center" | "right";
/**
 * Element authorship.
 */

export type ShapeKind = "rect" | "rounded" | "ellipse" | "diamond";
/**
 * Element authorship.
 */

export type LineStyle = "solid" | "dashed" | "dotted";
export type ArrowStyle = "none" | "start" | "end" | "both";
export type EdgeRouter = "straight" | "smoothstep" | "step" | "bezier";
/**
 * Element authorship.
 */

/**
 * Whether the resource still exists. Updated by ``Refresh``.
 */
export type Lifecycle = "active" | "deleted" | "error" | "unknown";
export type RowKind = "text" | "code" | "badge" | "link" | "list";
export type BadgeTone = "ok" | "warn" | "error" | "muted";
/**
 * Whether the resource still exists. Updated by ``Refresh``.
 */

/**
 * Official AWS icon families.
 */
export type IconGroup = "Architecture" | "Resource" | "Category" | "Group";
/**
 * The layer an AWS resource belongs to.
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[A-Za-z0-9][A-Za-z0-9\-]*(/[A-Za-z0-9][A-Za-z0-9\-\.]*)+$".
 */
export type ResourceScope = "global" | "region" | "vpc" | "zone" | "subnet" | "any";

/**
 * Share model definitions for TypeScript and input-schema generation.
 */
export type _AllModels = {
  diagram: Diagram;
  resource: NormalizedResource;
  inventory: Inventory;
  icon_catalog: IconCatalog;
  icon_scopes: IconScopes;
  export_bundle: ExportBundle;
  project: Project;
  resource_graph: ResourceGraph;
};
/**
 * Root of ``workspace/diagrams/*.arch.json``.
 */
export type Diagram = {
  schemaVersion: "1.0";
  meta: DiagramMeta;
  viewport: Viewport;
  layout: LayoutOptions;
  nodes: (ResourceNode | GroupNode | TextNode | ShapeNode)[];
  edges: Edge[];
};
export type DiagramMeta = {
  title: string;
  description: string | null;
  generator: "user" | "ai" | "mixed";
  createdAt: string | null;
  updatedAt: string | null;
  accountIds: string[];
  regions: string[];
};
export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};
export type LayoutOptions = {
  mode: LayoutMode;
  algorithm: "layered" | "mrtree" | "force" | "rectpacking";
  direction: "RIGHT" | "DOWN" | "LEFT" | "UP";
  nodeSpacing: number;
  layerSpacing: number;
  padding: number;
};
export type ResourceNode = {
  id: string;
  position: Position | null;
  size: Size | null;
  parentId: string | null;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  type: "resource";
  data: ResourceNodeData;
};
export type Position = {
  x: number;
  y: number;
};
export type Size = {
  width: number;
  height: number;
};
/**
 * An AWS resource icon.
 */
export type ResourceNodeData = {
  iconKey: string;
  resourceRef: string | null;
  labelOverride: string | null;
  showFields: ("service" | "name" | "resourceId" | "tags")[];
  maxTags: number;
  mount: ResourceMount;
  borderSide: BorderSide | null;
  origin: Origin;
};
export type GroupNode = {
  id: string;
  position: Position | null;
  size: Size | null;
  parentId: string | null;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  type: "group";
  data: GroupNodeData;
};
/**
 * A box (VPC / AZ / subnet / any frame).
 */
export type GroupNodeData = {
  label: string;
  labelColor: string | null;
  fillColor: string | null;
  fillOpacity: number | null;
  style: GroupStyle;
  resourceRef: string | null;
  iconKey: string | null;
  collapsed: boolean;
  origin: Origin;
};
export type TextNode = {
  id: string;
  position: Position | null;
  size: Size | null;
  parentId: string | null;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  type: "text";
  data: TextNodeData;
};
/**
 * A free-floating text box.
 */
export type TextNodeData = {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string | null;
  align: TextAlign;
  origin: Origin;
};
export type ShapeNode = {
  id: string;
  position: Position | null;
  size: Size | null;
  parentId: string | null;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
  type: "shape";
  data: ShapeNodeData;
};
/**
 * A decorative shape (rectangle, square, ellipse, diamond).
 */
export type ShapeNodeData = {
  shape: ShapeKind;
  fillColor: string | null;
  fillOpacity: number | null;
  stroke: string | null;
  origin: Origin;
};
export type Edge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  data: EdgeData;
};
export type EdgeData = {
  line: LineStyle;
  arrow: ArrowStyle;
  router: EdgeRouter;
  label: string | null;
  color: string | null;
  width: number;
  relationType: string | null;
  origin: Origin;
};
/**
 * One normalized resource (``workspace/inventory/resources/*.json``).
 */
export type NormalizedResource = {
  schemaVersion: "1.0";
  /**
   * Resource ARN (the key a diagram references)
   */
  arn: string;
  accountId: string;
  accountAlias: string | null;
  region: string;
  resourceType: string;
  resourceId: string;
  service: string;
  name: string | null;
  tags: Tag[];
  iconKey: string;
  lifecycle: Lifecycle;
  fetchedAt: string;
  deletedAt: string | null;
  lastError: string | null;
  sections: Section[];
  relations: Relation[];
  raw: {
    [k: string]: unknown;
  } | null;
};
/**
 * An AWS resource tag.
 */
export type Tag = {
  key: string;
  value: string;
};
/**
 * A category in the parameter popup. Array order is display order.
 */
export type Section = {
  title: string;
  rows: Row[];
  collapsed: boolean;
};
/**
 * One row in the parameter popup's table.
 */
export type Row = {
  label: string;
  value: string | string[] | null;
  kind: RowKind;
  tone: BadgeTone | null;
  href: string | null;
  ref: string | null;
};
/**
 * A relationship to another resource. The material an AI uses to draw edges.
 */
export type Relation = {
  type: string;
  /**
   * Resource ARN (the key a diagram references)
   */
  targetArn: string;
  label: string | null;
};
/**
 * The whole inventory index file.
 */
export type Inventory = {
  schemaVersion: "1.0";
  generatedAt: string;
  source: "resource-explorer" | "config-aggregator" | "describe" | "mixed";
  entries: InventoryEntry[];
};
/**
 * One entry in ``workspace/inventory/index.json``.
 */
export type InventoryEntry = {
  /**
   * Resource ARN (the key a diagram references)
   */
  arn: string;
  accountId: string;
  accountAlias: string | null;
  region: string;
  resourceType: string;
  resourceId: string;
  service: string;
  name: string | null;
  tags: Tag[];
  iconKey: string;
  lifecycle: Lifecycle;
  fetchedAt: string | null;
  hasDetail: boolean;
};
/**
 * ``packages/editor/public/icons.json``.
 */
export type IconCatalog = {
  schemaVersion: "1.0";
  generatedAt: string;
  packageRelease: string | null;
  icons: IconEntry[];
};
/**
 * One icon in the left palette.
 */
export type IconEntry = {
  key: string;
  group: IconGroup;
  category: string;
  label: string;
  path: string;
  aliases: string[];
  resourceTypes: string[];
};
/**
 * Attributes (placement layers) for icons, in ``workspace/icon-scopes.json``.
 */
export type IconScopes = {
  schemaVersion: "1.0";
  updatedAt: string | null;
  scopes: {
    [k: string]: ResourceScope;
  };
};
/**
 * What goes into the ``<script type="application/json">`` inside the HTML.
 */
export type ExportBundle = {
  schemaVersion: "1.0";
  exportedAt: string;
  options: ExportOptions;
  diagram: Diagram;
  resources: {
    [k: string]: NormalizedResource;
  };
  icons: {
    [k: string]: string;
  };
};
export type ExportOptions = {
  includeRaw: boolean;
  interactive: boolean;
  includeSearch: boolean;
  maskAccountIds: boolean;
};
export type Project = {
  format: "architecture-project";
  version: 1;
  revision: number;
  graph: ResourceGraph;
  diagram: Diagram;
  authority: HumanAuthority;
  view: "overview" | "network" | "application" | "security";
  selectedArns: string[];
};
export type ResourceGraph = {
  format: "architecture-inventory";
  version: 1;
  collectedAt: string;
  resources: GraphResource[];
  relations: GraphRelation[];
  coverage: Coverage[];
};
export type GraphResource = {
  /**
   * Resource ARN (the key a diagram references)
   */
  arn: string;
  accountId: string;
  region: string;
  resourceType: string;
  resourceId: string;
  name: string;
  iconKey: string;
  availabilityZones: string[];
  vpcIds: string[];
  subnetIds: string[];
  tags: {
    [k: string]: string;
  };
  parameters: {
    [k: string]: unknown;
  };
  subnetVisibility: "public" | "private" | "unknown";
  evidence: Evidence[];
  detail: NormalizedResource | null;
};
export type Evidence = {
  source: "config" | "resource-explorer" | "describe" | "human" | "inferred";
  observedAt: string;
  locator: string;
};
export type GraphRelation = {
  /**
   * Resource ARN (the key a diagram references)
   */
  sourceArn: string;
  /**
   * Resource ARN (the key a diagram references)
   */
  targetArn: string;
  type: string;
  category: "containment" | "association" | "permission" | "traffic" | "inferred";
  evidence: Evidence[];
};
export type Coverage = {
  source: string;
  profile: string;
  accountId: string;
  region: string;
  status: "complete" | "partial" | "error" | "unsupported";
  message: string;
  count: number;
};
export type HumanAuthority = {
  baseline: Diagram;
  protected: {
    [k: string]: string[];
  };
  deletedNodes: string[];
  deletedEdges: string[];
  deletedRefs: string[];
  deletedConnections: string[];
};
