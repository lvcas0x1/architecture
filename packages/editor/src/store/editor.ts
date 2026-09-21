/** Commit one snapshot per user action, including multi-node drags and layout. */
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  canConnect,
  canNestGroup,
  canPlaceResource,
  explainNesting,
  explainScope,
  groupStyleLabel,
  type ResourceScope,
} from "@architecture/schema";
import type {
  Diagram,
  DiagramMeta,
  EdgeData,
  GroupNodeData,
  LayoutOptions,
  Viewport,
} from "@architecture/schema";
import { create } from "zustand";
import {
  edgeVisuals,
  routerToEdgeType,
  toDiagram,
  toReactFlowEdges,
  toReactFlowNodes,
} from "../lib/adapter.js";
import {
  ICON_CENTER_OFFSET,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_TEXT_SIZE,
  defaultEdgeData,
  defaultGroupData,
  defaultLayout,
  defaultMeta,
  defaultResourceData,
  defaultShapeData,
  defaultTextData,
  defaultViewport,
} from "../lib/defaults.js";
import {
  absolutePosition,
  isDescendantOf,
  type Point,
  withDescendants,
} from "../lib/geometry.js";
import {
  resolveGroupPlacement,
  resolveResourcePlacement,
} from "../lib/placement.js";
import {
  canResizeTo,
  minimumSizeForChildren,
  relativeRect,
  overlappingSibling,
  resnapBorderChildren,
  SIBLING_OVERLAP_HINT,
} from "../lib/constraints.js";
import { ID_PREFIX, newId } from "../lib/ids.js";
import { autoLayout } from "../lib/layout.js";
import { validateGraph, type Issue } from "../lib/validate.js";
import { useCatalogStore } from "./catalog.js";
import type { ArchEdge, ArchNode } from "../lib/types.js";

export type Tool = "select" | "box" | "text" | "shape" | "connect";

export const TOOL_LABELS: Record<Tool, string> = {
  select: "Select",
  box: "Box",
  text: "Text",
  shape: "Shape",
  connect: "Line",
};

interface Snapshot {
  layout: LayoutOptions;
  nodes: ArchNode[];
  edges: ArchEdge[];
}

const HISTORY_LIMIT = 100;
let layoutRequest = 0;

/** Check sibling overlap using absolute drag coordinates. */
function overlappingSiblingAfterMove(
  nodes: ArchNode[],
  node: ArchNode,
  nextParentId: string | undefined,
  styleOverride?: string,
): ArchNode | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const origin = absolutePosition(node, byId);
  const parent = nextParentId ? byId.get(nextParentId) : undefined;
  const parentOrigin = parent ? absolutePosition(parent, byId) : { x: 0, y: 0 };

  const rect = {
    x: origin.x - parentOrigin.x,
    y: origin.y - parentOrigin.y,
    width: node.width ?? node.measured?.width ?? 0,
    height: node.height ?? node.measured?.height ?? 0,
  };
  return overlappingSibling(nodes, node.id, nextParentId, rect, {
    // Pass the style so pairs allowed to overlap (VPC and AZ) are excluded
    style:
      styleOverride ?? (node.type === "group" ? node.data.style : undefined),
  });
}

/** Message when the diagram changed while the layout was being computed. */
export const LAYOUT_STALE_HINT =
  "The diagram changed while it was being arranged. Nothing was moved — try again.";

/** Message when a line would start and end on the same node. */
export const SELF_LOOP_HINT = "A line cannot start and end on the same node.";

export const CONNECT_HINT =
  "A line cannot be drawn here. Lines connect the connection points of icons, boxes and shapes.";

export interface DragOrigin {
  position: Point;
  parentId: string | undefined;
}

export interface EditorState {
  // --- Document ---
  meta: DiagramMeta;
  layout: LayoutOptions;
  viewport: Viewport;
  nodes: ArchNode[];
  edges: ArchEdge[];
  dirty: boolean;

