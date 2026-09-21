import type { Diagram, GroupNodeData } from "@architecture/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { toDiagram } from "../lib/adapter.js";
import { ICON_CENTER_OFFSET, defaultGroupData } from "../lib/defaults.js";
import type { ArchNode } from "../lib/types.js";
import { useCatalogStore } from "./catalog.js";
import { useEditorStore } from "./editor.js";

const s = () => useEditorStore.getState();

beforeEach(() => {
  useEditorStore.getState().newDiagram();
  useEditorStore.getState().setGroupStyle("generic");
});

const EC2 = "Architecture/Compute/Amazon-EC2";

/** A resource can only go inside a container, so make one first. */
const makeBox = (point = { x: 0, y: 0 }) => s().addGroupNode(point)!;

/** A point inside the default box (360x260). */
const inBox = (x = 120, y = 120) => ({ x, y });

describe("adding nodes", () => {
  it("dropping into a box adds a resource node", () => {
    const groupId = makeBox();
    const id = s().addResourceNode(EC2, inBox())!;

    const node = s().nodes.find((n) => n.id === id)!;
    expect(node.type).toBe("resource");
    expect(node.data.iconKey).toBe(EC2);
    expect(node.parentId).toBe(groupId);
    expect(node.extent).toBe("parent");
    // Not set before it is linked
    expect(node.data.resourceRef).toBeNull();
  });

  it("the dropped point becomes the centre of the icon", () => {
    makeBox();
    const id = s().addResourceNode(EC2, { x: 120, y: 120 })!;
    const node = s().nodes.find((n) => n.id === id)!;

    // node top-left + the icon centre offset = the dropped point
    expect(node.position.x + ICON_CENTER_OFFSET.x).toBe(120);
    expect(node.position.y + ICON_CENTER_OFFSET.y).toBe(120);
  });

  it("with nested boxes the inner one becomes the parent", () => {
    makeBox();
    const inner = s().addGroupNode({ x: 20, y: 20 })!;
    // The smaller area counts as inner, so make it actually smaller
    s().onNodesChange([
      {
        id: inner,
        type: "dimensions",
        dimensions: { width: 160, height: 120 },
        setAttributes: true,
      },
    ]);

    const id = s().addResourceNode(EC2, { x: 100, y: 100 })!;
    expect(s().nodes.find((n) => n.id === id)!.parentId).toBe(inner);
  });

  it("only the new node is selected", () => {
    makeBox();
    s().addResourceNode(EC2, inBox(80, 80));
    s().addResourceNode(EC2, inBox(260, 200));
    expect(s().nodes.filter((n) => n.selected)).toHaveLength(1);
  });
});

describe("a resource only goes inside a container", () => {
  it("refuses the bare canvas and says why", () => {
    const id = s().addResourceNode(EC2, { x: 2000, y: 2000 });

    expect(id).toBeNull();
    expect(s().nodes).toHaveLength(0);
    expect(s().alert).toContain("inside a box or a shape");
  });

  it("refuses outside a box", () => {
    makeBox();
    expect(s().addResourceNode(EC2, { x: 2000, y: 2000 })).toBeNull();
  });

  it("a shape works too", () => {
    const shapeId = s().addShapeNode({ x: 0, y: 0 });
    const id = s().addResourceNode(EC2, { x: 80, y: 48 })!;

    expect(id).not.toBeNull();
    expect(s().nodes.find((n) => n.id === id)!.parentId).toBe(shapeId);
    expect(s().nodes.find((n) => n.id === id)!.data.mount).toBe("inside");
  });

  it("a refused placement does not touch the history", () => {
    const before = s().past.length;
    s().addResourceNode(EC2, { x: 2000, y: 2000 });
    expect(s().past.length).toBe(before);
  });

  it("dragging it out puts it back", () => {
    const groupId = makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    const before = s().nodes.find((n) => n.id === id)!.position;

    s().beginNodeDrag(id);
    s().reparentNode(id, { x: 3000, y: 3000 }, { commit: false });

    const after = s().nodes.find((n) => n.id === id)!;
    expect(after.position).toEqual(before);
    expect(after.parentId).toBe(groupId);
    expect(s().alert).toContain("inside a box or a shape");
  });

  it("a multi-selection that lands somewhere illegal puts every node back", () => {
    const groupId = makeBox();
    const first = s().addResourceNode(EC2, inBox(80, 80))!;
    const second = s().addResourceNode(EC2, inBox(240, 160))!;
    const before = s().nodes.filter((n) => n.id === first || n.id === second);
    const historyBefore = s().past.length;

    // React Flow reports a drag start per moving node, then a stop per node
    s().beginNodeDrag(first);
    s().beginNodeDrag(second);
    s().reparentNode(first, { x: 3000, y: 3000 }, { commit: false });
    s().reparentNode(second, { x: 3200, y: 3200 }, { commit: false });

    for (const original of before) {
      const after = s().nodes.find((n) => n.id === original.id)!;
      expect(after.position).toEqual(original.position);
      expect(after.parentId).toBe(groupId);
      expect(after.extent).toBe("parent");
    }
    // One drag, one undo step
    expect(s().past.length).toBe(historyBefore + 1);
  });

  it("dragging it into another container works", () => {
    makeBox({ x: 0, y: 0 });
    const shapeId = s().addShapeNode({ x: 1000, y: 1000 });
    const id = s().addResourceNode(EC2, inBox())!;

    s().beginNodeDrag(id);
    // Near the middle of the shape (clear of the border)
    s().reparentNode(id, { x: 1080, y: 1048 }, { commit: false });

    expect(s().nodes.find((n) => n.id === id)!.parentId).toBe(shapeId);
    expect(s().alert).toBeNull();
  });
});

