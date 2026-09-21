import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ParameterDialog,
  ZoomSlider,
  absoluteRect,
  centerOf,
  nodeTypes,
  toReactFlowEdges,
  toReactFlowNodes,
  useCatalogStore,
  useResourceStore,
  resourceRefOf,
  type ArchEdge,
  type ArchNode,
} from "@architecture/editor";
import { MAX_ZOOM, MIN_ZOOM, type Viewport } from "@architecture/schema";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { catalogFromBundle, type ExportBundle } from "./bundle.js";

/** Focus nodes using absolute coordinates without changing zoom. */
function useFocusNode(nodes: ArchNode[]) {
  const { setCenter, getZoom } = useReactFlow();
  return useCallback(
    (node: ArchNode) => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const point = centerOf(node, byId);
      setCenter(point.x, point.y, { zoom: getZoom(), duration: 300 });
    },
    [getZoom, nodes, setCenter],
  );
}

function SearchPanel({
  nodes,
  onPick,
}: {
  nodes: ArchNode[];
  onPick: (node: ArchNode) => void;
}) {
  const [query, setQuery] = useState("");
  const resources = useResourceStore((s) => s.byArn);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((node) => {
        if (node.type === "group") {
          return node.data.label.toLowerCase().includes(q);
        }
        if (node.type !== "resource") return false;
        const ref = resourceRefOf(node);
        const resource = ref ? resources[ref] : undefined;
        const haystacks = [
          resource?.name ?? "",
          resource?.resourceId ?? "",
          resource?.service ?? "",
          ref ?? "",
          ...(resource?.tags ?? []).map((t) => `${t.key}:${t.value}`),
        ];
        return haystacks.some((h) => h.toLowerCase().includes(q));
      })
      .slice(0, 30);
  }, [nodes, query, resources]);

  return (
    <div className="absolute top-3 left-3 z-10 w-64">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search resources"
        aria-label="Search resources"
        className="w-full rounded-md border border-[#dfe3ea] bg-white/95 px-2.5 py-1.5 text-xs shadow-sm outline-none backdrop-blur focus:border-[#3f5bd9]"
      />
      {hits.length > 0 && (
        <ul className="mt-1 max-h-72 overflow-y-auto rounded-md border border-[#dfe3ea] bg-white/98 shadow-lg">
          {hits.map((node) => {
            const ref = resourceRefOf(node);
            const resource = ref ? resources[ref] : undefined;
            return (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onPick(node)}
                  className="flex w-full flex-col items-start border-b border-[#dfe3ea]/60 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-[#3f5bd9]/8"
                >
                  <span className="text-xs font-medium text-[#1d2330]">
                    {node.type === "group"
                      ? node.data.label
                      : (resource?.name ??
                        resource?.resourceId ??
                        "Not linked")}
                  </span>
                  {resource && (
                    <span className="font-mono text-[10px] text-[#5b6478]">
                      {resource.service} / {resource.resourceId}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {query.trim() && hits.length === 0 && (
        <p className="mt-1 rounded-md border border-[#dfe3ea] bg-white/98 px-2.5 py-1.5 text-xs text-[#5b6478] shadow-lg">
          No matches.
        </p>
      )}
    </div>
  );
}

/** Fit only when no visible node intersects the saved viewport. */
export function diagramIsVisible(
  nodes: ArchNode[],
  viewport: Viewport,
): boolean {
  const visible = nodes.filter((node) => !node.hidden);
  if (visible.length === 0) return true;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return visible.some((node) => {
    const r = absoluteRect(node, byId);
    return (
      r.x * viewport.zoom + viewport.x < window.innerWidth &&
      (r.x + r.width) * viewport.zoom + viewport.x > 0 &&
      r.y * viewport.zoom + viewport.y < window.innerHeight &&
      (r.y + r.height) * viewport.zoom + viewport.y > 0
    );
  });
}

function Diagram({ bundle }: { bundle: ExportBundle }) {
  const nodes = useMemo(
    () => toReactFlowNodes(bundle.diagram, { readOnly: true }),
    [bundle.diagram],
  );
  const edges = useMemo(
    () => toReactFlowEdges(bundle.diagram),
    [bundle.diagram],
  );
  const [paramArn, setParamArn] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const focusNode = useFocusNode(nodes);

  /** Follow a reference in the parameter table to the node it points at. */
  const jumpToArn = useCallback(
    (arn: string) => {
      const target = nodes.find((node) => resourceRefOf(node) === arn);
      if (!target) return;
      setParamArn(null);
      setHighlighted(target.id);
      focusNode(target);
    },
    [focusNode, nodes],
  );

  const onNodeClick: NodeMouseHandler<ArchNode> = useCallback(
    (_event, node) => {
      if (!bundle.options.interactive) return;
      if (node.type !== "resource") return;
      const arn = node.data.resourceRef;
      if (arn) setParamArn(arn);
    },
    [bundle.options.interactive],
  );

  const displayNodes = useMemo(
    () =>
      highlighted
        ? nodes.map((node) => ({ ...node, selected: node.id === highlighted }))
        : nodes,
    [nodes, highlighted],
  );

  return (
    <>
      <ReactFlow<ArchNode, ArchEdge>
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        connectionMode={ConnectionMode.Loose}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        defaultViewport={bundle.diagram.viewport}
        fitView={!diagramIsVisible(nodes, bundle.diagram.viewport)}
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        // Read-only
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={bundle.options.interactive}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        panOnScroll
        proOptions={{ hideAttribution: false }}
        className="bg-[#f6f7f9]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="#c9cfdb"
        />
      </ReactFlow>

      <ZoomSlider />

      {bundle.options.includeSearch && (
        <SearchPanel
          nodes={nodes}
          onPick={(node) => {
            setHighlighted(node.id);
            focusNode(node);
          }}
        />
      )}

      <ParameterDialog
        arn={paramArn}
        open={paramArn !== null}
        onOpenChange={(open) => !open && setParamArn(null)}
        onJump={jumpToArn}
        canJump={(arn) => nodes.some((node) => resourceRefOf(node) === arn)}
      />
    </>
  );
}

export function App({ bundle }: { bundle: ExportBundle }) {
  // Feed the embedded data into the same stores the editor uses.
  // Sharing the rendering code keeps the look identical to the editor.
  useEffect(() => {
    const icons = catalogFromBundle(bundle.icons);
    useCatalogStore.setState({
      icons,
      byKey: new Map(icons.map((icon) => [icon.key, icon])),
      status: "ready",
      isPlaceholder: false,
      error: null,
    });
    // Masking already happened on the server (ARNs and accountIds arrive masked)
    useResourceStore.setState({
      byArn: bundle.resources,
      refreshing: {},
      lastError: null,
    });
  }, [bundle]);

  const exportedAt = useMemo(() => {
    const date = new Date(bundle.exportedAt);
    return Number.isNaN(date.getTime())
      ? bundle.exportedAt
      : date.toLocaleString("ja-JP");
  }, [bundle.exportedAt]);

  const meta = bundle.diagram.meta;

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#dfe3ea] bg-white px-4 py-2">
        <h1 className="text-sm font-semibold text-[#1d2330]">{meta.title}</h1>
        {meta.description && (
          <p className="text-[11px] text-[#5b6478]">{meta.description}</p>
        )}
        <span
          className={clsx("ml-auto text-[10px] text-[#5b6478]", "print:hidden")}
        >
          Exported: {exportedAt}
          {bundle.options.interactive &&
            " · Click an icon to see its parameters"}
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        <ReactFlowProvider>
          <Diagram bundle={bundle} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