  // --- UI ---
  tool: Tool;
  /** Style for new lines. Can also be applied to the selected edge. */
  edgeStyle: Pick<EdgeData, "line" | "arrow" | "router">;
  /** Preset for a new box. */
  groupStyle: GroupNodeData["style"];
  /** Transient message saying an action is not possible. */
  alert: string | null;
  /** Track each dragged node's origin for invalid-drop rollback. */
  dragOrigins: Map<string, DragOrigin>;
  /** Whether auto layout is running. */
  layoutRunning: boolean;
  /** Check results. Shown right after loading an AI draft, and so on. */
  issues: Issue[];

  // --- History ---
  past: Snapshot[];
  future: Snapshot[];

  // --- Actions ---
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setTool: (tool: Tool) => void;
  setEdgeStyle: (patch: Partial<EditorState["edgeStyle"]>) => void;
  setGroupStyle: (style: GroupNodeData["style"]) => void;
  setViewport: (viewport: Viewport) => void;
  setTitle: (title: string) => void;

  onNodesChange: (changes: NodeChange<ArchNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<ArchEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  /** Takes the point the icon's centre should land on. Returns null and explains when it cannot go there. */
  addResourceNode: (
    iconKey: string,
    iconCenter: Point,
    scope?: ResourceScope,
  ) => string | null;
  addGroupNode: (point: Point) => string | null;
  addTextNode: (point: Point) => string;
  addShapeNode: (point: Point) => string;
  setAlert: (message: string | null) => void;

  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  /** "Configure": link a resource JSON to the node. */
  bindResource: (nodeId: string, arn: string, iconKey?: string | null) => void;
  /** Change a box's style. Refused when the nesting rules do not allow it. */
  changeGroupStyle: (nodeId: string, style: GroupNodeData["style"]) => void;
  /** Unlink the resource. The icon stays. */
  unbindResource: (nodeId: string) => void;
  updateEdgeData: (id: string, patch: Partial<EdgeData>) => void;
  reparentNode: (
    nodeId: string,
    point: Point,
    options?: { commit?: boolean; scope?: ResourceScope },
  ) => void;
  /** Start dragging a node. Pushes history and lifts extent so it can leave the box. */
  beginNodeDrag: (nodeId: string) => void;
  moveSelection: (delta: Point) => void;
  deleteNodes: (ids: string[]) => void;
  deleteEdges: (ids: string[]) => void;
  deleteSelected: () => void;

  replaceGraph: (nodes: ArchNode[], edges: ArchEdge[]) => void;
  /** Re-run ELK to decide coordinates. One step on the history. */
  applyAutoLayout: () => Promise<number>;
  setLayoutOptions: (patch: Partial<LayoutOptions>) => void;
  /** Run validation and return the error count. */
  revalidate: () => number;
  /** Whether a resize is in progress. Keeps the history to one operation. */
  resizing: boolean;
  /** How many times a diagram has been loaded. The canvas uses it to restore the viewport. */
  loadedAt: number | null;
  /** Check the diagram and update issues. Returns the error count. */
  runValidation: (
    iconKeys: { key: string }[],
    scopeOf?: (iconKey: string) => ResourceScope,
    catalogSettled?: boolean,
  ) => number;
  clearIssues: () => void;
  /** Select only these nodes (for jumping from a check result). */
  selectNodes: (nodeIds: string[]) => void;
  loadDiagram: (diagram: Diagram, options?: { title?: string }) => void;
  newDiagram: () => void;
  toDiagram: () => Diagram;
}

/** Build a React Flow edge from the edge data. */
function buildEdge(
  id: string,
  source: string,
  target: string,
  data: EdgeData,
  handles: { sourceHandle?: string | null; targetHandle?: string | null } = {},
): ArchEdge {
  return {
    id,
    source,
    target,
    ...(handles.sourceHandle ? { sourceHandle: handles.sourceHandle } : {}),
    ...(handles.targetHandle ? { targetHandle: handles.targetHandle } : {}),
    type: routerToEdgeType(data.router),
    label: data.label ?? undefined,
    data,
    ...edgeVisuals(data),
  } as ArchEdge;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  meta: defaultMeta(),
  layout: defaultLayout(),
  viewport: defaultViewport(),
  nodes: [],
  edges: [],
  dirty: false,

  tool: "select",
  edgeStyle: { line: "solid", arrow: "end", router: "smoothstep" },
  groupStyle: "generic",
  alert: null,
  dragOrigins: new Map(),
  layoutRunning: false,
  resizing: false,
  loadedAt: null,
  issues: [],

  past: [],
  future: [],

  commit: () => {
    const { nodes, edges, layout, past } = get();
    set({
      past: [...past, { nodes, edges, layout }].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  },

  undo: () => {
    const { past, future, nodes, edges, layout } = get();
    const previous = past.at(-1);
    if (!previous) return;
    set({
      nodes: previous.nodes,
      edges: previous.edges,
      // Auto layout drops mode from auto to manual, so that is restored too
      layout: previous.layout,
      past: past.slice(0, -1),
      future: [{ nodes, edges, layout }, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, nodes, edges, layout } = get();
    const next = future[0];
    if (!next) return;
    set({
      nodes: next.nodes,
      edges: next.edges,
      layout: next.layout,
      past: [...past, { nodes, edges, layout }].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      dirty: true,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  setTool: (tool) => set({ tool, alert: null }),
  setEdgeStyle: (patch) => set({ edgeStyle: { ...get().edgeStyle, ...patch } }),
  setGroupStyle: (groupStyle) => set({ groupStyle }),
  setViewport: (viewport) => set({ viewport }),
  setTitle: (title) => set({ meta: { ...get().meta, title }, dirty: true }),

  onNodesChange: (changes) => {
    // Resizing pushes history once, at the start. Pushing per frame would need
    // as many undos as frames dragged. resizing false means it settled.
    const startedResize = changes.some(
      (change) => change.type === "dimensions" && change.resizing === true,
    );
    const finishedResize = changes.some(
      (change) => change.type === "dimensions" && change.resizing === false,
    );
    if (startedResize && !get().resizing) {
      get().commit();
      set({ resizing: true });
    }
    if (finishedResize && get().resizing) {
      set({ resizing: false, dirty: true });
    }

    set({ nodes: applyNodeChanges<ArchNode>(changes, get().nodes) });

    // Resizing a container leaves an icon that straddles its border behind.
    // Stick it back onto the edge.
    if (startedResize || finishedResize) {
      const resized = new Set(
        changes
          .filter((change) => change.type === "dimensions")
          .map((change) => (change as { id: string }).id),
      );
      set({ nodes: resnapBorderChildren(get().nodes, resized) });
    }
  },

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges<ArchEdge>(changes, get().edges) }),

  onConnect: (connection) => {
    const { nodes, edgeStyle } = get();
    const source = nodes.find((n) => n.id === connection.source);
    const target = nodes.find((n) => n.id === connection.target);
    if (!source || !target) return;

    // A line always joins connection points. Handles only appear on connectable
    // nodes, but check here as well, defensively.
    if (!canConnect(source.type) || !canConnect(target.type)) {
      set({ alert: CONNECT_HINT });
      return;
    }

    // No line to itself. It means nothing in a diagram, and saving rejects it.
    if (connection.source === connection.target) {
      set({ alert: SELF_LOOP_HINT });
      return;
    }

    get().commit();
    const data: EdgeData = { ...defaultEdgeData(), ...edgeStyle };
    set({
      edges: addEdge(
        buildEdge(newId(ID_PREFIX.edge), source.id, target.id, data, {
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
        }),
        get().edges,
      ),
    });
  },

  addResourceNode: (iconKey, iconCenter, scope) => {
    const { nodes } = get();
    const result = resolveResourcePlacement(nodes, iconCenter, { scope });
    if (!result.ok) {
      set({ alert: result.reason });
      return null;
    }
    const placement = result.value;

    get().commit();
    const id = newId(ID_PREFIX.resource);
    const node = {
      id,
      type: "resource",
      position: placement.position,
      parentId: placement.parentId,
      // Straddling a border means it is not confined inside the parent
      ...(placement.mount === "inside" ? { extent: "parent" as const } : {}),
      data: {
        ...defaultResourceData(iconKey),
        mount: placement.mount,
        borderSide: placement.borderSide,
      },
      zIndex: placement.mount === "border" ? 3 : 1,
      selected: true,
    } as ArchNode;

    set({
      nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), node],
      dirty: true,
    });
    // Check as soon as it is placed (report an unlinked or misplaced icon right away)
    get().revalidate();
    return id;
  },

  addGroupNode: (point) => {
    const { nodes, groupStyle } = get();
    const result = resolveGroupPlacement(nodes, point, groupStyle);
    if (!result.ok) {
      set({ alert: result.reason });
      return null;
    }

    get().commit();
    const id = newId(ID_PREFIX.group);
    const node = {
      id,
      type: "group",
      position: result.value.position,
      width: result.value.size.width,
      height: result.value.size.height,
      data: defaultGroupData(groupStyle),
      ...(result.value.parentId
        ? { parentId: result.value.parentId, extent: "parent" as const }
        : {}),
      // Boxes go behind. In front, the icons inside could not be grabbed.
      zIndex: 0,
      selected: true,
    } as ArchNode;

    set({
      nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), node],
      dirty: true,
    });
    return id;
  },

  addTextNode: (point) => {
    get().commit();
    const { nodes } = get();
    const id = newId(ID_PREFIX.text);
    const node = {
      id,
      type: "text",
      position: point,
      width: DEFAULT_TEXT_SIZE.width,
      height: DEFAULT_TEXT_SIZE.height,
      data: defaultTextData(),
      zIndex: 2,
      selected: true,
    } as ArchNode;
    set({
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), node],
      dirty: true,
    });
    return id;
  },

