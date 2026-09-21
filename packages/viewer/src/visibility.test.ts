import { describe, expect, it } from "vitest";
import { diagramIsVisible } from "./App.js";
import type { ArchNode } from "@architecture/editor";

const box = (id: string, x: number, hidden = false): ArchNode =>
  ({
    id,
    type: "group",
    position: { x, y: 50 },
    width: 100,
    height: 100,
    hidden,
    data: { label: id, style: "generic" },
  }) as ArchNode;
describe("saved viewport visibility", () => {
  it("does not count the empty gap between off-screen nodes", () => {
    expect(
      diagramIsVisible([box("a", -1000), box("b", 5000)], {
        x: 0,
        y: 0,
        zoom: 1,
      }),
    ).toBe(false);
  });
  it("does not count a hidden node as visible", () => {
    expect(
      diagramIsVisible([box("a", -1000), box("hidden", 100, true)], {
        x: 0,
        y: 0,
        zoom: 1,
      }),
    ).toBe(false);
  });
  it("preserves a viewport showing even part of a node", () => {
    expect(diagramIsVisible([box("a", -50)], { x: 0, y: 0, zoom: 1 })).toBe(
      true,
    );
  });
});
