import type { IconEntry } from "@architecture/schema";
import { describe, expect, it } from "vitest";
import { countAiOrigin, validateGraph } from "./validate.js";
import type { ArchEdge, ArchNode } from "./types.js";

const EC2 = "Architecture/Compute/Amazon-EC2";
const ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc";

const icons = [{ key: EC2 }] as IconEntry[];

const resource = (
  id: string,
  over: { ref?: string | null; parentId?: string; iconKey?: string; origin?: string } = {},
): ArchNode =>
  ({
    id,
    type: "resource",
    position: { x: 0, y: 0 },
    ...(over.parentId ? { parentId: over.parentId } : {}),
    data: {
      iconKey: over.iconKey ?? EC2,
      resourceRef: over.ref ?? null,
      origin: over.origin ?? "user",
    },
  }) as ArchNode;

// A generic box is the one style allowed both on the canvas and as any parent,
// so it keeps fixtures to the rule under test.
const group = (
  id: string,
  origin = "user",
  style = "generic",
  parentId?: string,
): ArchNode =>
  ({
    id,
    type: "group",
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId } : {}),
    data: { label: id, style, resourceRef: null, iconKey: null, origin },
  }) as ArchNode;

const edge = (id: string, source: string, target: string, origin = "user"): ArchEdge =>
  ({ id, source, target, data: { origin } }) as ArchEdge;

const messages = (nodes: ArchNode[], edges: ArchEdge[] = [], catalog = icons) =>
  validateGraph(nodes, edges, catalog).issues.map((i) => i.message);

