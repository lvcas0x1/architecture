import { describe, expect, it } from "vitest";
import {
  BundleError,
  catalogFromBundle,
  loadBundle,
  readEmbedded,
} from "./bundle.js";

const minimalBundle = {
  schemaVersion: "1.0",
  exportedAt: "2026-09-19T00:00:00Z",
  options: { includeRaw: false, interactive: true, includeSearch: true, maskAccountIds: false },
  diagram: {
    schemaVersion: "1.0",
    meta: { title: "diagram" },
    viewport: { x: 0, y: 0, zoom: 1 },
    layout: { mode: "manual" },
    nodes: [],
    edges: [],
  },
  resources: {},
  icons: {},
};

function docWith(json: string, id = "arch-bundle"): Document {
  const doc = document.implementation.createHTMLDocument();
  const script = doc.createElement("script");
  script.type = "application/json";
  script.id = id;
  script.textContent = json;
  doc.body.append(script);
  return doc;
}

describe("reading the embedded data", () => {
  it("reads a valid bundle", () => {
    const bundle = loadBundle(docWith(JSON.stringify(minimalBundle)));
    expect(bundle.diagram.meta.title).toBe("diagram");
  });

  it("a missing element gives a clear error", () => {
    const doc = document.implementation.createHTMLDocument();
    expect(() => loadBundle(doc)).toThrow(BundleError);
    expect(() => loadBundle(doc)).toThrow(/arch-bundle/);
  });

  it("broken JSON becomes a BundleError", () => {
    expect(() => loadBundle(docWith("{broken"))).toThrow(BundleError);
  });

  it("a missing diagram is refused", () => {
    const broken = { ...minimalBundle, diagram: {} };
    expect(() => loadBundle(docWith(JSON.stringify(broken)))).toThrow(/diagram data is corrupted/);
  });

  it("omitted fields get their defaults", () => {
    const partial = { ...minimalBundle };
    delete (partial as Record<string, unknown>).options;
    delete (partial as Record<string, unknown>).resources;
    delete (partial as Record<string, unknown>).icons;

    const bundle = loadBundle(docWith(JSON.stringify(partial)));
    expect(bundle.options.interactive).toBe(true);
    expect(bundle.resources).toEqual({});
    expect(bundle.icons).toEqual({});
  });

  it("readEmbedded returns null with no element", () => {
    expect(readEmbedded("none", document.implementation.createHTMLDocument())).toBeNull();
  });
});

describe("converting to an icon catalog", () => {
  it("the data URI becomes the path", () => {
    const icons = catalogFromBundle({
      "Architecture/Compute/Amazon-EC2": "data:image/svg+xml;charset=utf-8,%3Csvg%3E",
    });
    expect(icons).toHaveLength(1);
    expect(icons[0]!.path).toContain("data:image/svg+xml");
    expect(icons[0]!.category).toBe("Compute");
    expect(icons[0]!.label).toBe("Amazon EC2");
  });

  it("an unexpected key shape does not break it", () => {
    const icons = catalogFromBundle({ weird: "data:," });
    expect(icons[0]!.key).toBe("weird");
    expect(icons[0]!.label).toBe("weird");
  });

  it("empty in, empty out", () => {
    expect(catalogFromBundle({})).toEqual([]);
  });
});

