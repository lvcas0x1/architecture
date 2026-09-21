import { describe, expect, it } from "vitest";
import {
  DiagramParseError,
  fileNameFor,
  migrateLegacyDiagram,
  parseDiagram,
  serializeDiagram,
} from "./file.js";

const valid = {
  schemaVersion: "1.0",
  meta: { title: "test diagram" },
  viewport: { x: 0, y: 0, zoom: 1 },
  layout: { mode: "manual" },
  nodes: [],
  edges: [],
};

describe("file names", () => {
  it("adds the extension", () => {
    expect(fileNameFor("production")).toBe("production.arch.json");
  });
  it("drops path separators and punctuation", () => {
    expect(fileNameFor("a/b:c*d?")).toBe("a-b-c-d-.arch.json");
  });
  it("turns spaces into hyphens", () => {
    expect(fileNameFor("prod  vpc")).toBe("prod-vpc.arch.json");
  });
  it("an empty title still gets a default name", () => {
    expect(fileNameFor("   ")).toBe("diagram.arch.json");
  });
});

describe("validation on load", () => {
  it("reads a valid diagram", () => {
    expect(parseDiagram(JSON.stringify(valid)).diagram.meta.title).toBe(
      "test diagram",
    );
  });

  it("broken JSON fails with a reason", () => {
    expect(() => parseDiagram("{not json")).toThrow(DiagramParseError);
  });

  it("a different schemaVersion is refused", () => {
    expect(() =>
      parseDiagram(JSON.stringify({ ...valid, schemaVersion: "2.0" })),
    ).toThrow(/schemaVersion/);
  });

  it("nodes that is not an array is refused", () => {
    expect(() => parseDiagram(JSON.stringify({ ...valid, nodes: {} }))).toThrow(
      /nodes \/ edges/,
    );
  });

  it("an array or null is refused", () => {
    expect(() => parseDiagram("null")).toThrow(DiagramParseError);
  });
});

describe("serializing", () => {
  it("two-space indent with a trailing newline (so diffs read well)", () => {
    const text = serializeDiagram(valid as never);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "meta"');
  });
});

describe("loading the old format", () => {
  const legacy = {
    ...valid,
    nodes: [
      { id: "n1", type: "resource", data: { iconKey: "x/y/z" } },
      { id: "a1", type: "anchor", data: {} },
      { id: "a2", type: "anchor", data: {} },
    ],
    edges: [
      { id: "e1", source: "n1", target: "n1", data: { kind: "resource" } },
      { id: "e2", source: "a1", target: "a2", data: { kind: "decoration" } },
    ],
  };

  it("removes floating lines and anchors", () => {
    const { diagram } = migrateLegacyDiagram(legacy as never);
    expect(diagram.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(diagram.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("says what was removed", () => {
    const { notes } = migrateLegacyDiagram(legacy as never);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Removed 1 line");
  });

  it("drops the retired data.kind", () => {
    const { diagram } = migrateLegacyDiagram(legacy as never);
    expect("kind" in (diagram.edges[0]!.data as object)).toBe(false);
  });

  it("the current format passes through untouched", () => {
    const current = {
      ...valid,
      nodes: [{ id: "n1", type: "resource", data: { iconKey: "x/y/z" } }],
      edges: [
        { id: "e1", source: "n1", target: "n1", data: { line: "solid" } },
      ],
    };
    const { diagram, notes } = migrateLegacyDiagram(current as never);
    expect(notes).toEqual([]);
    expect(diagram.nodes).toHaveLength(1);
    expect(diagram.edges).toHaveLength(1);
  });

  it("the load path migrates too", () => {
    const { diagram, notes } = parseDiagram(JSON.stringify(legacy));
    expect(diagram.nodes).toHaveLength(1);
    expect(notes.some((note) => note.includes("Removed 1 line"))).toBe(true);
  });

  it("a node with no position is called out, not silently placed", () => {
    const { notes } = parseDiagram(JSON.stringify(legacy));
    expect(notes.some((note) => note.includes("had no position"))).toBe(true);
  });

  it("a duplicate id is refused rather than half-loaded", () => {
    const twice = {
      ...valid,
      nodes: [
        { id: "n1", type: "resource", data: { iconKey: "x/y/z" } },
        { id: "n1", type: "resource", data: { iconKey: "x/y/z" } },
      ],
      edges: [],
    };
    expect(() => parseDiagram(JSON.stringify(twice))).toThrow(
      /Duplicate node id/,
    );
  });
});

describe("schema-based input validation", () => {
  it("rejects IDs that collide after whitespace normalization", () => {
    expect(() =>
      parseDiagram(
        JSON.stringify({
          nodes: [
            { id: "n", type: "text" },
            { id: " n ", type: "text" },
          ],
        }),
      ),
    ).toThrow(/Duplicate node id/);
  });
  it("accepts root omissions and uses server defaults", () => {
    const diagram = parseDiagram("{}").diagram;
    expect(diagram.schemaVersion).toBe("1.0");
    expect(diagram.nodes).toEqual([]);
    expect(diagram.edges).toEqual([]);
    expect(diagram.meta.createdAt).toBeNull();
    const nodes = parseDiagram(
      JSON.stringify({
        nodes: [
          { id: "g", type: "group" },
          { id: "t", type: "text" },
        ],
      }),
    ).diagram.nodes;
    expect(nodes[0]!.data).toMatchObject({ label: "" });
    expect(nodes[1]!.data).toMatchObject({ text: "" });
  });
  it.each([
    { showFields: null },
    { maxTags: -1 },
    { labelOverride: {} },
    { mount: "invalid" },
  ])("refuses unsafe resource node data: %j", (data) => {
    expect(() =>
      parseDiagram(
        JSON.stringify({
          nodes: [
            {
              id: "n",
              type: "resource",
              data: { iconKey: "Architecture/Compute/Amazon-EC2", ...data },
            },
          ],
        }),
      ),
    ).toThrow(DiagramParseError);
  });
  it("rejects unknown fields and invalid geometry before changing a diagram", () => {
    expect(() =>
      parseDiagram(
        JSON.stringify({
          nodes: [{ id: "t", type: "text", position: { x: "bad", y: 0 } }],
        }),
      ),
    ).toThrow();
    expect(() => parseDiagram('{"unexpected":true}')).toThrow();
  });
});