describe("straddling a shape's border", () => {
  /** A shape defaults to 160x96. Placed at (0,0) the borders are x=0/160, y=0/96. */
  const makeShape = () => s().addShapeNode({ x: 0, y: 0 });

  it("dropped near a border, it snaps so the border runs through the icon's centre", () => {
    const shapeId = makeShape();
    const id = s().addResourceNode(EC2, { x: 2, y: 48 })!;

    const node = s().nodes.find((n) => n.id === id)!;
    expect(node.parentId).toBe(shapeId);
    expect(node.data.mount).toBe("border");
    expect(node.data.borderSide).toBe("left");
    // The icon's centre lines up with the shape's left edge (relative x=0)
    expect(node.position.x + ICON_CENTER_OFFSET.x).toBe(0);
  });

  it("snaps to each of the four sides", () => {
    makeShape();
    const cases: [{ x: number; y: number }, string][] = [
      [{ x: 80, y: 3 }, "top"],
      [{ x: 158, y: 48 }, "right"],
      [{ x: 80, y: 94 }, "bottom"],
      [{ x: 3, y: 48 }, "left"],
    ];
    for (const [point, side] of cases) {
      const id = s().addResourceNode(EC2, point)!;
      expect(s().nodes.find((n) => n.id === id)!.data.borderSide).toBe(side);
    }
  });

  it("away from the border it goes inside", () => {
    makeShape();
    const id = s().addResourceNode(EC2, { x: 80, y: 48 })!;
    expect(s().nodes.find((n) => n.id === id)!.data.mount).toBe("inside");
  });

  it("a node on a border is not confined inside the parent", () => {
    makeShape();
    const id = s().addResourceNode(EC2, { x: 2, y: 48 })!;
    // extent:'parent' would stop it sticking out past the border
    expect(s().nodes.find((n) => n.id === id)!.extent).toBeUndefined();
  });

  it("a node on a border sits in front of the shape", () => {
    makeShape();
    const id = s().addResourceNode(EC2, { x: 2, y: 48 })!;
    expect(s().nodes.find((n) => n.id === id)!.zIndex).toBeGreaterThan(0);
  });

  it("a box's border snaps too", () => {
    const groupId = makeBox();
    const id = s().addResourceNode(EC2, { x: 2, y: 130 })!;

    const node = s().nodes.find((n) => n.id === id)!;
    expect(node.parentId).toBe(groupId);
    expect(node.data.mount).toBe("border");
    expect(node.data.borderSide).toBe("left");
  });

  it("it can be dragged from the inside onto the border", () => {
    makeShape();
    const id = s().addResourceNode(EC2, { x: 80, y: 48 })!;
    expect(s().nodes.find((n) => n.id === id)!.data.mount).toBe("inside");

    s().beginNodeDrag(id);
    s().reparentNode(id, { x: 1, y: 48 }, { commit: false });

    const node = s().nodes.find((n) => n.id === id)!;
    expect(node.data.mount).toBe("border");
    expect(node.data.borderSide).toBe("left");
  });
});

describe("a line always joins connection points", () => {
  const connect = (source: string, target: string) =>
    s().onConnect({
      source,
      target,
      sourceHandle: "right",
      targetHandle: "left",
    });

  /** Make a container, then place two resources. */
  const twoResources = (): [string, string] => {
    makeBox();
    return [
      s().addResourceNode(EC2, inBox(80, 80))!,
      s().addResourceNode(EC2, inBox(260, 200))!,
    ];
  };

  it("two resources connect", () => {
    const [a, b] = twoResources();
    connect(a, b);

    expect(s().edges).toHaveLength(1);
    expect(s().alert).toBeNull();
  });

  it("a box connects", () => {
    const g = makeBox();
    const n = s().addResourceNode(EC2, inBox())!;
    connect(n, g);
    expect(s().edges).toHaveLength(1);
  });

  it("a shape connects", () => {
    makeBox();
    const shape = s().addShapeNode({ x: 1000, y: 1000 });
    const n = s().addResourceNode(EC2, inBox())!;
    connect(n, shape);
    expect(s().edges).toHaveLength(1);
  });

  it("two shapes connect", () => {
    const a = s().addShapeNode({ x: 0, y: 0 });
    const b = s().addShapeNode({ x: 900, y: 0 });
    connect(a, b);
    expect(s().edges).toHaveLength(1);
  });

  it("text cannot be an endpoint, and it says why", () => {
    makeBox();
    const n = s().addResourceNode(EC2, inBox())!;
    const t = s().addTextNode({ x: 900, y: 0 });
    connect(n, t);

    expect(s().edges).toHaveLength(0);
    expect(s().alert).toContain("connect the connection points");
  });

  it("a connection to a node that does not exist is ignored", () => {
    makeBox();
    const a = s().addResourceNode(EC2, inBox())!;
    s().onConnect({
      source: a,
      target: "missing",
      sourceHandle: null,
      targetHandle: null,
    });
    expect(s().edges).toHaveLength(0);
  });

  it("the toolbar's line style and arrows apply", () => {
    s().setEdgeStyle({ line: "dotted", arrow: "both", router: "straight" });
    const [a, b] = twoResources();
    connect(a, b);

    const edge = s().edges[0]!;
    expect(edge.data!.line).toBe("dotted");
    expect(edge.data!.arrow).toBe("both");
    expect(edge.markerStart).toBeDefined();
    expect(edge.markerEnd).toBeDefined();
    expect(edge.type).toBe("straight");
  });

  it("no arrow means no marker", () => {
    s().setEdgeStyle({ arrow: "none" });
    const [a, b] = twoResources();
    connect(a, b);

    expect(s().edges[0]!.markerStart).toBeUndefined();
    expect(s().edges[0]!.markerEnd).toBeUndefined();
  });

  it("there is no way to draw a line on its own", () => {
    // The old two-click decorative line was removed
    expect("startLine" in s()).toBe(false);
    expect("finishLine" in s()).toBe(false);
  });
});

describe("alerts", () => {
  it("can be set and cleared", () => {
    s().setAlert("nope");
    expect(s().alert).toBe("nope");
    s().setAlert(null);
    expect(s().alert).toBeNull();
  });

  it("clears when the tool changes", () => {
    s().setAlert("nope");
    s().setTool("box");
    expect(s().alert).toBeNull();
  });
});

describe("Delete", () => {
  it("deleting a box deletes the nodes inside it", () => {
    const groupId = makeBox();
    s().addResourceNode(EC2, inBox());
    expect(s().nodes).toHaveLength(2);

    s().deleteNodes([groupId]);
    expect(s().nodes).toHaveLength(0);
  });

  it("deleting only a line leaves the nodes", () => {
    makeBox();
    const a = s().addResourceNode(EC2, inBox(80, 80))!;
    const b = s().addResourceNode(EC2, inBox(260, 200))!;
    s().onConnect({
      source: a,
      target: b,
      sourceHandle: null,
      targetHandle: null,
    });

    s().deleteEdges([s().edges[0]!.id]);
    expect(s().edges).toHaveLength(0);
    expect(s().nodes).toHaveLength(3);
  });

  it("deleting a resource deletes its lines but keeps the other end", () => {
    const groupId = makeBox();
    const a = s().addResourceNode(EC2, inBox(80, 80))!;
    const b = s().addResourceNode(EC2, inBox(260, 200))!;
    s().onConnect({
      source: a,
      target: b,
      sourceHandle: null,
      targetHandle: null,
    });

    s().deleteNodes([a]);
    expect(s().nodes.map((n) => n.id)).toEqual([groupId, b]);
    expect(s().edges).toHaveLength(0);
  });
});

