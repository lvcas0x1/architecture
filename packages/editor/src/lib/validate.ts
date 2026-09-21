/** Local diagram checks; inventory ARN checks require the backend. */
import {
  canConnect,
  canContain,
  canNestGroup,
  canPlaceResource,
  explainNesting,
  explainScope,
  resourceScopeLabel,
  type IconEntry,
  type ResourceScope,
} from "@architecture/schema";
import { iconKeyOf, resourceRefOf, type ArchEdge, type ArchNode } from "./types.js";

export type IssueLevel = "error" | "warning";

export interface Issue {
  level: IssueLevel;
  message: string;
  /** The nodes in question. Clicking jumps to them. */
  nodeIds: string[];
}

export interface ValidationReport {
  ok: boolean;
  issues: Issue[];
}

export function validateGraph(
  nodes: ArchNode[],
  edges: ArchEdge[],
  icons: IconEntry[],
  /** Omit to skip icon-scope checks. */
  scopeOf?: (iconKey: string) => ResourceScope,
  /** Suppress missing-catalog warnings while loading. */
  catalogSettled = true,
): ValidationReport {
  const issues: Issue[] = [];
  const knownIconKeys = new Set(icons.map((icon) => icon.key));

  // --- Structural checks (the same ones the backend's Diagram validator makes) ---
  issues.push(...structuralIssues(nodes, edges));
  const scopeFor = (key: string): ResourceScope => scopeOf?.(key) ?? "any";

  // Icons that are not in the catalog (an AI wrote a key that does not exist).
  // Say so when there is no catalog, rather than passing silently.
  const catalogLoaded = knownIconKeys.size > 0;
  if (!catalogLoaded) {
    if (catalogSettled) {
      issues.push({
        level: "warning",
        message: "Icon catalog not loaded, so icon keys were not checked",
        nodeIds: [],
      });
    }
  } else {
    const unknown = new Map<string, string[]>();
    for (const node of nodes) {
      const key = iconKeyOf(node);
      if (key && !knownIconKeys.has(key)) {
        unknown.set(key, [...(unknown.get(key) ?? []), node.id]);
      }
    }
    for (const [key, nodeIds] of unknown) {
      issues.push({
        level: "error",
        message: `Icon is not in the catalog: ${key}`,
        nodeIds,
      });
    }
  }

  // Resources sitting where the attribute does not allow.
  // Changing an icon's attribute later brings the already-placed ones here.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const misplaced = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.type !== "resource") continue;
    const key = iconKeyOf(node);
    if (!key || (catalogLoaded && !knownIconKeys.has(key))) continue;

    const scope = scopeFor(key);
    if (scope === "any") continue;

    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    // With a non-box parent (inside a shape, or on the canvas) there is no layer to check.
    // The bare canvas is caught below by "no connections and no parent".
    if (parent?.type !== "group") continue;
    if (canPlaceResource(scope, parent.data.style)) continue;

    const reason = `${resourceScopeLabel(scope)}: ${explainScope(scope, parent.data.style)}`;
    misplaced.set(reason, [...(misplaced.get(reason) ?? []), node.id]);
  }
  for (const [reason, nodeIds] of misplaced) {
    issues.push({ level: "error", message: reason, nodeIds });
  }

  // No resource JSON linked
  const unlinked = nodes
    .filter((node) => node.type === "resource" && node.data.resourceRef === null)
    .map((node) => node.id);
  if (unlinked.length > 0) {
    issues.push({
      level: "warning",
      message: `${unlinked.length} icon(s) have no resource JSON linked`,
      nodeIds: unlinked,
    });
  }

  // Connected to nothing. Sitting outside a box is an error, reported separately.
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const isolated = nodes
    .filter((node) => node.type === "resource" && !connected.has(node.id))
    .map((node) => node.id);
  if (isolated.length > 0) {
    issues.push({
      level: "warning",
      message: `${isolated.length} icon(s) have no connections`,
      nodeIds: isolated,
    });
  }

  // Several nodes pointing at the same resource
  const byRef = new Map<string, string[]>();
  for (const node of nodes) {
    const ref = resourceRefOf(node);
    if (ref) byRef.set(ref, [...(byRef.get(ref) ?? []), node.id]);
  }
  for (const [ref, nodeIds] of byRef) {
    if (nodeIds.length > 1) {
      issues.push({
        level: "warning",
        message: `${nodeIds.length} icons point at the same resource: ${ref}`,
        nodeIds,
      });
    }
  }

  // Empty boxes (an AI created one and forgot to fill it)
  const hasChildren = new Set(
    nodes.map((node) => node.parentId).filter((id): id is string => Boolean(id)),
  );
  const emptyGroups = nodes
    .filter((node) => node.type === "group" && !hasChildren.has(node.id))
    .map((node) => node.id);
  if (emptyGroups.length > 0) {
    issues.push({
      level: "warning",
      message: `${emptyGroups.length} box(es) are empty`,
      nodeIds: emptyGroups,
    });
  }

  return { ok: !issues.some((issue) => issue.level === "error"), issues };
}