describe("checking a diagram", () => {
  it("says nothing when there is no problem", () => {
    const nodes = [
      group("g1"),
      resource("n1", { ref: ARN, parentId: "g1" }),
      resource("n2", { ref: `${ARN}2`, parentId: "g1" }),
    ];
    const report = validateGraph(nodes, [edge("e1", "n1", "n2")], icons);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("an icon that is not in the catalog is an error", () => {
    const report = validateGraph(
      [
        group("g1"),
        resource("n1", { ref: ARN, iconKey: "Architecture/Nope/Nope", parentId: "g1" }),
        resource("n2", { ref: `${ARN}2`, parentId: "g1" }),
      ],
      [edge("e1", "n1", "n2")],
      icons,
    );
    const issue = report.issues.find((i) => i.message.includes("not in the catalog"))!;

    expect(report.ok).toBe(false);
    expect(issue.level).toBe("error");
    expect(issue.nodeIds).toEqual(["n1"]);
  });

  it("while the catalog is still loading, nothing is said about icons", () => {
    const report = validateGraph(
      [group("g1"), resource("n1", { ref: ARN, parentId: "g1" })],
      [edge("e1", "g1", "n1")],
      [],
      undefined,
      false,
    );
    expect(report.issues).toEqual([]);
  });

  it("with no catalog loaded, iconKey is not checked", () => {
    const report = validateGraph(
      [resource("n1", { ref: ARN, iconKey: "Architecture/Nope/Nope", parentId: "g1" }), group("g1")],
      [],
      [],
    );
    expect(report.issues.map((i) => i.level)).not.toContain("error");
  });

  it("unlinked is a warning", () => {
    expect(messages([resource("n1", { parentId: "g1" }), group("g1")])).toContain(
      "1 icon(s) have no resource JSON linked",
    );
  });

  it("an icon with no line is a warning", () => {
    expect(messages([group("g1"), resource("n1", { ref: ARN, parentId: "g1" })])).toEqual([
      "1 icon(s) have no connections",
    ]);
  });

  it("an icon on the bare canvas is an error, as it is on the server", () => {
    const report = validateGraph([resource("n1", { ref: ARN })], [], icons);
    expect(report.ok).toBe(false);
    expect(report.issues[0]!.message).toContain("sit on the canvas");
  });

  it("a box that cannot sit on the canvas is an error", () => {
    const report = validateGraph([group("g1", "user", "vpc")], [], icons);
    expect(report.ok).toBe(false);
  });

  it("a box inside a shape is an error", () => {
    const shape = {
      id: "s1",
      type: "shape",
      position: { x: 0, y: 0 },
      data: { shape: "rectangle", origin: "user" },
    } as unknown as ArchNode;
    const report = validateGraph([shape, group("g1", "user", "generic", "s1")], [], icons);
    expect(report.ok).toBe(false);
    expect(report.issues[0]!.message).toContain("not a box");
  });

  it("several nodes pointing at one resource is a warning", () => {
    const nodes = [
      group("g1"),
      resource("n1", { ref: ARN, parentId: "g1" }),
      resource("n2", { ref: ARN, parentId: "g1" }),
    ];
    const issue = validateGraph(nodes, [], icons).issues.find((i) =>
      i.message.includes("point at the same resource"),
    )!;
    expect(issue.message).toContain("2 icons point at the same resource");
    expect(issue.nodeIds).toEqual(["n1", "n2"]);
  });

  it("an empty box is a warning", () => {
    expect(messages([group("g1")])).toEqual(["1 box(es) are empty"]);
  });

  it("warnings alone leave ok true (it can still be saved)", () => {
    expect(validateGraph([group("g1")], [], icons).ok).toBe(true);
  });

  it("every finding jumps to its nodes", () => {
    const nodes = [
      group("g1"),
      resource("n1", { ref: ARN, parentId: "g1" }),
      resource("n2", { ref: `${ARN}2`, parentId: "g1" }),
    ];
    const issues = validateGraph(nodes, [], icons).issues;
    expect(issues[0]!.nodeIds).toEqual(["n1", "n2"]);
  });

  it("an empty diagram has no problems", () => {
    expect(validateGraph([], [], icons).issues).toEqual([]);
  });
});

describe("placement that does not match the icon attribute", () => {
  // Attributes can change later, so an icon already placed can stop matching.
  // The check has to catch that.
  const zoneScope = () => "zone" as const;

  it("inside a box the attribute forbids, it is an error", () => {
    const nodes = [
      group("g0", "user", "global"),
      group("g1", "user", "region", "g0"),
      resource("n1", { ref: ARN, parentId: "g1" }),
    ];
    const report = validateGraph(nodes, [], icons, zoneScope);

    expect(report.ok).toBe(false);
    expect(report.issues[0]?.message).toContain("Availability Zone");
    expect(report.issues[0]?.nodeIds).toEqual(["n1"]);
  });

  it("inside a box it allows, nothing is reported", () => {
    const nodes = [
      group("g0", "user", "generic"),
      group("g1", "user", "subnet-public", "g0"),
      resource("n1", { ref: ARN, parentId: "g1" }),
    ];
    expect(validateGraph(nodes, [], icons, zoneScope).ok).toBe(true);
  });

  it("with no attribute, anywhere passes", () => {
    const nodes = [group("g1", "user", "global"), resource("n1", { ref: ARN, parentId: "g1" })];
    expect(validateGraph(nodes, [], icons, () => "any" as const).ok).toBe(true);
  });

  it("a generic box is an exception and passes", () => {
    const nodes = [group("g1", "user", "generic"), resource("n1", { ref: ARN, parentId: "g1" })];
    expect(validateGraph(nodes, [], icons, zoneScope).ok).toBe(true);
  });

  it("findings with the same reason are merged into one", () => {
    const nodes = [
      group("g0", "user", "global"),
      group("g1", "user", "region", "g0"),
      resource("n1", { ref: ARN, parentId: "g1" }),
      resource("n2", { ref: `${ARN}2`, parentId: "g1" }),
    ];
    const scopeIssues = validateGraph(nodes, [], icons, zoneScope).issues.filter((i) =>
      i.message.includes("Availability Zone"),
    );

    expect(scopeIssues).toHaveLength(1);
    expect(scopeIssues[0]?.nodeIds).toEqual(["n1", "n2"]);
  });

  it("without the attributes, the layer is not checked", () => {
    // Attributes live in the user's settings, not the catalog, so without them there is nothing to judge
    const nodes = [
      group("g0", "user", "global"),
      group("g1", "user", "region", "g0"),
      resource("n1", { ref: ARN, parentId: "g1" }),
    ];

    expect(validateGraph(nodes, [], icons).ok).toBe(true);
  });
});

describe("counting what the AI made", () => {
  it("counts nodes and edges with origin=ai", () => {
    const nodes = [
      resource("n1", { ref: ARN, origin: "ai" }),
      resource("n2", { ref: ARN, origin: "user" }),
      group("g1", "ai"),
    ];
    expect(countAiOrigin(nodes, [edge("e1", "n1", "n2", "ai")])).toBe(3);
  });

  it("zero when everything was drawn by hand", () => {
    expect(countAiOrigin([resource("n1")], [edge("e1", "n1", "n1")])).toBe(0);
  });
});
