import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  useReactFlow,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnectEnd,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { MAX_ZOOM, MIN_ZOOM } from "@architecture/schema";
import { ICON_CENTER_OFFSET, MINIMAP_SIZE } from "../lib/defaults.js";
import { textColorFieldFor } from "../lib/palette.js";
import { canResizeTo, parentExtentFor } from "../lib/constraints.js";
import {
  absolutePosition,
  centerOf,
  type Point,
  type Rect,
} from "../lib/geometry.js";
import { snapDraggedNode, type Guide } from "../lib/snapping.js";
import { resourceRefOf, type ArchEdge, type ArchNode } from "../lib/types.js";
import { useCatalogStore } from "../store/catalog.js";
import { CONNECT_HINT, useEditorStore } from "../store/editor.js";
import { useResourceStore } from "../store/resources.js";
import { IssuePanel } from "./IssuePanel.js";
import { NodeContextMenu, type ContextMenuState } from "./NodeContextMenu.js";
import { NodeActionsProvider } from "./nodes/context.js";
import { nodeTypes } from "./nodes/index.js";
import { DND_MIME } from "./Palette.js";
import { ParameterDialog } from "./ParameterDialog.js";
import { ResourceBindDialog, type BindResult } from "./ResourceBindDialog.js";
import { ZoomSlider } from "./ZoomSlider.js";

/** The representative point used to decide reparenting. */
function representativePointOf(node: ArchNode, nodes: ArchNode[]): Point {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const origin = absolutePosition(node, byId);

  // A resource is judged by the centre of its icon. Border snapping uses the same point.
  if (node.type === "resource") {
    return {
      x: origin.x + ICON_CENTER_OFFSET.x,
      y: origin.y + ICON_CENTER_OFFSET.y,
    };
  }
  // A box is judged near its top-left corner (it keeps nesting stable)
  if (node.type === "group") return { x: origin.x + 8, y: origin.y + 8 };

  const width = node.width ?? node.measured?.width ?? 0;
  const height = node.height ?? node.measured?.height ?? 0;
  return { x: origin.x + width / 2, y: origin.y + height / 2 };
}