/** Count the elements an AI created. Used in the notice right after loading a draft. */
export function countAiOrigin(nodes: ArchNode[], edges: ArchEdge[]): number {
  const nodeCount = nodes.filter((node) => node.data.origin === "ai").length;
  const edgeCount = edges.filter((edge) => edge.data?.origin === "ai").length;
  return nodeCount + edgeCount;
}

/** Structural checks matching the Pydantic Diagram validator. */
function structuralIssues(nodes: ArchNode[], edges: ArchEdge[]): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map<string, ArchNode>();
  const duplicated: string[] = [];
  for (const node of nodes) {
    if (byId.has(node.id)) duplicated.push(node.id);
    else byId.set(node.id, node);
  }
  if (duplicated.length > 0) {
    issues.push({
      level: "error",
      message: `Duplicate node id: ${[...new Set(duplicated)].join(", ")}`,
      nodeIds: duplicated,
    });
  }

  // No parent / not a container / against the nesting rules
  const orphans: string[] = [];
  const badParents: string[] = [];
  const boxInShape: string[] = [];
  const rootResources: string[] = [];
  const badMount: string[] = [];
  const badNesting = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.type === "resource") {
      const onBorder = node.data.mount === "border";
      if (onBorder !== (node.data.borderSide != null)) badMount.push(node.id);
    }
    if (!node.parentId) {
      if (node.type === "resource") rootResources.push(node.id);
      if (node.type === "group" && !canNestGroup(node.data.style, null)) {
        const reason = explainNesting(node.data.style as never, null);
        badNesting.set(reason, [...(badNesting.get(reason) ?? []), node.id]);
      }
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      orphans.push(node.id);
      continue;
    }
    if (!canContain(parent.type)) {
      badParents.push(node.id);
      continue;
    }
    if (node.type === "group" && parent.type !== "group") {
      boxInShape.push(node.id);
      continue;
    }
    if (node.type === "group" && parent.type === "group") {
      if (!canNestGroup(node.data.style, parent.data.style)) {
        const reason = explainNesting(node.data.style as never, parent.data.style);
        badNesting.set(reason, [...(badNesting.get(reason) ?? []), node.id]);
      }
    }
  }
  if (rootResources.length > 0) {
    issues.push({
      level: "error",
      message: `${rootResources.length} icon(s) sit on the canvas instead of inside a box or a shape`,
      nodeIds: rootResources,
    });
  }
  if (boxInShape.length > 0) {
    issues.push({
      level: "error",
      message: `${boxInShape.length} box(es) sit inside something that is not a box`,
      nodeIds: boxInShape,
    });
  }
  if (badMount.length > 0) {
    issues.push({
      level: "error",
      message: `${badMount.length} icon(s) have a mount that does not match borderSide`,
      nodeIds: badMount,
    });
  }
  if (orphans.length > 0) {
    issues.push({
      level: "error",
      message: `${orphans.length} node(s) point at a parent that does not exist`,
      nodeIds: orphans,
    });
  }
  if (badParents.length > 0) {
    issues.push({
      level: "error",
      message: `${badParents.length} node(s) sit inside something that cannot be a parent`,
      nodeIds: badParents,
    });
  }
  for (const [reason, nodeIds] of badNesting) {
    issues.push({ level: "error", message: reason, nodeIds });
  }

  // A loop in the parent chain (following parents leads back to the node)
  const cycles = new Set<string>();
  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let current = node.parentId ? byId.get(node.parentId) : undefined;
    while (current) {
      if (seen.has(current.id)) {
        cycles.add(node.id);
        break;
      }
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  if (cycles.size > 0) {
    issues.push({
      level: "error",
      message: `${cycles.size} node(s) form a loop in their parent chain`,
      nodeIds: [...cycles],
    });
  }

  // Line endpoints
  const dangling: string[] = [];
  const badEndpoint: string[] = [];
  const selfLoops: string[] = [];
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      dangling.push(edge.id);
      continue;
    }
    if (edge.source === edge.target) selfLoops.push(edge.id);
    if (!canConnect(source.type) || !canConnect(target.type)) badEndpoint.push(edge.id);
  }
  if (dangling.length > 0) {
    issues.push({
      level: "error",
      message: `${dangling.length} line(s) point at a node that does not exist`,
      nodeIds: [],
    });
  }
  if (badEndpoint.length > 0) {
    issues.push({
      level: "error",
      message: `${badEndpoint.length} line(s) end on something that cannot be connected`,
      nodeIds: [],
    });
  }
  if (selfLoops.length > 0) {
    issues.push({
      level: "error",
      message: `${selfLoops.length} line(s) start and end on the same node`,
      nodeIds: [],
    });
  }

  return issues;
}