describe("Undo / Redo", () => {
  it("an addition can be undone", () => {
    makeBox();
    s().addResourceNode(EC2, inBox());
    expect(s().nodes).toHaveLength(2);
    s().undo();
    expect(s().nodes).toHaveLength(1);
    s().redo();
    expect(s().nodes).toHaveLength(2);
  });

  it("an empty history does nothing", () => {
    s().undo();
    s().redo();
    expect(s().nodes).toHaveLength(0);
  });

  it("a new action clears the redo history", () => {
    makeBox();
    s().addResourceNode(EC2, inBox());
    s().undo();
    expect(s().canRedo()).toBe(true);
    s().addGroupNode({ x: 800, y: 800 });
    expect(s().canRedo()).toBe(false);
  });

  it("a deletion can be undone", () => {
    makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    s().deleteNodes([id]);
    expect(s().nodes).toHaveLength(1);
    s().undo();
    expect(s().nodes).toHaveLength(2);
  });

  it("a drag pushes history once, at the start", () => {
    makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    const before = s().past.length;
    s().beginNodeDrag(id);
    expect(s().past.length).toBe(before + 1);
    // Moving within the same container adds nothing to the history
    s().reparentNode(id, inBox(140, 140), { commit: false });
    expect(s().past.length).toBe(before + 1);
  });
});

describe("saving and loading", () => {
  it("round-trips through the saved format", () => {
    const groupId = makeBox();
    const n1 = s().addResourceNode(EC2, inBox(80, 80))!;
    const n2 = s().addResourceNode(EC2, inBox(260, 200))!;
    s().onConnect({
      source: n1,
      target: n2,
      sourceHandle: null,
      targetHandle: null,
    });
    s().setTitle("round trip");

    const diagram: Diagram = s().toDiagram();
    expect(diagram.schemaVersion).toBe("1.0");
    expect(diagram.meta.title).toBe("round trip");
    // Coordinates are settled, so it saves as manual
    expect(diagram.layout.mode).toBe("manual");
    expect(diagram.nodes).toHaveLength(3);
    expect(diagram.edges).toHaveLength(1);

    s().newDiagram();
    expect(s().nodes).toHaveLength(0);

    s().loadDiagram(diagram);
    expect(s().nodes).toHaveLength(3);
    expect(s().edges).toHaveLength(1);
    expect(s().meta.title).toBe("round trip");
    expect(s().nodes.find((n) => n.id === n1)!.parentId).toBe(groupId);
    // Nothing has changed right after loading
    expect(s().dirty).toBe(false);
    expect(s().past).toHaveLength(0);
  });

  it("a box's size is saved", () => {
    s().addGroupNode({ x: 0, y: 0 });
    const diagram = s().toDiagram();
    const group = diagram.nodes.find((n) => n.type === "group")!;
    expect(group.size).toEqual({ width: 360, height: 260 });
  });

  it("a resource node does not save a size (it grows with the label lines)", () => {
    makeBox();
    s().addResourceNode(EC2, inBox());
    const node = s()
      .toDiagram()
      .nodes.find((n) => n.type === "resource")!;
    expect(node.size).toBeNull();
  });

  it("an empty diagram still saves", () => {
    const diagram = toDiagram({
      meta: s().meta,
      layout: s().layout,
      viewport: s().viewport,
      nodes: [],
      edges: [],
    });
    expect(diagram.nodes).toEqual([]);
    expect(diagram.meta.updatedAt).toBeTruthy();
  });
});

describe("the dirty flag", () => {
  it("false right after New, true after an edit", () => {
    expect(s().dirty).toBe(false);
    makeBox();
    expect(s().dirty).toBe(true);
  });
});

describe("linking a resource (Configure)", () => {
  it("linking an ARN clears the unlinked state", () => {
    makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    const arn = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc";
    s().bindResource(id, arn);

    const node = s().nodes.find((n) => n.id === id)!;
    expect(node.data.resourceRef).toBe(arn);
  });

  it("swaps in the icon found from the resource type", () => {
    makeBox();
    const id = s().addResourceNode("Architecture/Compute/Amazon-EC2", inBox())!;
    s().bindResource(
      id,
      "arn:aws:rds:ap-northeast-1:123456789012:db:x",
      "Architecture/Databases/Amazon-RDS",
    );
    expect(s().nodes.find((n) => n.id === id)!.data.iconKey).toBe(
      "Architecture/Databases/Amazon-RDS",
    );
  });

  it("without an icon given, the original stays", () => {
    makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    s().bindResource(
      id,
      "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc",
      null,
    );
    expect(s().nodes.find((n) => n.id === id)!.data.iconKey).toBe(EC2);
  });

  it("unlinking keeps the icon and clears only the reference", () => {
    makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    s().bindResource(
      id,
      "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc",
    );
    s().unbindResource(id);

    expect(s().nodes[0]!.data.resourceRef).toBeNull();
    expect(s().nodes.find((n) => n.id === id)!.data.iconKey).toBe(EC2);
  });

  it("linking can be undone", () => {
    makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    s().bindResource(
      id,
      "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc",
    );
    s().undo();
    expect(s().nodes.find((n) => n.id === id)!.data.resourceRef).toBeNull();
  });

  it("the saved format carries only the ARN reference, never the data", () => {
    makeBox();
    const id = s().addResourceNode(EC2, inBox())!;
    const arn = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc";
    s().bindResource(id, arn);

    const json = JSON.stringify(s().toDiagram());
    expect(json).toContain(arn);
    expect(json).not.toContain("sections");
  });
});

