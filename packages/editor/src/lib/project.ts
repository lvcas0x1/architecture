import type { Diagram, NormalizedResource, Project } from "@architecture/schema";
import { referencedArns } from "@architecture/schema";

type FileHandle = {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
};
type FileWindow = Window & {
  showOpenFilePicker?: () => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileHandle>;
};

export type ProjectFile = { handle?: FileHandle; original?: string };

export function diagramFingerprint(diagram: Diagram): string {
  return JSON.stringify({ ...diagram, meta: { ...diagram.meta, updatedAt: null } });
}

export async function pickProject(): Promise<{ value: unknown; file: ProjectFile } | null> {
  const picker = (window as FileWindow).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker.call(window);
      const original = await (await handle!.getFile()).text();
      return { value: JSON.parse(original), file: { handle, original } };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve({ value: JSON.parse(await file.text()), file: {} }); }
      catch (error) { reject(error); }
    };
    input.click();
  });
}

export function reserveProjectFile(file: ProjectFile, title: string): Promise<ProjectFile> {
  const picker = (window as FileWindow).showSaveFilePicker;
  if (file.handle || !picker) return Promise.resolve(file);
  return picker.call(window, { suggestedName: `${title.replace(/[^a-zA-Z0-9_-]/g, "-")}.architecture.json` })
    .then((handle) => ({ handle }));
}

export async function writeProject(project: Project, file: ProjectFile): Promise<ProjectFile> {
  const text = JSON.stringify(project, null, 2) + "\n";
  if (file.handle) {
    if (file.original !== undefined && await (await file.handle.getFile()).text() !== file.original)
      throw new Error("The file changed outside the editor. Reopen it before saving.");
    const writer = await file.handle.createWritable();
    try {
      await writer.write(text);
      await writer.close();
    } catch (error) {
      await writer.abort?.();
      throw error;
    }
    return { handle: file.handle, original: text };
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.diagram.meta.title.replace(/[^a-zA-Z0-9_-]/g, "-")}.architecture.json`;
  link.click();
  URL.revokeObjectURL(url);
  return file;
}

function leaves(value: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length)
      Object.assign(result, leaves(item as Record<string, unknown>, path));
    else result[path] = item;
  }
  return result;
}

export function humanSave(project: Project, diagram: Diagram): Project {
  const result = structuredClone(project);
  const refs = (doc: Diagram) => new Set(doc.nodes.flatMap((n) =>
    "resourceRef" in n.data && n.data.resourceRef ? [n.data.resourceRef] : []));
  const currentRefs = refs(diagram);
  result.authority.deletedRefs = [...new Set([...result.authority.deletedRefs,
    ...[...refs(project.diagram)].filter((ref) => !currentRefs.has(ref))])]
    .filter((ref) => !currentRefs.has(ref)).sort();
  const connections = (doc: Diagram) => {
    const ids = new Map(doc.nodes.map((n) => [n.id,
      "resourceRef" in n.data && n.data.resourceRef ? n.data.resourceRef : n.id]));
    return new Set(doc.edges.map((e) => `${ids.get(e.source)}|${ids.get(e.target)}`));
  };
  const afterConnections = connections(diagram);
  result.authority.deletedConnections = [...new Set([...result.authority.deletedConnections,
    ...[...connections(project.diagram)].filter((key) => !afterConnections.has(key))])]
    .filter((key) => !afterConnections.has(key)).sort();
  for (const collection of ["nodes", "edges"] as const) {
    const before = new Map(project.diagram[collection].map((n) => [n.id, n] as const));
    const after = new Map(diagram[collection].map((n) => [n.id, n] as const));
    const deleted = collection === "nodes" ? "deletedNodes" : "deletedEdges";
    result.authority[deleted] = [...new Set([...result.authority[deleted],
      ...[...before.keys()].filter((id) => !after.has(id))])].filter((id) => !after.has(id)).sort();
    for (const [id, item] of after) {
      const old = before.get(id);
      const oldLeaves = old ? leaves(old) : {};
      const changes = old ? Object.entries(leaves(item)).filter(([p, v]) =>
        JSON.stringify(v) !== JSON.stringify(oldLeaves[p])).map(([p]) => p) : ["*"];
      if (changes.length) {
        const key = `${collection}:${id}`;
        result.authority.protected[key] = [...new Set([
          ...(result.authority.protected[key] ?? []), ...changes])].sort();
      }
    }
  }
  for (const section of ["meta", "layout", "viewport"] as const) {
    const before = leaves(project.diagram[section]);
    const changes = Object.entries(leaves(diagram[section])).filter(([p, v]) =>
      !(section === "meta" && p === "updatedAt") && JSON.stringify(v) !== JSON.stringify(before[p])).map(([p]) => p);
    if (changes.length) result.authority.protected[section] = [...new Set([
      ...(result.authority.protected[section] ?? []), ...changes])].sort();
  }
  result.diagram = structuredClone(diagram);
  result.revision++;
  return result;
}

export function protectDiagram(diagram: Diagram): Project {
  return {
    format: "architecture-project", version: 1, revision: 0, diagram,
    graph: { format: "architecture-inventory", version: 1, collectedAt: new Date().toISOString(),
      resources: [], relations: [], coverage: [] },
    authority: { baseline: diagram, protected: {}, deletedNodes: [], deletedEdges: [], deletedRefs: [], deletedConnections: [] },
    view: "overview", selectedArns: [],
  };
}

export function attachDetails(project: Project, cache: Record<string, NormalizedResource>): Project {
  const result = structuredClone(project);
  const known = new Set(result.graph.resources.map((r) => r.arn));
  result.graph.resources = result.graph.resources.map((r) => ({ ...r, detail: cache[r.arn] ?? r.detail }));
  for (const arn of referencedArns(result.diagram)) {
    const resource = cache[arn];
    if (!resource || known.has(arn)) continue;
    const evidence = resource.lifecycle === "active" ? [{ source: "describe" as const,
      observedAt: resource.fetchedAt, locator: "Imported resource detail" }] : [];
    const ids = (type: string) => resource.relations.filter((r) => r.type === type)
      .map((r) => r.targetArn.split("/").at(-1)!);
    result.graph.resources.push({ arn, accountId: resource.accountId, region: resource.region,
      resourceType: resource.resourceType, resourceId: resource.resourceId, name: resource.name ?? "",
      iconKey: resource.iconKey, availabilityZones: [], vpcIds: ids("in-vpc"), subnetIds: ids("in-subnet"),
      tags: Object.fromEntries(resource.tags.map((t) => [t.key, t.value])), parameters: {},
      subnetVisibility: "unknown", evidence, detail: resource });
    result.graph.relations.push(...resource.relations.map((r) => ({ sourceArn: arn, targetArn: r.targetArn,
      type: r.type, category: r.type.startsWith("in-") ? "containment" as const : "association" as const,
      evidence })));
  }
  return result;
}

export async function projectRequest<T>(action: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/projects/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Project operation failed: ${await response.text()}`);
  return response.json() as Promise<T>;
}