export function Canvas() {
  const { screenToFlowPosition, setCenter, getZoom, setViewport } =
    useReactFlow();

  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const tool = useEditorStore((s) => s.tool);
  const alert = useEditorStore((s) => s.alert);
  const store = useEditorStore;

  const issues = useEditorStore((s) => s.issues);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  /** The node whose label or text is being edited in place. */
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [bindTargetId, setBindTargetId] = useState<string | null>(null);
  const [paramArn, setParamArn] = useState<string | null>(null);

  const isDrawing = tool !== "select";
  const isConnecting = tool === "connect";

  const menuNode = useMemo(
    () =>
      contextMenu ? nodes.find((n) => n.id === contextMenu.nodeId) : undefined,
    [contextMenu, nodes],
  );
  const bindTarget = useMemo(
    () => nodes.find((n) => n.id === bindTargetId),
    [bindTargetId, nodes],
  );
  const currentArn =
    bindTarget?.type === "resource"
      ? (bindTarget.data.resourceRef ?? null)
      : null;

  // ---- Resource actions ----------------------------------------------

  const refreshResource = useCallback(async (arn: string) => {
    await useResourceStore.getState().refresh(arn);
  }, []);

  const handleBind = useCallback(
    (result: BindResult) => {
      if (!bindTargetId) return;
      store
        .getState()
        .bindResource(bindTargetId, result.arn, result.suggestedIconKey);
      setBindTargetId(null);
    },
    [bindTargetId, store],
  );

  /** Preserve zoom when centering a node. */
  const focusNode = useCallback(
    (nodeId: string) => {
      const all = store.getState().nodes;
      const target = all.find((node) => node.id === nodeId);
      if (!target) return;

      const point = centerOf(target, new Map(all.map((n) => [n.id, n])));
      setCenter(point.x, point.y, { zoom: getZoom(), duration: 300 });
    },
    [getZoom, setCenter, store],
  );

  /** Whether a referenced ARN is in the diagram at all. */
  const hasNodeFor = useCallback(
    (arn: string) =>
      store.getState().nodes.some((n) => resourceRefOf(n) === arn),
    [store],
  );

  /** Jump to a node from a reference link in the parameter table. */
  const jumpToArn = useCallback(
    (arn: string) => {
      // A box can stand for a VPC and the like, so do not filter by type
      const target = store
        .getState()
        .nodes.find((n) => resourceRefOf(n) === arn);
      if (!target) return;
      setParamArn(null);
      focusNode(target.id);
      store.setState({
        nodes: store
          .getState()
          .nodes.map((n) => ({ ...n, selected: n.id === target.id })),
      });
    },
    [focusNode, store],
  );

  // ---- Canvas actions -------------------------------------------------

  /** Keep the drawing tool active after a failed placement. */
  const placeWithTool = useCallback(
    (event: MouseEvent): boolean => {
      const state = store.getState();
      const point = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      switch (state.tool) {
        case "box":
          // On failure the store puts the reason in the alert.
          // Calling setTool here would clear it, so reset only on success.
          if (state.addGroupNode(point) !== null) state.setTool("select");
          return true;
        case "text":
          state.addTextNode(point);
          state.setTool("select");
          return true;
        case "shape":
          state.addShapeNode(point);
          state.setTool("select");
          return true;
        case "connect":
          // A line cannot be drawn floating on its own
          state.setAlert(CONNECT_HINT);
          return true;
        default:
          return false;
      }
    },
    [screenToFlowPosition, store],
  );

  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      setContextMenu(null);
      setEditingNodeId(null);
      placeWithTool(event);
    },
    [placeWithTool],
  );

  /** Guides shown when something snaps. Only held during a drag. */
  const [guides, setGuides] = useState<Guide[]>([]);
  const applyNodeChanges = useEditorStore((s) => s.onNodesChange);

  // Restore the saved viewport after loading a diagram.
  // React Flow's defaultViewport only applies on the first render, so it is set here.
  const viewport = useEditorStore((s) => s.viewport);
  const loadedAt = useEditorStore((s) => s.loadedAt);
  useEffect(() => {
    if (loadedAt === null) return;
    void setViewport(viewport, { duration: 0 });
    // Once per load. Later panning and zooming are left alone.
  }, [loadedAt, setViewport]);

  /** No snapping while Alt (Option) is held. */
  const altPressed = useRef(false);
  useEffect(() => {
    const track = (event: KeyboardEvent) => {
      altPressed.current = event.altKey;
    };
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
    };
  }, []);

  /** Snap position changes during dragging; Alt disables snapping. */
  const onNodesChange = useCallback(
    (changes: NodeChange<ArchNode>[]) => {
      const change = changes.length === 1 ? changes[0] : undefined;
      const dragging =
        change?.type === "position" &&
        change.dragging === true &&
        change.position;

      if (!dragging || altPressed.current) {
        if (guides.length > 0) setGuides([]);
        applyNodeChanges(changes);
        return;
      }

      const snapped = snapDraggedNode(
        change.id,
        change.position!,
        store.getState().nodes,
      );
      setGuides(snapped.guides);
      applyNodeChanges([{ ...change, position: snapped.position }]);
    },
    [applyNodeChanges, guides.length, store],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(DND_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const iconKey = event.dataTransfer.getData(DND_MIME);
      if (!iconKey) return;
      event.preventDefault();
      // The drop point becomes the centre of the icon.
      // Somewhere it cannot go, the store explains and no node is created.
      const point = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      // The icon's layer (global / region / zone...) decides where it may land
      const scope = useCatalogStore.getState().scopeFor(iconKey);
      // Whether it was placed, and the check afterwards, are the store's job
      store.getState().addResourceNode(iconKey, point, scope);
    },
    [screenToFlowPosition, store],
  );

  const onNodeDragStart: OnNodeDrag<ArchNode> = useCallback(
    (_event, node, dragged) => {
      setContextMenu(null);
      setEditingNodeId(null);
      // A multi-selection can move together. Remember the starting position of
      // everything that moves, not just the one that was grabbed.
      for (const moving of dragged.length > 0 ? dragged : [node]) {
        store.getState().beginNodeDrag(moving.id);
      }
    },
    [store],
  );

  const onNodeDragStop: OnNodeDrag<ArchNode> = useCallback(
    (_event, node, dragged) => {
      setGuides([]);
      // Check every node that moved along, not only the one that was grabbed;
      // otherwise the rest stay somewhere the rules do not allow.
      for (const moved of dragged.length > 0 ? dragged : [node]) {
        const state = store.getState();
        const current = state.nodes.find((n) => n.id === moved.id);
        if (!current) continue;
        const scope =
          current.type === "resource"
            ? useCatalogStore.getState().scopeFor(current.data.iconKey)
            : undefined;
        state.reparentNode(
          moved.id,
          representativePointOf(current, state.nodes),
          {
            commit: false,
            scope,
          },
        );
      }
    },
    [store],
  );

  /** Drawing tools take priority over opening resource details. */
  const onNodeClick: NodeMouseHandler<ArchNode> = useCallback(
    (event, node) => {
      setContextMenu(null);
      if (placeWithTool(event as unknown as MouseEvent)) return;

      if (node.type !== "resource") return;
      const arn = node.data.resourceRef;
      if (arn) setParamArn(arn);
    },
    [placeWithTool],
  );

  const onNodeContextMenu: NodeMouseHandler<ArchNode> = useCallback(
    (event, node) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const state = store.getState();

      if (event.key === "Escape") {
        setContextMenu(null);
        state.setAlert(null);
        state.setTool("select");
        return;
      }
      if (typing) return;

      const directions: Record<string, Point> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const direction = directions[event.key];
      if (
        direction &&
        target?.closest(".react-flow__node, .react-flow__nodesselection-rect")
      ) {
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 20 : 5;
        state.moveSelection({ x: direction.x * step, y: direction.y * step });
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        state.deleteSelected();
        return;
      }

      const shortcuts: Record<string, () => void> = {
        v: () => state.setTool("select"),
        b: () => state.setTool("box"),
        t: () => state.setTool("text"),
        s: () => state.setTool("shape"),
        l: () => state.setTool("connect"),
      };
      shortcuts[event.key.toLowerCase()]?.();
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [store]);

  const hint = useMemo(() => {
    if (tool === "connect") {
      return "Drag a connection point (blue dot) to another icon, box or shape";
    }
    if (tool === "box") return "Click to place a box";
    if (tool === "text") return "Click to place a text label";
    if (tool === "shape") return "Click to place a shape";
    return null;
  }, [tool]);

  /** A line released on nothing. Lines cannot float, so say why straight away. */
  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, connectionState) => {
      if (connectionState.isValid) return;
      store.getState().setAlert(CONNECT_HINT);
    },
    [store],
  );

  // The alert fades on its own after a moment
  useEffect(() => {
    if (!alert) return;
    const timer = window.setTimeout(
      () => store.getState().setAlert(null),
      3600,
    );
    return () => window.clearTimeout(timer);
  }, [alert, store]);

  const nodeActions = useMemo(
    () => ({
      updateNodeData: (id: string, patch: Record<string, unknown>) =>
        store.getState().updateNodeData(id, patch),
      editable: true,
      editingNodeId,
      setEditingNodeId,
      canResize: (id: string, next: Rect) => {
        const all = store.getState().nodes;
        const node = all.find((n) => n.id === id);
        return node ? canResizeTo(all, node, next) : true;
      },
    }),
    [store, editingNodeId],
  );

  /** Recompute parent-relative extents after parent resizing. */
  const dragOrigins = useEditorStore((s) => s.dragOrigins);
  const constrainedNodes = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return nodes.map((node) => {
      // Unrestricted while dragging so it can leave the parent (checked on drop)
      if (!node.parentId || dragOrigins.has(node.id)) return node;
      const extent = parentExtentFor(node, byId.get(node.parentId));
      return extent === node.extent ? node : ({ ...node, extent } as ArchNode);
    });
  }, [nodes, dragOrigins]);

  return (
    <NodeActionsProvider value={nodeActions}>
      <div
        className={clsx(
          "relative flex-1",
          isDrawing && "canvas-drawing",
          // In line mode, show the connection points so it is clear where lines start
          isConnecting && "canvas-connecting",
        )}
      >
        <ReactFlow<ArchNode, ArchEdge>
          nodes={constrainedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={useEditorStore((s) => s.onEdgesChange)}
          onConnect={useEditorStore((s) => s.onConnect)}
          onConnectEnd={onConnectEnd}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onMove={(_e, viewport) => store.getState().setViewport(viewport)}
          onMoveStart={() => setContextMenu(null)}
          connectionMode={ConnectionMode.Loose}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          // Deletion is handled here (deleting a box deletes its contents)
          deleteKeyCode={null}
          multiSelectionKeyCode={["Meta", "Shift"]}
          selectionMode={SelectionMode.Partial}
          panOnDrag={!isDrawing}
          selectionOnDrag={false}
          panOnScroll
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: false }}
          className="bg-canvas"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="#c9cfdb"
          />
          <MiniMap
            pannable
            zoomable
            // Position it with `position`, not CSS. Overriding only left leaves
            // React Flow's right:0 in place and the panel stretches full width.
            position="bottom-left"
            // Without this it is fixed at 200x150. Keep it small, near the diagram's ratio.
            style={{ width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height }}
            // The default of 5 leaves a wide inner margin. Tighten it so the outline shows.
            offsetScale={2}
            maskColor="rgba(29,35,48,.10)"
            className="!m-3 overflow-hidden !rounded-md !border !border-border-subtle !bg-panel/92 shadow-sm"
            nodeColor={(n) => (n.type === "group" ? "#c9cfdb" : "#8b94a7")}
            nodeStrokeWidth={3}
            ariaLabel="Diagram overview"
          />
        </ReactFlow>

        <ZoomSlider />

        {hint && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1 text-[11px] text-white">
            {hint}
          </div>
        )}

        {/* Snap guides. Placed in canvas coordinates so they hold under zoom. */}
        <ViewportPortal>
          {guides.map((guide) => (
            <div
              key={`${guide.axis}-${guide.position}`}
              data-testid="align-guide"
              data-axis={guide.axis}
              className="pointer-events-none absolute bg-accent/70"
              style={
                guide.axis === "x"
                  ? {
                      left: guide.position,
                      top: guide.start,
                      width: 1,
                      height: guide.end - guide.start,
                    }
                  : {
                      left: guide.start,
                      top: guide.position,
                      width: guide.end - guide.start,
                      height: 1,
                    }
              }
            />
          ))}
        </ViewportPortal>

        <IssuePanel
          issues={issues}
          onClose={() => store.getState().clearIssues()}
          onFocus={(nodeIds) => {
            store.getState().selectNodes(nodeIds);
            if (nodeIds[0]) focusNode(nodeIds[0]);
          }}
        />

        {alert && (
          <div
            role="alert"
            className="pointer-events-none absolute top-12 left-1/2 z-30 max-w-[min(30rem,90%)] -translate-x-1/2 rounded-md bg-danger px-3 py-1.5 text-center text-[11px] leading-snug text-white shadow-lg"
          >
            {alert}
          </div>
        )}

        {contextMenu && (
          <NodeContextMenu
            state={contextMenu}
            node={menuNode}
            onClose={() => setContextMenu(null)}
            onConfigure={() => setBindTargetId(contextMenu.nodeId)}
            onRefresh={() => {
              const node = menuNode;
              if (node?.type === "resource" && node.data.resourceRef) {
                void refreshResource(node.data.resourceRef);
              }
            }}
            onShowParameters={() => {
              const node = menuNode;
              if (node?.type === "resource" && node.data.resourceRef) {
                setParamArn(node.data.resourceRef);
              }
            }}
            onUnbind={() => store.getState().unbindResource(contextMenu.nodeId)}
            onRename={() => setEditingNodeId(contextMenu.nodeId)}
            onChangeGroupStyle={(style) =>
              store.getState().changeGroupStyle(contextMenu.nodeId, style)
            }
            onSetTextColor={(color) =>
              store.getState().updateNodeData(contextMenu.nodeId, {
                [textColorFieldFor(menuNode?.type ?? "")]: color,
              })
            }
            onSetFontSize={(size) =>
              store
                .getState()
                .updateNodeData(contextMenu.nodeId, { fontSize: size })
            }
            onSetFillColor={(color) =>
              store
                .getState()
                .updateNodeData(contextMenu.nodeId, { fillColor: color })
            }
            onSetFillOpacity={(opacity) =>
              store
                .getState()
                .updateNodeData(contextMenu.nodeId, { fillOpacity: opacity })
            }
            onDelete={() => store.getState().deleteNodes([contextMenu.nodeId])}
          />
        )}

        <ResourceBindDialog
          open={bindTargetId !== null}
          onOpenChange={(open) => !open && setBindTargetId(null)}
          currentArn={currentArn}
          onBind={handleBind}
        />

        <ParameterDialog
          arn={paramArn}
          open={paramArn !== null}
          onOpenChange={(open) => !open && setParamArn(null)}
          onRefresh={(arn) => void refreshResource(arn)}
          onJump={jumpToArn}
          canJump={hasNodeFor}
        />
      </div>
    </NodeActionsProvider>
  );
}