describe("box nesting rules", () => {
  /** Place a box with the given style. */
  const placeBox = (
    style: GroupNodeData["style"],
    point: { x: number; y: number },
  ): string | null => {
    s().setGroupStyle(style);
    return s().addGroupNode(point);
  };

  it("a new box is titled with its style's name", () => {
    const id = placeBox("global", { x: 0, y: 0 })!;
    expect(s().nodes.find((n) => n.id === id)!.data.label).toBe("AWS Cloud");
  });

  it("changing the style updates the title (when it is still the default)", () => {
    placeBox("global", { x: 0, y: 0 });
    const id = placeBox("region", { x: 60, y: 60 })!;
    expect(s().nodes.find((n) => n.id === id)!.data.label).toBe("Region");

    s().changeGroupStyle(id, "generic");
    expect(s().nodes.find((n) => n.id === id)!.data.label).toBe(
      "Generic group",
    );
  });

  it("a title the user typed survives a style change", () => {
    placeBox("global", { x: 0, y: 0 });
    const id = placeBox("region", { x: 60, y: 60 })!;
    s().updateNodeData(id, { label: "ap-northeast-1" });

    s().changeGroupStyle(id, "generic");
    expect(s().nodes.find((n) => n.id === id)!.data.label).toBe(
      "ap-northeast-1",
    );
  });

  it("Global can sit on the bare canvas", () => {
    expect(placeBox("global", { x: 0, y: 0 })).not.toBeNull();
  });

  it("on-premises can too (it is outside AWS)", () => {
    expect(placeBox("on-premises", { x: 0, y: 0 })).not.toBeNull();
  });

  it("a VPC cannot, and it says where it can go", () => {
    expect(placeBox("vpc", { x: 0, y: 0 })).toBeNull();
    expect(s().alert).toContain("VPC");
    expect(s().alert).toContain("Region");
  });

  it("neither can a subnet", () => {
    expect(placeBox("subnet-private", { x: 0, y: 0 })).toBeNull();
  });

  it("following the hierarchy works", () => {
    expect(placeBox("global", { x: 0, y: 0 })).not.toBeNull();
    expect(placeBox("region", { x: 20, y: 20 })).not.toBeNull();
    expect(placeBox("vpc", { x: 40, y: 40 })).not.toBeNull();
    expect(s().alert).toBeNull();
  });

  it("skipping a level does not", () => {
    placeBox("global", { x: 0, y: 0 });
    // A VPC cannot go straight inside Global (a region is needed)
    expect(placeBox("vpc", { x: 20, y: 20 })).toBeNull();
    expect(s().alert).toContain("cannot go inside");
  });

  it("inside a generic box a level can be skipped (the escape hatch)", () => {
    placeBox("generic", { x: 0, y: 0 });
    expect(placeBox("subnet-private", { x: 20, y: 20 })).not.toBeNull();
  });

  it("a refused placement does not touch the history", () => {
    const before = s().past.length;
    placeBox("vpc", { x: 0, y: 0 });
    expect(s().past.length).toBe(before);
  });

  it("dragging somewhere the hierarchy forbids puts it back", () => {
    placeBox("global", { x: 0, y: 0 });
    const regionId = placeBox("region", { x: 20, y: 20 })!;
    const before = s().nodes.find((n) => n.id === regionId)!.position;

    s().beginNodeDrag(regionId);
    // Try to move it outside Global (onto the bare canvas)
    s().reparentNode(regionId, { x: 3000, y: 3000 }, { commit: false });

    expect(s().nodes.find((n) => n.id === regionId)!.position).toEqual(before);
    expect(s().alert).toContain("cannot sit directly on the canvas");
  });

  it("a style change is judged by the nesting rules too", () => {
    const globalId = placeBox("global", { x: 0, y: 0 })!;
    const regionId = placeBox("region", { x: 20, y: 20 })!;

    // Turning the region into a VPC would no longer fit straight inside Global
    s().changeGroupStyle(regionId, "vpc");
    expect(s().nodes.find((n) => n.id === regionId)!.data.style).toBe("region");
    expect(s().alert).toContain("cannot go inside");

    // A style that fits can be applied
    s().changeGroupStyle(regionId, "generic");
    expect(s().nodes.find((n) => n.id === regionId)!.data.style).toBe(
      "generic",
    );
    expect(globalId).toBeTruthy();
  });

  it("a style change cannot be used to slip past the overlap rule", () => {
    // Generic boxes may overlap; constrained ones may not, so the style being
    // applied has to be judged against the siblings as well.
    const box = (id: string, x: number, style: GroupNodeData["style"]) =>
      ({
        id,
        type: "group",
        position: { x, y: 0 },
        width: 360,
        height: 260,
        data: { ...defaultGroupData(style), label: id },
      }) as ArchNode;
    // A generic box is allowed to sit over its neighbour
    s().replaceGraph(
      [box("g1", 0, "on-premises"), box("g2", 40, "generic")],
      [],
    );

    s().changeGroupStyle("g2", "on-premises");

    expect(s().nodes.find((n) => n.id === "g2")!.data.style).toBe("generic");
    expect(s().alert).toContain("overlap");
  });
});

describe("resource scopes", () => {
  /** Sizes and positions are explicit, so the coordinates under test are obvious. */
  const shape = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => {
    s().onNodesChange([
      {
        id,
        type: "dimensions",
        dimensions: { width, height },
        setAttributes: true,
      },
    ]);
    s().onNodesChange([{ id, type: "position", position: { x, y } }]);
  };

  /**
   * Stack Global -> Region -> VPC -> Subnet.
   * Absolute: global(0,0 1000x700) / region(20,40 900x600) /
   * vpc(40,80 800x500) / subnet(60,120 400x300).
   */
  const buildHierarchy = () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    shape(globalId, 0, 0, 1000, 700);

    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 100, y: 100 })!;
    shape(regionId, 20, 40, 900, 600);

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 200, y: 200 })!;
    shape(vpcId, 20, 40, 800, 500);

    s().setGroupStyle("subnet-private");
    const subnetId = s().addGroupNode({ x: 300, y: 300 })!;
    shape(subnetId, 20, 40, 400, 300);

    return { regionId, vpcId, subnetId };
  };

  /** A point inside the subnet, clear of its border. */
  const inSubnet = { x: 250, y: 270 };
  /** A point inside the VPC but outside the subnet, clear of the borders. */
  const inVpcOnly = { x: 700, y: 300 };

  it("a nested box is created at a size that fits its parent", () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 100, y: 100 })!;

    const size = (id: string) => {
      const node = s().nodes.find((n) => n.id === id)!;
      return node.width! * node.height!;
    };
    expect(size(regionId)).toBeLessThan(size(globalId));
  });

  it("a zone service goes inside a subnet", () => {
    const { subnetId } = buildHierarchy();
    const id = s().addResourceNode(EC2, inSubnet, "zone");

    expect(id).not.toBeNull();
    expect(s().nodes.find((n) => n.id === id)!.parentId).toBe(subnetId);
  });

  it("a zone service does not go straight inside a VPC", () => {
    buildHierarchy();
    expect(s().addResourceNode(EC2, inVpcOnly, "zone")).toBeNull();
    expect(s().alert).toContain("VPC");
  });

  it("with no scope it goes anywhere", () => {
    buildHierarchy();
    expect(s().addResourceNode(EC2, inVpcOnly, "any")).not.toBeNull();
    expect(s().addResourceNode(EC2, inSubnet)).not.toBeNull();
  });

  it("a region service goes inside a VPC too (common in practice)", () => {
    const { vpcId } = buildHierarchy();
    const id = s().addResourceNode(
      "Architecture/Storage/Amazon-Simple-Storage-Service",
      inVpcOnly,
      "region",
    );

    expect(id).not.toBeNull();
    expect(s().nodes.find((n) => n.id === id)!.parentId).toBe(vpcId);
  });

  it("a global service cannot go inside a subnet, and it says why", () => {
    buildHierarchy();
    const id = s().addResourceNode(
      "Architecture/Security-Identity/AWS-Identity-and-Access-Management",
      inSubnet,
      "global",
    );

    expect(id).toBeNull();
    expect(s().alert).toContain("cannot go inside");
    expect(s().alert).toContain("AWS Account");
  });
});

