/**
 * Read the HTML the backend actually produced and check it.
 *
 * `npm run sample` and an HTML export have to run first
 * (the tests skip when they have not).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBundle } from "./bundle.js";

// vitest runs in this package's directory
const EXPORTED = resolve(process.cwd(), "../../workspace/exports/sample.html");

const suite = existsSync(EXPORTED) ? describe : describe.skip;

suite("the exported single HTML file", () => {
  const html = existsSync(EXPORTED) ? readFileSync(EXPORTED, "utf8") : "";

  it("references nothing external", () => {
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it("the embedded bundle can be read", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bundle = loadBundle(doc);

    expect(bundle.diagram.nodes.length).toBeGreaterThan(0);
    expect(Object.keys(bundle.icons).length).toBeGreaterThan(0);
  });

  it("the resources it references are included", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bundle = loadBundle(doc);

    const referenced = new Set(
      bundle.diagram.nodes
        .map((node) => ("resourceRef" in node.data ? node.data.resourceRef : null))
        .filter((ref): ref is string => Boolean(ref)),
    );
    for (const arn of referenced) {
      expect(bundle.resources[arn], `${arn} is not included`).toBeDefined();
    }
  });

  it("every icon it uses is inlined as a data URI", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bundle = loadBundle(doc);

    const used = new Set(
      bundle.diagram.nodes
        .map((node) => ("iconKey" in node.data ? node.data.iconKey : null))
        .filter((key): key is string => Boolean(key)),
    );
    for (const key of used) {
      expect(bundle.icons[key], `no icon for ${key}`).toMatch(/^data:image\/svg/);
    }
  });

  it("the raw response is left out by default", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bundle = loadBundle(doc);
    for (const resource of Object.values(bundle.resources)) {
      expect(resource.raw).toBeNull();
    }
  });

  it("the viewer has somewhere to mount", () => {
    expect(html).toContain('id="arch-root"');
  });
});