  addShapeNode: (point) => {
    get().commit();
    const { nodes } = get();
    const id = newId(ID_PREFIX.shape);
    const node = {
      id,
      type: "shape",
      position: point,
      width: DEFAULT_SHAPE_SIZE.width,
      height: DEFAULT_SHAPE_SIZE.height,
      data: defaultShapeData(),
      zIndex: 1,
      selected: true,
    } as ArchNode;
    set({
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), node],
      dirty: true,
    });
    return id;
  },

  setAlert: (message) => set({ alert: message }),

  updateNodeData: (id, patch) => {
    get().commit();
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as ArchNode) : n,
      ),
      dirty: true,
    });
  },

  bindResource: (nodeId, arn, iconKey) => {
    get().commit();
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId || node.type !== "resource") return node;
        return {
          ...node,
          data: {
            ...node.data,
            resourceRef: arn,
            // Swap in the icon found from the resource type, if there is one
            ...(iconKey ? { iconKey } : {}),
          },
        } as ArchNode;
      }),
      dirty: true,
    });
  },

  changeGroupStyle: (nodeId, style) => {
    const { nodes } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "group") return;

    const parent = node.parentId
      ? nodes.find((n) => n.id === node.parentId)
      : undefined;
    const parentStyle = parent?.type === "group" ? parent.data.style : null;
    // Inside a shape there is no constraint
    if (parent?.type !== "shape" && !canNestGroup(style, parentStyle)) {
      set({ alert: explainNesting(style as never, parentStyle) });
      return;
    }

    // Check the contents too. Looking only at the parent leaves child boxes and
    // icons stranded somewhere they cannot be.
    for (const child of nodes) {
      if (child.parentId !== nodeId) continue;
      if (child.type === "group" && !canNestGroup(child.data.style, style)) {
        set({ alert: explainNesting(child.data.style as never, style) });
        return;
      }
      if (child.type === "resource") {
        const scope = useCatalogStore.getState().scopeFor(child.data.iconKey);
        if (!canPlaceResource(scope, style)) {
          set({ alert: explainScope(scope, style) });
          return;
        }
      }
    }

    // A generic box may overlap its siblings; a constrained one may not, so the
    // overlap has to be checked again against the style being applied.
    if (overlappingSiblingAfterMove(nodes, node, node.parentId, style)) {
      set({ alert: SIBLING_OVERLAP_HINT });
      return;
    }

    const changed = { ...node, data: { ...node.data, style } } as ArchNode;
    const proposed = nodes.map((n) => (n.id === nodeId ? changed : n));
    const minimum = minimumSizeForChildren(proposed, changed);
    const rect = relativeRect(changed);
    if (
      !canResizeTo(proposed, changed, rect) ||
      rect.width < minimum.width ||
      rect.height < minimum.height ||
      proposed.some(
        (child) =>
          child.parentId === nodeId &&
          !canResizeTo(proposed, child, relativeRect(child)),
      )
    ) {
      set({
        alert:
          "The box and its contents must fit with the required spacing before changing style.",
      });
      return;
    }

    // When the title is still the style's default, swap in the new style's name.
    // A name the user typed is kept.
    const keepsDefaultLabel =
      node.data.label === groupStyleLabel(node.data.style);
    get().updateNodeData(nodeId, {
      style,
      ...(keepsDefaultLabel ? { label: groupStyleLabel(style) } : {}),
    });
  },

  unbindResource: (nodeId) => {
    get().commit();
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId && node.type === "resource"
          ? ({ ...node, data: { ...node.data, resourceRef: null } } as ArchNode)
          : node,
      ),
      dirty: true,
    });
  },

  updateEdgeData: (id, patch) => {
    get().commit();
    set({
      edges: get().edges.map((edge) => {
        if (edge.id !== id) return edge;
        const data = { ...(edge.data as EdgeData), ...patch };
        return buildEdge(edge.id, edge.source, edge.target, data, {
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        });
      }),
      dirty: true,
    });
  },

  moveSelection: (delta) => {
    const { nodes } = get();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const selected = nodes.filter(
      (node) => node.selected && node.draggable !== false && !node.hidden,
    );
    const roots = selected.filter(
      (node) =>
        !selected.some(
          (other) =>
            other.id !== node.id && isDescendantOf(node.id, other.id, byId),
        ),
    );
    if (!roots.length) return;
    for (const node of roots) get().beginNodeDrag(node.id);
    const ids = new Set(roots.map((node) => node.id));
    set({
      nodes: get().nodes.map((node) =>
        ids.has(node.id)
          ? ({
              ...node,
              position: {
                x: node.position.x + delta.x,
                y: node.position.y + delta.y,
              },
            } as ArchNode)
          : node,
      ),
    });
    for (const original of roots) {
      const current = get().nodes;
      const node = current.find((n) => n.id === original.id)!;
      const origin = absolutePosition(
        node,
        new Map(current.map((n) => [n.id, n])),
      );
      const offset =
        node.type === "resource" ? ICON_CENTER_OFFSET : { x: 8, y: 8 };
      get().reparentNode(
        node.id,
        { x: origin.x + offset.x, y: origin.y + offset.y },
        {
          commit: false,
          scope:
            node.type === "resource"
              ? useCatalogStore.getState().scopeFor(node.data.iconKey)
              : undefined,
        },
      );
    }
  },

  beginNodeDrag: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // One history entry per drag, however many nodes move in it
    const origins = new Map(get().dragOrigins);
    if (origins.size === 0) get().commit();
    origins.set(nodeId, { position: node.position, parentId: node.parentId });
    set({
      dragOrigins: origins,
      nodes: get().nodes.map((n) =>
        // With extent:'parent' still on, the node could not be dragged out of the
        // box. It is lifted for the drag and the parent is reassigned on drop.
        n.id === nodeId ? ({ ...n, extent: undefined } as ArchNode) : n,
      ),
    });
  },

  reparentNode: (nodeId, point, options) => {
    const { nodes, dragOrigins } = get();
    const dragStart = dragOrigins.get(nodeId);
    const forgetOrigin = (): Map<string, DragOrigin> => {
      const next = new Map(dragOrigins);
      next.delete(nodeId);
      return next;
    };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const node = byId.get(nodeId);
    if (!node) return;

    // A node cannot be its own parent, nor a descendant's
    const exclude = new Set(
      nodes.filter((n) => isDescendantOf(n.id, nodeId, byId)).map((n) => n.id),
    );
    exclude.add(nodeId);

    if (node.type === "resource") {
      const result = resolveResourcePlacement(nodes, point, {
        exclude,
        scope: options?.scope,
      });
      if (!result.ok) {
        // Illegal spot: put it back where the drag started and say why
        set({
          alert: result.reason,
          dragOrigins: forgetOrigin(),
          nodes: nodes.map((n) =>
            n.id === nodeId && dragStart
              ? ({
                  ...n,
                  position: dragStart.position,
                  parentId: dragStart.parentId,
                  ...(dragStart.parentId ? { extent: "parent" as const } : {}),
                } as ArchNode)
              : n,
          ),
        });
        return;
      }

      const placement = result.value;
      if (options?.commit !== false) get().commit();
      set({
        dragOrigins: forgetOrigin(),
        nodes: nodes.map((n) =>
          n.id === nodeId
            ? ({
                ...n,
                position: placement.position,
                parentId: placement.parentId,
                extent:
                  placement.mount === "inside"
                    ? ("parent" as const)
                    : undefined,
                zIndex: placement.mount === "border" ? 3 : 1,
                data: {
                  ...n.data,
                  mount: placement.mount,
                  borderSide: placement.borderSide,
                },
              } as ArchNode)
            : n,
        ),
        dirty: true,
      });
      // Crossing into another box changes what is allowed, so check again.
      // Moving within the same box changes nothing.
      if (placement.parentId !== node.parentId) get().revalidate();
      return;
    }

    if (node.type === "group") {
      const result = resolveGroupPlacement(nodes, point, node.data.style, {
        exclude,
        movingNodeId: nodeId,
        defaultSize: relativeRect(node),
        currentParentId: node.parentId,
      });
      const placed = result.ok
        ? ({
            ...node,
            parentId: result.value.parentId,
            position: result.value.position,
          } as ArchNode)
        : node;
      const overlap =
        result.ok && !canResizeTo(nodes, placed, relativeRect(placed));

      if (!result.ok || overlap) {
        set({
          alert: result.ok ? SIBLING_OVERLAP_HINT : result.reason,
          dragOrigins: forgetOrigin(),
          nodes: nodes.map((n) =>
            n.id === nodeId && dragStart
              ? ({
                  ...n,
                  position: dragStart.position,
                  parentId: dragStart.parentId,
                  ...(dragStart.parentId ? { extent: "parent" as const } : {}),
                } as ArchNode)
              : n,
          ),
        });
        return;
      }

      // Preserve the resolved parent across crossing VPC/AZ bands.
      const nextParentId = result.value.parentId;
      if (options?.commit !== false) get().commit();
      set({
        dragOrigins: forgetOrigin(),
        nodes: nodes.map((n) =>
          n.id === nodeId
            ? ({
                ...n,
                position: result.value.position,
                ...(nextParentId
                  ? { parentId: nextParentId, extent: "parent" as const }
                  : { parentId: undefined, extent: undefined }),
              } as ArchNode)
            : n,
        ),
        dirty: true,
      });
      return;
    }

    // Text and shapes are free-floating with no container, so nothing to reassign.
    set({ dragOrigins: forgetOrigin() });
  },

  deleteNodes: (ids) => {
    if (ids.length === 0) return;
    get().commit();
    const { nodes, edges } = get();
    const doomed = withDescendants(ids, nodes);

    set({
      nodes: nodes.filter((n) => !doomed.has(n.id)),
      edges: edges.filter(
        (e) => !doomed.has(e.source) && !doomed.has(e.target),
      ),
      dirty: true,
    });
  },

  deleteEdges: (ids) => {
    if (ids.length === 0) return;
    get().commit();
    set({ edges: get().edges.filter((e) => !ids.includes(e.id)), dirty: true });
  },

  deleteSelected: () => {
    const { nodes, edges } = get();
    const doomed = withDescendants(
      nodes.filter((n) => n.selected).map((n) => n.id),
      nodes,
    );
    if (!doomed.size && !edges.some((e) => e.selected)) return;
    get().commit();
    set({
      nodes: nodes.filter((n) => !doomed.has(n.id)),
      edges: edges.filter(
        (e) => !e.selected && !doomed.has(e.source) && !doomed.has(e.target),
      ),
      dirty: true,
    });
  },

  replaceGraph: (nodes, edges) => {
    get().commit();
    set({ nodes, edges, dirty: true });
  },

  setLayoutOptions: (patch) =>
    set({ layout: { ...get().layout, ...patch }, dirty: true }),

  revalidate: () => {
    const catalog = useCatalogStore.getState();
    const settled = catalog.status === "ready" || catalog.status === "error";
    return get().runValidation(catalog.icons, catalog.scopeFor, settled);
  },

  runValidation: (iconKeys, scopeOf, catalogSettled = true) => {
    const { nodes, edges } = get();
    const report = validateGraph(
      nodes,
      edges,
      iconKeys as never,
      scopeOf,
      catalogSettled,
    );
    set({ issues: report.issues });
    return report.issues.filter((issue) => issue.level === "error").length;
  },

  clearIssues: () => set({ issues: [] }),

  selectNodes: (nodeIds) => {
    const wanted = new Set(nodeIds);
    set({
      nodes: get().nodes.map((node) => ({
        ...node,
        selected: wanted.has(node.id),
      })),
    });
  },

  applyAutoLayout: async () => {
    const { nodes, edges, layout } = get();
    if (nodes.length === 0) return 0;

    if (get().layoutRunning) return 0;
    const request = ++layoutRequest;
    const signature = () => {
      const doc = get().toDiagram();
      return JSON.stringify([
        get().loadedAt,
        doc.nodes,
        doc.edges,
        get().layout,
      ]);
    };
    const before = signature();
    set({ layoutRunning: true });
    try {
      const result = await autoLayout(nodes, edges, layout);
      if (request !== layoutRequest) return 0;
      if (result.laidOut === 0) return 0;

      // The diagram changed while computing, so do not apply stale coordinates
      // (a new diagram, a load or an edit can all cause this).
      if (signature() !== before) {
        set({ alert: LAYOUT_STALE_HINT });
        return 0;
      }

      // One history entry. The ELK run counts as a single operation.
      get().commit();
      const current = new Map(get().nodes.map((node) => [node.id, node]));
      set({
        nodes: result.nodes.map(
          (node) =>
            ({
              ...node,
              selected: current.get(node.id)?.selected,
              measured: current.get(node.id)?.measured,
            }) as ArchNode,
        ),
        // Coordinates are settled, so the mode drops to manual
        layout: { ...get().layout, mode: "manual" },
        dirty: true,
      });
      // The layout changes parents and overlaps, so check again
      get().revalidate();
      return result.laidOut;
    } finally {
      if (request === layoutRequest) set({ layoutRunning: false });
    }
  },

  loadDiagram: (diagram, options) => {
    layoutRequest++;
    set({
      meta: options?.title
        ? { ...diagram.meta, title: options.title }
        : diagram.meta,
      layout: diagram.layout,
      viewport: diagram.viewport,
      nodes: toReactFlowNodes(diagram),
      edges: toReactFlowEdges(diagram),
      past: [],
      future: [],
      dirty: false,
      alert: null,
      dragOrigins: new Map(),
      layoutRunning: false,
      issues: [],
      loadedAt: Math.max(Date.now(), (get().loadedAt ?? 0) + 1),
    });
  },

  newDiagram: () => {
    layoutRequest++;
    set({
      meta: defaultMeta(),
      layout: defaultLayout(),
      viewport: defaultViewport(),
      nodes: [],
      edges: [],
      past: [],
      future: [],
      dirty: false,
      alert: null,
      issues: [],
      loadedAt: Math.max(Date.now(), (get().loadedAt ?? 0) + 1),
      dragOrigins: new Map(),
      resizing: false,
      layoutRunning: false,
      tool: "select",
    });
  },

  toDiagram: () => {
    const { meta, layout, viewport, nodes, edges } = get();
    return toDiagram({ meta, layout, viewport, nodes, edges });
  },
}));

/** For tests: put the store back to its initial state. */
export const resetEditorStore = (): void => {
  useEditorStore.getState().newDiagram();
};

export { absolutePosition };