describe("minimum gap between boxes", () => {
  const sizeTo = (id: string, width: number, height: number) =>
    s().onNodesChange([
      {
        id,
        type: "dimensions",
        dimensions: { width, height },
        setAttributes: true,
      },
    ]);
  const moveTo = (id: string, x: number, y: number) =>
    s().onNodesChange([{ id, type: "position", position: { x, y } }]);

  it("a new box cannot go where it would overlap one at the same level", () => {
    s().setGroupStyle("global");
    const outer = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(outer, 1000, 700);
    moveTo(outer, 0, 0);

    s().setGroupStyle("region");
    const first = s().addGroupNode({ x: 100, y: 100 })!;
    sizeTo(first, 600, 400);
    moveTo(first, 20, 40);

    // Outside the first one, but the default size would still overlap
    const second = s().addGroupNode({ x: 10, y: 300 });
    expect(second).toBeNull();
    expect(s().alert).toContain("overlap another box");
  });

  it("far enough away it can be placed", () => {
    s().setGroupStyle("global");
    const outer = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(outer, 1000, 700);
    moveTo(outer, 0, 0);

    s().setGroupStyle("region");
    const first = s().addGroupNode({ x: 50, y: 50 })!;
    sizeTo(first, 200, 150);
    moveTo(first, 20, 40);

    expect(s().addGroupNode({ x: 600, y: 400 })).not.toBeNull();
    expect(s().alert).toBeNull();
  });

  it("dragging onto a sibling puts it back", () => {
    s().setGroupStyle("global");
    const outer = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(outer, 1000, 700);
    moveTo(outer, 0, 0);

    s().setGroupStyle("region");
    const a = s().addGroupNode({ x: 50, y: 60 })!;
    sizeTo(a, 200, 150);
    moveTo(a, 20, 40);
    const b = s().addGroupNode({ x: 600, y: 400 })!;
    sizeTo(b, 200, 150);
    moveTo(b, 600, 400);

    const before = s().nodes.find((n) => n.id === b)!.position;
    s().beginNodeDrag(b);
    // Move it so it does not enter a, but the rectangles still overlap
    moveTo(b, 100, 185);
    s().reparentNode(b, { x: 108, y: 193 }, { commit: false });

    expect(s().nodes.find((n) => n.id === b)!.position).toEqual(before);
    expect(s().alert).toContain("overlap another box");
  });

  it("with no other box it moves freely", () => {
    s().setGroupStyle("global");
    const only = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(only, 400, 300);
    moveTo(only, 0, 0);

    s().beginNodeDrag(only);
    moveTo(only, 500, 400);
    s().reparentNode(only, { x: 508, y: 408 }, { commit: false });

    // It must never test against itself
    expect(s().alert).toBeNull();
    expect(s().nodes.find((n) => n.id === only)!.position).toEqual({
      x: 500,
      y: 400,
    });
  });

  it("with siblings, it still moves to a spot that does not overlap", () => {
    s().setGroupStyle("global");
    const outer = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(outer, 1200, 800);
    moveTo(outer, 0, 0);

    s().setGroupStyle("region");
    const a = s().addGroupNode({ x: 50, y: 60 })!;
    sizeTo(a, 200, 150);
    moveTo(a, 20, 40);
    const b = s().addGroupNode({ x: 700, y: 500 })!;
    sizeTo(b, 200, 150);
    moveTo(b, 700, 500);

    s().beginNodeDrag(b);
    moveTo(b, 600, 400);
    s().reparentNode(b, { x: 608, y: 408 }, { commit: false });

    expect(s().alert).toBeNull();
    expect(s().nodes.find((n) => n.id === b)!.position).toEqual({
      x: 600,
      y: 400,
    });
    expect(a).toBeTruthy();
  });

  it("it cannot go past the parent's inset", () => {
    s().setGroupStyle("global");
    const outer = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(outer, 400, 300);
    moveTo(outer, 0, 0);

    s().setGroupStyle("region");
    const inner = s().addGroupNode({ x: 0, y: 0 })!;
    const node = s().nodes.find((n) => n.id === inner)!;

    // The top-left is pushed in by the inset
    expect(node.position.x).toBeGreaterThanOrEqual(10);
    expect(node.position.y).toBeGreaterThanOrEqual(10);
  });
});

describe("a VPC crossing an AZ", () => {
  const sizeTo = (id: string, width: number, height: number) =>
    s().onNodesChange([
      {
        id,
        type: "dimensions",
        dimensions: { width, height },
        setAttributes: true,
      },
    ]);
  const moveTo = (id: string, x: number, y: number) =>
    s().onNodesChange([{ id, type: "position", position: { x, y } }]);

  /** Prepare Global -> Region and return the region's id. */
  const regionCanvas = () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(globalId, 1400, 900);
    moveTo(globalId, 0, 0);

    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 100, y: 100 })!;
    sizeTo(regionId, 1200, 700);
    moveTo(regionId, 40, 60);
    return regionId;
  };

  it("a VPC and an AZ both go straight inside a region", () => {
    const regionId = regionCanvas();

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 200, y: 400 })!;
    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 900, y: 200 })!;

    expect(s().nodes.find((n) => n.id === vpcId)!.parentId).toBe(regionId);
    expect(s().nodes.find((n) => n.id === azId)!.parentId).toBe(regionId);
    expect(s().alert).toBeNull();
  });

  it("a VPC and an AZ may overlap", () => {
    regionCanvas();

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 200, y: 400 })!;
    sizeTo(vpcId, 600, 200);
    moveTo(vpcId, 100, 300);

    // Put the AZ band where it overlaps the VPC
    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 300, y: 200 })!;
    expect(azId).not.toBeNull();

    s().beginNodeDrag(azId!);
    moveTo(azId!, 200, 250);
    s().reparentNode(azId!, { x: 248, y: 318 }, { commit: false });

    expect(s().alert).toBeNull();
    expect(s().nodes.find((n) => n.id === azId)!.position).toEqual({
      x: 200,
      y: 250,
    });
  });

  it("two boxes of the same style still may not overlap", () => {
    regionCanvas();

    s().setGroupStyle("az");
    const a = s().addGroupNode({ x: 200, y: 200 })!;
    sizeTo(a, 300, 400);
    moveTo(a, 100, 100);

    const b = s().addGroupNode({ x: 900, y: 500 })!;
    sizeTo(b, 300, 400);
    moveTo(b, 800, 500);

    s().beginNodeDrag(b);
    moveTo(b, 120, 120);
    s().reparentNode(b, { x: 168, y: 188 }, { commit: false });

    expect(s().alert).toContain("overlap another box");
  });

  it("a VPC placed on an AZ band joins the region, not the AZ", () => {
    const regionId = regionCanvas();

    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 200, y: 200 })!;
    sizeTo(azId, 400, 500);
    moveTo(azId, 100, 100);

    // Point inside the AZ band and place a VPC
    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 250, y: 300 });

    expect(vpcId).not.toBeNull();
    // An AZ cannot be a VPC's parent, so the region one level out becomes the parent
    expect(s().nodes.find((n) => n.id === vpcId)!.parentId).toBe(regionId);
    expect(s().alert).toBeNull();
  });

  it("the classic nesting - an AZ inside a VPC - still works", () => {
    regionCanvas();

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 200, y: 200 })!;
    sizeTo(vpcId, 600, 400);
    moveTo(vpcId, 100, 100);

    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 300, y: 300 });

    expect(s().nodes.find((n) => n.id === azId)!.parentId).toBe(vpcId);
  });
});

