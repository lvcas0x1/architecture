/**
 * End-to-end: load an AI draft, auto-arrange it and hand it over for touching up.
 *
 *   AI output (no coordinates) -> ELK settles them -> check -> user adjusts -> save
 *
 * Uses the real draft file (workspace/diagrams/ai-draft.arch.json).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Diagram, IconEntry } from "@architecture/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { parseDiagram } from "./lib/file.js";
import { absolutePosition } from "./lib/geometry.js";
import { validateGraph } from "./lib/validate.js";
import { useCatalogStore } from "./store/catalog.js";
import { useEditorStore } from "./store/editor.js";

const DRAFT = resolve(
  process.cwd(),
  "../../workspace/diagrams/ai-draft.arch.json",
);
const CATALOG = resolve(process.cwd(), "public/icons-placeholder.json");

const draft: Diagram = parseDiagram(readFileSync(DRAFT, "utf8")).diagram;
const icons: IconEntry[] = JSON.parse(readFileSync(CATALOG, "utf8")).icons;

const s = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.getState().newDiagram();
  useCatalogStore.setState({
    icons,
    byKey: new Map(icons.map((i) => [i.key, i])),
    status: "ready",
    isPlaceholder: true,
    error: null,
  });
});

describe("loading an AI draft", () => {
  it("has no coordinates (the AI is never asked for them)", () => {
    expect(draft.layout.mode).toBe("auto");
    expect(
      draft.nodes.every(
        (node) => node.position === null || node.position === undefined,
      ),
    ).toBe(true);
  });

  it("what it created carries origin=ai", () => {
    expect(draft.nodes.every((node) => node.data.origin === "ai")).toBe(true);
  });

  it("loading brings in every node", () => {
    s().loadDiagram(draft);
    expect(s().nodes).toHaveLength(draft.nodes.length);
    expect(s().edges).toHaveLength(draft.edges.length);
    expect(s().dirty).toBe(false);
  });

  it("the nesting is preserved", () => {
    s().loadDiagram(draft);
    const byId = new Map(s().nodes.map((n) => [n.id, n]));
    expect(byId.get("n-ec2")!.parentId).toBe("g-subnet-pri");
    expect(byId.get("g-subnet-pri")!.parentId).toBe("g-vpc");
  });
});

describe("auto layout", () => {
  it("coordinates appear and nothing overlaps", async () => {
    s().loadDiagram(draft);
    const laidOut = await s().applyAutoLayout();
    expect(laidOut).toBe(draft.nodes.length);

    // position is parent-relative, so overlap is judged in absolute coordinates
    const nodes = s().nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const absolute = nodes
      .filter((n) => n.type === "resource")
      .map((n) => {
        const { x, y } = absolutePosition(n, byId);
        return `${Math.round(x)},${Math.round(y)}`;
      });

    expect(new Set(absolute).size).toBe(absolute.length);
  });

  it("it becomes manual afterwards (the user's coordinates are now the truth)", async () => {
    s().loadDiagram(draft);
    await s().applyAutoLayout();
    expect(s().layout.mode).toBe("manual");
  });

  it("a box grows to hold its contents", async () => {
    s().loadDiagram(draft);
    await s().applyAutoLayout();

    const vpc = s().nodes.find((n) => n.id === "g-vpc")!;
    const subnet = s().nodes.find((n) => n.id === "g-subnet-pri")!;
    expect(vpc.width!).toBeGreaterThan(subnet.width!);
    expect(vpc.height!).toBeGreaterThan(0);
  });

  it("the layout undoes as a single operation", async () => {
    s().loadDiagram(draft);
    const before = s().past.length;
    await s().applyAutoLayout();

    expect(s().past.length).toBe(before + 1);
    s().undo();
    // Back to the "no coordinates" state (the origin, in React Flow terms)
    expect(
      s().nodes.every((n) => n.position.x === 0 && n.position.y === 0),
    ).toBe(true);
  });
});

describe("checking", () => {
  it("a sound draft has no problems", () => {
    s().loadDiagram(draft);
    const report = validateGraph(s().nodes, s().edges, icons);
    expect(report.issues).toEqual([]);
  });

  it("an icon the AI invented is caught", () => {
    const broken: Diagram = JSON.parse(JSON.stringify(draft));
    (broken.nodes[4] as { data: { iconKey: string } }).data.iconKey =
      "Architecture/Nope/Nope";
    s().loadDiagram(broken);

    const errors = s().runValidation(icons);
    expect(errors).toBe(1);
    expect(s().issues[0]!.message).toContain("not in the catalog");
  });

  it("a finding selects its nodes", () => {
    const broken: Diagram = JSON.parse(JSON.stringify(draft));
    (broken.nodes[4] as { data: { iconKey: string } }).data.iconKey =
      "Architecture/X/Y";
    s().loadDiagram(broken);
    s().runValidation(icons);

    s().selectNodes(s().issues[0]!.nodeIds);
    expect(
      s()
        .nodes.filter((n) => n.selected)
        .map((n) => n.id),
    ).toEqual(s().issues[0]!.nodeIds);
  });
});

describe("the user's touch-ups and saving", () => {
  it("a position moved by hand after the layout is saved", async () => {
    s().loadDiagram(draft);
    await s().applyAutoLayout();

    const target = s().nodes.find((n) => n.id === "n-ec2")!;
    s().onNodesChange([
      {
        id: target.id,
        type: "position",
        position: { x: 999, y: 888 },
        dragging: false,
      },
    ]);

    const saved = s().toDiagram();
    const node = saved.nodes.find((n) => n.id === "n-ec2")!;
    expect(node.position).toEqual({ x: 999, y: 888 });
    expect(saved.layout.mode).toBe("manual");
  });

  it("the user's additions mix with the AI's and still save", async () => {
    s().loadDiagram(draft);
    await s().applyAutoLayout();

    // A resource only goes inside a container, so place a box first
    const boxId = s().addGroupNode({ x: 2000, y: 2000 });
    const added = s().addResourceNode("Architecture/Analytics/Amazon-Athena", {
      x: 2120,
      y: 2120,
    });
    expect(added).not.toBeNull();
    expect(s().nodes.find((n) => n.id === added)!.parentId).toBe(boxId);

    const saved = s().toDiagram();
    const origins = saved.nodes.map((n) => n.data.origin);
    expect(origins).toContain("ai");
    expect(origins).toContain("user");
  });

  it("what was saved loads again intact", async () => {
    s().loadDiagram(draft);
    await s().applyAutoLayout();
    const saved = s().toDiagram();

    s().newDiagram();
    s().loadDiagram(saved);
    expect(s().nodes).toHaveLength(draft.nodes.length);
    expect(s().layout.mode).toBe("manual");
  });
});

it("measurement and selection notifications do not cancel an AI layout", async () => {
  s().loadDiagram(draft);
  const pending = s().applyAutoLayout();
  s().onNodesChange([
    {
      id: "n-ec2",
      type: "dimensions",
      dimensions: { width: 132, height: 120 },
    },
    { id: "g-global", type: "select", selected: true },
  ]);
  expect(await pending).toBeGreaterThan(0);
  expect(s().nodes.find((n) => n.id === "g-global")!.selected).toBe(true);
});
it("changing layout options invalidates an in-flight layout", async () => {
  s().loadDiagram(draft);
  const pending = s().applyAutoLayout();
  s().setLayoutOptions({ direction: "DOWN" });
  expect(await pending).toBe(0);
});
