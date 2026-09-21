/** Saving and loading diagram files (local, in the browser). */
import type { Diagram, Project } from "@architecture/schema";
import { parseDiagramInput, parseProjectInput } from "@architecture/schema";
import { pickProject, type ProjectFile } from "./project.js";

const EXTENSION = ".arch.json";

/** Build a safe file name from the title. */
export function fileNameFor(title: string): string {
  const base =
    title
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "diagram";
  return `${base}${EXTENSION}`;
}

export function serializeDiagram(diagram: Diagram): string {
  return `${JSON.stringify(diagram, null, 2)}\n`;
}

export function downloadDiagram(diagram: Diagram): void {
  const blob = new Blob([serializeDiagram(diagram)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFor(diagram.meta.title);
  link.click();
  URL.revokeObjectURL(url);
}

export class DiagramParseError extends Error {}

export interface LoadedDiagram {
  diagram: Diagram;
  /** What was fixed automatically on load. Told to the user when there is anything. */
  notes: string[];
  project?: Project;
  file?: ProjectFile;
}

/** Remove legacy anchors and their edges. */
export function migrateLegacyDiagram(doc: Diagram): LoadedDiagram {
  const notes: string[] = [];
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];

  const anchorIds = new Set(
    nodes
      .filter((node) => (node as { type: string }).type === "anchor")
      .map((n) => n.id),
  );

  const keptNodes = nodes.filter((node) => !anchorIds.has(node.id));
  const keptEdges = edges.filter(
    (edge) =>
      !anchorIds.has(edge.source) &&
      !anchorIds.has(edge.target) &&
      (edge.data as { kind?: string } | undefined)?.kind !== "decoration",
  );

  const droppedEdges = edges.length - keptEdges.length;
  if (droppedEdges > 0) {
    notes.push(
      `Removed ${droppedEdges} line(s) that were not connected to anything ` +
        "(lines now always join icons, boxes or shapes)",
    );
  }

  // Drop the retired data.kind so such files still load
  for (const edge of keptEdges) {
    if (edge.data && "kind" in edge.data) {
      delete (edge.data as { kind?: string }).kind;
    }
  }

  return { diagram: { ...doc, nodes: keptNodes, edges: keptEdges }, notes };
}

/** Apply generated input validation and Pydantic defaults. */
export function normalizeDiagram(doc: Diagram): Diagram {
  return parseDiagramInput(doc);
}

/** Ids have to be unique, and nothing in the editor can rename one. */
function assertUniqueIds(doc: Diagram): void {
  const duplicate = (ids: string[]): string[] => {
    const seen = new Set<string>();
    return [...new Set(ids.filter((id) => seen.size === seen.add(id).size))];
  };
  const nodes = duplicate(doc.nodes.map((n) => n.id));
  const edges = duplicate(doc.edges.map((e) => e.id));
  if (nodes.length > 0)
    throw new DiagramParseError(`Duplicate node id: ${nodes.join(", ")}`);
  if (edges.length > 0)
    throw new DiagramParseError(`Duplicate line id: ${edges.join(", ")}`);
}

/** Parse, migrate, and validate diagram input. */
export function parseDiagram(text: string): LoadedDiagram {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new DiagramParseError(
      `Could not read the file as JSON: ${err instanceof Error ? err.message : err}`,
    );
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DiagramParseError("Not a JSON object.");
  }
  const doc = raw as Partial<Diagram>;
  if (doc.schemaVersion !== undefined && doc.schemaVersion !== "1.0") {
    throw new DiagramParseError(
      `Unsupported schemaVersion: ${String(doc.schemaVersion)} (supported: 1.0)`,
    );
  }
  if (
    (doc.nodes !== undefined && !Array.isArray(doc.nodes)) ||
    (doc.edges !== undefined && !Array.isArray(doc.edges))
  ) {
    throw new DiagramParseError("nodes / edges are not arrays.");
  }
  // Migrate retired fields before applying the current structural schema.
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];
  if (
    nodes.some((node) => !node || typeof node !== "object") ||
    edges.some((edge) => !edge || typeof edge !== "object")
  ) {
    throw new DiagramParseError("Every node and edge must be an object.");
  }
  assertUniqueIds({ ...doc, nodes, edges } as Diagram);
  const loaded = migrateLegacyDiagram({ ...doc, nodes, edges } as Diagram);
  try {
    loaded.diagram = normalizeDiagram(loaded.diagram);
    assertUniqueIds(loaded.diagram);
  } catch (err) {
    throw new DiagramParseError(
      err instanceof Error ? err.message : String(err),
    );
  }

  // Auto layout will place them; in manual mode the origin is all there is.
  const missing = loaded.diagram.nodes.filter((node) => !node.position).length;
  if (missing > 0 && loaded.diagram.layout.mode === "manual") {
    loaded.notes.push(
      `${missing} node(s) had no position and start at the origin. Run Auto layout.`,
    );
  }
  return loaded;
}

/** Open a file dialog and load a diagram. null when cancelled. */
export async function pickDiagramFile(): Promise<LoadedDiagram | null> {
  const loaded = await pickProject();
  if (!loaded) return null;
  if ((loaded.value as { format?: string })?.format === "architecture-project") {
    const project = parseProjectInput(loaded.value);
    const parsed = parseDiagram(JSON.stringify(project.diagram));
    project.diagram = parsed.diagram;
    return { ...parsed, project, file: loaded.file };
  }
  return { ...parseDiagram(JSON.stringify(loaded.value)), file: loaded.file };
}