describe("dragging a VPC onto an AZ band", () => {
  const sizeTo = (id: string, width: number, height: number) =>
    s().onNodesChange([
      {
        id,
        type: "dimensions",
        dimensions: { width, height },
        setAttributes: true,
      },
    ]);
  const moveTo = (id: string, x: number, y: number) =>
    s().onNodesChange([{ id, type: "position", position: { x, y } }]);

  /** Prepare Global -> Region with one AZ band inside it. */
  const regionWithBand = () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(globalId, 1400, 900);
    moveTo(globalId, 0, 0);

    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 100, y: 100 })!;
    sizeTo(regionId, 1200, 700);
    moveTo(regionId, 40, 60);

    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 300, y: 200 })!;
    sizeTo(azId, 300, 500);
    moveTo(azId, 200, 100);

    return { regionId, azId };
  };

  it("dragging a VPC onto an AZ band keeps it in the region, in place", () => {
    const { regionId } = regionWithBand();

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 900, y: 500 })!;
    sizeTo(vpcId, 600, 200);
    moveTo(vpcId, 700, 500);

    s().beginNodeDrag(vpcId);
    // Move it so the VPC's top-left lands inside the AZ band (region-relative x 200..500)
    moveTo(vpcId, 250, 200);
    s().reparentNode(vpcId, { x: 298, y: 268 }, { commit: false });

    const node = s().nodes.find((n) => n.id === vpcId)!;
    // It does not become the AZ's child; it stays the region's
    expect(node.parentId).toBe(regionId);
    // And it does not jump
    expect(node.position).toEqual({ x: 250, y: 200 });
    expect(s().alert).toBeNull();
  });

  it("the other way round, an AZ dragged onto a VPC becomes its child (the classic nesting)", () => {
    regionWithBand();

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 900, y: 400 })!;
    sizeTo(vpcId, 500, 400);
    moveTo(vpcId, 700, 300);

    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 1000, y: 500 });
    expect(s().nodes.find((n) => n.id === azId)!.parentId).toBe(vpcId);
  });
});

describe("dragging an AZ onto a VPC", () => {
  const sizeTo = (id: string, width: number, height: number) =>
    s().onNodesChange([
      {
        id,
        type: "dimensions",
        dimensions: { width, height },
        setAttributes: true,
      },
    ]);
  const moveTo = (id: string, x: number, y: number) =>
    s().onNodesChange([{ id, type: "position", position: { x, y } }]);

  /** Region(abs 40,60 / 1200x700) with a VPC(abs 440,160 / 400x400) inside. */
  const setup = () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(globalId, 1400, 900);
    moveTo(globalId, 0, 0);

    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 100, y: 100 })!;
    sizeTo(regionId, 1200, 700);
    moveTo(regionId, 40, 60);

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 500, y: 250 })!;
    sizeTo(vpcId, 400, 400);
    moveTo(vpcId, 400, 100);

    return { regionId, vpcId };
  };

  it("approaching from the right, it is not swallowed by the VPC and keeps its place", () => {
    const { regionId } = setup();

    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 200, y: 250 })!;
    sizeTo(azId, 200, 500);
    moveTo(azId, 100, 100);

    // Move right until the top-left lands inside the VPC (region-relative 400..800)
    s().beginNodeDrag(azId);
    moveTo(azId, 450, 120);
    s().reparentNode(azId, { x: 498, y: 188 }, { commit: false });

    const node = s().nodes.find((n) => n.id === azId)!;
    expect(node.parentId).toBe(regionId);
    expect(node.position).toEqual({ x: 450, y: 120 });
    expect(s().alert).toBeNull();
  });

  it("the result matches approaching from the left (direction does not change it)", () => {
    const { regionId } = setup();

    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 1000, y: 250 })!;
    sizeTo(azId, 200, 500);
    moveTo(azId, 900, 100);

    // Move right to left onto the VPC
    s().beginNodeDrag(azId);
    moveTo(azId, 450, 120);
    s().reparentNode(azId, { x: 498, y: 188 }, { commit: false });

    const node = s().nodes.find((n) => n.id === azId)!;
    expect(node.parentId).toBe(regionId);
    expect(node.position).toEqual({ x: 450, y: 120 });
  });

  it("an AZ created inside a VPC stays its child while moved inside it", () => {
    const { vpcId } = setup();

    // Pointing inside the VPC when creating it does nest it
    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 500, y: 250 })!;
    expect(s().nodes.find((n) => n.id === azId)!.parentId).toBe(vpcId);

    s().beginNodeDrag(azId);
    moveTo(azId, 40, 40);
    // VPC-relative (40,40) -> absolute (480,200)
    s().reparentNode(azId, { x: 488, y: 208 }, { commit: false });

    expect(s().nodes.find((n) => n.id === azId)!.parentId).toBe(vpcId);
  });

  it("moving that AZ out puts it back in the region", () => {
    const { regionId, vpcId } = setup();

    s().setGroupStyle("az");
    const azId = s().addGroupNode({ x: 500, y: 250 })!;
    expect(s().nodes.find((n) => n.id === azId)!.parentId).toBe(vpcId);

    s().beginNodeDrag(azId);
    // Outside the VPC (region-relative 100,500 -> absolute 140,560)
    moveTo(azId, 100, 500);
    s().reparentNode(azId, { x: 148, y: 568 }, { commit: false });

    expect(s().nodes.find((n) => n.id === azId)!.parentId).toBe(regionId);
  });
});

