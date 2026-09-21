import { describe, expect, it, vi } from "vitest";
import { parseDiagram } from "./file.js";
import { diagramFingerprint, humanSave, protectDiagram, writeProject, type ProjectFile } from "./project.js";

describe("human authority", () => {
  const diagram = () => parseDiagram(JSON.stringify({ nodes: [
    { id: "box", type: "group", data: { style: "generic", label: "Original" } },
  ] })).diagram;

  it("protects only changed fields and retains protection on later saves", () => {
    const original = diagram();
    const changed = structuredClone(original);
    if (changed.nodes[0]?.type === "group") changed.nodes[0].data.label = "Human";
    const saved = humanSave(protectDiagram(original), changed);
    expect(saved.authority.protected["nodes:box"]).toEqual(["data.label"]);
    expect(humanSave(saved, changed).authority.protected).toEqual(saved.authority.protected);
  });

  it("records deletions and explicit human restoration", () => {
    const original = diagram();
    const saved = humanSave(protectDiagram(original), { ...original, nodes: [] });
    expect(saved.authority.deletedNodes).toEqual(["box"]);
    const restored = humanSave(saved, original);
    expect(restored.authority.deletedNodes).toEqual([]);
    expect(restored.authority.protected["nodes:box"]).toEqual(["*"]);
  });

  it("ignores automatic save timestamps when detecting human changes", () => {
    const original = diagram();
    const later = { ...original, meta: { ...original.meta, updatedAt: "2026-09-21T12:00:00Z" } };
    expect(diagramFingerprint(original)).toBe(diagramFingerprint(later));
    expect(humanSave(protectDiagram(original), later).authority.protected).toEqual({});
  });

  it("overwrites the opened file and retains authority in that same file", async () => {
    let content = "original";
    const project = humanSave(protectDiagram(diagram()), { ...diagram(), nodes: [] });
    const write = vi.fn(async (text: string) => { content = text; });
    const close = vi.fn(async () => {});
    const file: ProjectFile = { original: content, handle: {
      getFile: async () => ({ text: async () => content }) as File,
      createWritable: async () => ({ write, close }),
    } };
    const saved = await writeProject(project, file);
    expect(JSON.parse(content).authority.deletedNodes).toEqual(["box"]);
    expect(saved.handle).toBe(file.handle);
    expect(saved.original).toBe(content);
    expect(close).toHaveBeenCalledOnce();
  });

  it("refuses to overwrite an external update", async () => {
    const createWritable = vi.fn();
    const file: ProjectFile = { original: "old", handle: {
      getFile: async () => ({ text: async () => "updated by another process" }) as File,
      createWritable,
    } };
    await expect(writeProject(protectDiagram(diagram()), file)).rejects.toThrow("changed outside");
    expect(createWritable).not.toHaveBeenCalled();
  });
});