describe("dragging onto a generic box", () => {
  const sizeTo = (id: string, width: number, height: number) =>
    s().onNodesChange([
      {
        id,
        type: "dimensions",
        dimensions: { width, height },
        setAttributes: true,
      },
    ]);
  const moveTo = (id: string, x: number, y: number) =>
    s().onNodesChange([{ id, type: "position", position: { x, y } }]);

  /** Region(abs 60,60 / 1400x800) with a generic box(abs 560,360 / 400x300). */
  const setup = () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(globalId, 1600, 1000);
    moveTo(globalId, 0, 0);

    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 200, y: 200 })!;
    sizeTo(regionId, 1400, 800);
    moveTo(regionId, 60, 60);

    s().setGroupStyle("generic");
    const genericId = s().addGroupNode({ x: 700, y: 400 })!;
    sizeTo(genericId, 400, 300);
    moveTo(genericId, 500, 300);

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 300, y: 700 })!;
    sizeTo(vpcId, 300, 200);
    moveTo(vpcId, 100, 600);

    return { regionId, genericId, vpcId };
  };

  /** Move to a region-relative position and settle on the representative point (top-left +8). */
  const dragTo = (id: string, x: number, y: number) => {
    s().beginNodeDrag(id);
    moveTo(id, x, y);
    s().reparentNode(id, { x: 60 + x + 8, y: 60 + y + 8 }, { commit: false });
  };

  it.each([
    ["from the left (top-left outside the generic box)", 400, 500],
    ["from the right (top-left inside it)", 700, 500],
    ["from above (top-left outside it)", 600, 250],
    ["from below (top-left inside it)", 600, 550],
  ])(
    "%s: the parent does not change and the position holds",
    (_label, x, y) => {
      const { regionId, vpcId } = setup();
      dragTo(vpcId, x as number, y as number);

      const node = s().nodes.find((n) => n.id === vpcId)!;
      // Not swallowed by the generic box (the approach direction changes nothing)
      expect(node.parentId).toBe(regionId);
      expect(node.position).toEqual({ x, y });
      expect(s().alert).toBeNull();
    },
  );

  it("a generic box itself moves anywhere (in and out)", () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(globalId, 1600, 1000);
    moveTo(globalId, 0, 0);

    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 200, y: 200 })!;
    sizeTo(regionId, 800, 600);
    moveTo(regionId, 60, 60);

    // Put a generic box outside the region (straight inside Global)
    s().setGroupStyle("generic");
    const genericId = s().addGroupNode({ x: 1200, y: 800 })!;
    sizeTo(genericId, 200, 150);
    moveTo(genericId, 1200, 800);
    expect(s().nodes.find((n) => n.id === genericId)!.parentId).toBe(globalId);

    // Into the region
    s().beginNodeDrag(genericId);
    moveTo(genericId, 300, 300);
    s().reparentNode(genericId, { x: 308, y: 308 }, { commit: false });
    expect(s().nodes.find((n) => n.id === genericId)!.parentId).toBe(regionId);
    expect(s().alert).toBeNull();

    // And out again
    s().beginNodeDrag(genericId);
    moveTo(genericId, 1100, 800);
    s().reparentNode(
      genericId,
      { x: 60 + 1100 + 8, y: 60 + 800 + 8 },
      { commit: false },
    );
    expect(s().nodes.find((n) => n.id === genericId)!.parentId).toBe(globalId);
    expect(s().alert).toBeNull();
  });

  it("when only a generic box can hold it, it becomes the child", () => {
    s().setGroupStyle("global");
    const globalId = s().addGroupNode({ x: 0, y: 0 })!;
    sizeTo(globalId, 1600, 1000);
    moveTo(globalId, 0, 0);

    // A generic box straight inside Global. A VPC can only go here
    s().setGroupStyle("generic");
    const genericId = s().addGroupNode({ x: 400, y: 400 })!;
    sizeTo(genericId, 600, 400);
    moveTo(genericId, 400, 400);

    s().setGroupStyle("vpc");
    const vpcId = s().addGroupNode({ x: 500, y: 500 })!;
    expect(s().nodes.find((n) => n.id === vpcId)!.parentId).toBe(genericId);
    expect(globalId).toBeTruthy();
  });

  it("a box created inside a generic box stays its child while moved inside it", () => {
    const { genericId } = setup();

    // Point inside the generic box when creating it
    s().setGroupStyle("vpc");
    const innerId = s().addGroupNode({ x: 700, y: 450 })!;
    expect(s().nodes.find((n) => n.id === innerId)!.parentId).toBe(genericId);

    s().beginNodeDrag(innerId);
    moveTo(innerId, 60, 60);
    // Generic-relative (60,60) -> absolute (620,420)
    s().reparentNode(innerId, { x: 628, y: 428 }, { commit: false });

    expect(s().nodes.find((n) => n.id === innerId)!.parentId).toBe(genericId);
  });
});

describe("an icon attribute changed in the palette", () => {
  /**
   * The attribute lives in the palette (the catalog store) and is read on every placement.
   * This checks the link: it applies to the next placement the moment it changes.
   */
  const icon = {
    key: EC2,
    group: "Architecture",
    category: "Compute",
    label: "Amazon EC2",
    path: "/icons/ec2.svg",
    aliases: [],
    resourceTypes: [],
  };

  const dropIntoRegion = () => {
    s().setGroupStyle("global");
    s().addGroupNode({ x: 0, y: 0 });
    s().setGroupStyle("region");
    const regionId = s().addGroupNode({ x: 20, y: 20 })!;

    const scope = useCatalogStore.getState().scopeFor(EC2);
    const id = s().addResourceNode(EC2, { x: 120, y: 120 }, scope);
    return { regionId, id };
  };

  beforeEach(() => {
    useCatalogStore.setState({
      icons: [icon as never],
      byKey: new Map([[EC2, icon as never]]),
      scopeOverrides: new Map(),
      status: "ready",
    });
  });

  it("with no attribute it goes inside a region", () => {
    const { regionId, id } = dropIntoRegion();

    expect(id).not.toBeNull();
    expect(s().nodes.find((n) => n.id === id)?.parentId).toBe(regionId);
  });

  it("set to Zone, the same spot is refused", () => {
    useCatalogStore.setState({ scopeOverrides: new Map([[EC2, "zone"]]) });
    const { id } = dropIntoRegion();

    expect(id).toBeNull();
    expect(s().alert).toContain("cannot");
  });

  it("back to no attribute, it works again", () => {
    useCatalogStore.setState({ scopeOverrides: new Map([[EC2, "zone"]]) });
    dropIntoRegion();
    useEditorStore.getState().newDiagram();
    useCatalogStore.setState({ scopeOverrides: new Map() });

    expect(dropIntoRegion().id).not.toBeNull();
  });
});

describe("New", () => {
  it("does not carry the check results over", () => {
    // The previous diagram's errors and warnings used to stay in the bottom-right
    makeBox();
    s().addResourceNode(EC2, inBox());
    s().runValidation([{ key: EC2 }]);
    expect(s().issues.length).toBeGreaterThan(0);

    s().newDiagram();
    expect(s().issues).toEqual([]);
  });

  it("empties the diagram and the history too", () => {
    makeBox();
    s().newDiagram();

    expect(s().nodes).toEqual([]);
    expect(s().past).toEqual([]);
    expect(s().dirty).toBe(false);
  });
});

describe("gaps found in an external review", () => {
  it("a line cannot start and end on the same node", () => {
    const boxId = makeBox();
    s().onConnect({
      source: boxId,
      target: boxId,
      sourceHandle: "l",
      targetHandle: "r",
    });

    expect(s().edges).toHaveLength(0);
    expect(s().alert).toContain("same node");
  });

  it("a box cannot go inside a box that is too small", () => {
    // A generic box is exempt from the rules, so use a styled one
    s().setGroupStyle("global");
    const parent = s().addGroupNode({ x: 0, y: 0 })!;
    // Shrink it so the 30px insets leave no room for the minimum size (120x80)
    useEditorStore.setState({
      nodes: s().nodes.map((n) =>
        n.id === parent ? { ...n, width: 140, height: 100 } : n,
      ),
    });
    s().setGroupStyle("account");

    const before = s().nodes.length;
    s().addGroupNode({ x: 40, y: 40 });

    expect(s().nodes).toHaveLength(before);
    expect(s().alert).toContain("too small");
  });

  it("a resize can be undone", () => {
    const boxId = makeBox();
    const before = s().nodes.find((n) => n.id === boxId)!.width;

    s().onNodesChange([
      {
        id: boxId,
        type: "dimensions",
        resizing: true,
        dimensions: { width: 500, height: 400 },
      },
    ]);
    s().onNodesChange([
      {
        id: boxId,
        type: "dimensions",
        resizing: false,
        dimensions: { width: 500, height: 400 },
      },
    ]);
    expect(s().dirty).toBe(true);

    s().undo();
    expect(s().nodes.find((n) => n.id === boxId)!.width).toBe(before);
  });

  it("undoing auto layout restores layout.mode too", async () => {
    makeBox();
    useEditorStore.setState({ layout: { ...s().layout, mode: "auto" } });

    await s().applyAutoLayout();
    expect(s().layout.mode).toBe("manual");

    s().undo();
    expect(s().layout.mode).toBe("auto");
  });

  it("a check runs after auto layout", async () => {
    makeBox();
    s().addResourceNode(EC2, inBox());
    useEditorStore.setState({ issues: [] });

    await s().applyAutoLayout();
    // There is an unlinked icon, so there should be findings
    expect(s().issues.length).toBeGreaterThan(0);
  });

  it("loading raises the flag that restores the viewport", () => {
    const before = s().loadedAt!;
    s().loadDiagram(s().toDiagram());
    expect(s().loadedAt).toBeGreaterThan(before);
  });
});

it("keyboard movement is one undoable edit", () => {
  const id = s().addTextNode({ x: 100, y: 100 });
  useEditorStore.setState({ dirty: false, past: [] });
  s().moveSelection({ x: 5, y: 0 });
  expect(s().nodes.find((n) => n.id === id)!.position).toEqual({
    x: 105,
    y: 100,
  });
  expect(s().dirty).toBe(true);
  expect(s().past).toHaveLength(1);
  s().undo();
  expect(s().nodes.find((n) => n.id === id)!.position).toEqual({
    x: 100,
    y: 100,
  });
});
it("deleting a node and its selected edge is a single undo step", () => {
  const a = makeBox();
  const b = s().addShapeNode({ x: 500, y: 0 });
  s().onConnect({
    source: a,
    target: b,
    sourceHandle: null,
    targetHandle: null,
  });
  useEditorStore.setState({
    nodes: s().nodes.map((n) => ({ ...n, selected: n.id === a })),
    edges: s().edges.map((e) => ({ ...e, selected: true })),
    past: [],
  });
  s().deleteSelected();
  expect(s().past).toHaveLength(1);
  s().undo();
  expect(s().nodes).toHaveLength(2);
  expect(s().edges).toHaveLength(1);
});
it("New requests a fresh viewport even within the same millisecond", () => {
  const before = s().loadedAt!;
  s().setViewport({ x: 500, y: 600, zoom: 0.5 });
  s().newDiagram();
  expect(s().loadedAt).toBeGreaterThan(before);
  expect(s().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
});
it("rejects style changes that would clip existing children", () => {
  s().loadDiagram({
    ...s().toDiagram(),
    nodes: [
      {
        id: "p",
        type: "group",
        position: { x: 0, y: 0 },
        size: { width: 200, height: 200 },
        data: defaultGroupData("generic"),
      },
      {
        id: "c",
        type: "group",
        parentId: "p",
        position: { x: 0, y: 0 },
        size: { width: 300, height: 300 },
        data: defaultGroupData("region"),
      },
    ],
  } as Diagram);
  s().changeGroupStyle("p", "global");
  expect(s().nodes[0]!.data.style).toBe("generic");
  expect(s().alert).toContain("fit");
});

it("refuses reparenting a box into a smaller container using its real dimensions", () => {
  s().loadDiagram({
    ...s().toDiagram(),
    nodes: [
      {
        id: "large",
        type: "group",
        position: { x: 1000, y: 0 },
        size: { width: 1000, height: 800 },
        data: defaultGroupData("global"),
      },
      {
        id: "small",
        type: "group",
        position: { x: 0, y: 0 },
        size: { width: 300, height: 300 },
        data: defaultGroupData("global"),
      },
      {
        id: "moving",
        type: "group",
        parentId: "large",
        position: { x: 50, y: 50 },
        size: { width: 600, height: 150 },
        data: defaultGroupData("account"),
      },
    ],
  } as Diagram);
  s().beginNodeDrag("moving");
  s().onNodesChange([
    { id: "moving", type: "position", position: { x: -950, y: 50 } },
  ]);
  s().reparentNode("moving", { x: 58, y: 58 }, { commit: false });
  expect(s().nodes.find((n) => n.id === "moving")).toMatchObject({
    parentId: "large",
    position: { x: 50, y: 50 },
    width: 600,
  });
  expect(s().alert).toBeTruthy();
});
