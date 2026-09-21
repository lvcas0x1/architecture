import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchNode } from "../lib/types.js";
import { NodeContextMenu } from "./NodeContextMenu.js";

const resourceNode = (resourceRef: string | null): ArchNode =>
  ({
    id: "n1",
    type: "resource",
    position: { x: 0, y: 0 },
    data: { iconKey: "Architecture/Compute/Amazon-EC2", resourceRef, origin: "user" },
  }) as ArchNode;

const textNode = (): ArchNode =>
  ({
    id: "t1",
    type: "text",
    position: { x: 0, y: 0 },
    data: { text: "note", origin: "user" },
  }) as ArchNode;

const groupNode = (): ArchNode =>
  ({
    id: "g1",
    type: "group",
    position: { x: 0, y: 0 },
    data: { label: "vpc", style: "vpc", origin: "user" },
  }) as ArchNode;

const handlers = () => ({
  onClose: vi.fn(),
  onConfigure: vi.fn(),
  onRefresh: vi.fn(),
  onShowParameters: vi.fn(),
  onUnbind: vi.fn(),
  onRename: vi.fn(),
  onSetTextColor: vi.fn(),
  onSetFontSize: vi.fn(),
  onSetFillColor: vi.fn(),
  onSetFillOpacity: vi.fn(),
  onChangeGroupStyle: vi.fn(),
  onDelete: vi.fn(),
});

const open = (node: ArchNode | undefined, h = handlers()) => {
  render(
    <NodeContextMenu state={{ x: 10, y: 10, nodeId: node?.id ?? "n1" }} node={node} {...h} />,
  );
  return h;
};

afterEach(cleanup);

describe("the right-click menu", () => {
  it("a resource icon offers Configure and Refresh", () => {
    open(resourceNode("arn:aws:ec2:ap-northeast-1:123456789012:instance/i-1"));
    expect(screen.getByRole("menuitem", { name: "Configure" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Refresh" })).toBeTruthy();
  });

  it("Refresh is disabled when nothing is linked", () => {
    open(resourceNode(null));
    expect(screen.getByRole("menuitem", { name: "Refresh" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("menuitem", { name: "Configure" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("Configure asks for the dialog", async () => {
    const user = userEvent.setup();
    const h = open(resourceNode(null));
    await user.click(screen.getByRole("menuitem", { name: "Configure" }));
    expect(h.onConfigure).toHaveBeenCalledOnce();
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it("Refresh re-runs Describe", async () => {
    const user = userEvent.setup();
    const h = open(resourceNode("arn:aws:ec2:ap-northeast-1:123456789012:instance/i-1"));
    await user.click(screen.getByRole("menuitem", { name: "Refresh" }));
    expect(h.onRefresh).toHaveBeenCalledOnce();
  });

  it("Unlink and Delete are there too", async () => {
    const user = userEvent.setup();
    const h = open(resourceNode("arn:aws:ec2:ap-northeast-1:123456789012:instance/i-1"));
    await user.click(screen.getByRole("menuitem", { name: "Unlink resource" }));
    expect(h.onUnbind).toHaveBeenCalledOnce();

    cleanup();
    const h2 = open(resourceNode(null));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(h2.onDelete).toHaveBeenCalledOnce();
  });

  it("a box has no Configure or Refresh (those are resource-only)", () => {
    open(groupNode());
    expect(screen.queryByRole("menuitem", { name: "Configure" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Refresh" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("a box offers Rename", async () => {
    const user = userEvent.setup();
    const h = open(groupNode());
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(h.onRename).toHaveBeenCalledOnce();
  });

  it("text offers Edit text", async () => {
    const user = userEvent.setup();
    const h = open(textNode());
    await user.click(screen.getByRole("menuitem", { name: "Edit text" }));
    expect(h.onRename).toHaveBeenCalledOnce();
  });

  it("a resource icon has no Rename (the resource's own name wins)", () => {
    open(resourceNode(null));
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });

  it("Esc closes it", async () => {
    const user = userEvent.setup();
    const h = open(resourceNode(null));
    await user.keyboard("{Escape}");
    expect(h.onClose).toHaveBeenCalled();
  });

  it("a missing node renders nothing", () => {
    const { container } = render(
      <NodeContextMenu
        state={{ x: 0, y: 0, nodeId: "gone" }}
        node={undefined}
        {...handlers()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("the text colour / size drill-down", () => {
  const colorNode = (over: { labelColor?: string | null } = {}): ArchNode =>
    ({
      id: "g1",
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: "vpc",
        labelColor: over.labelColor ?? null,
        style: "vpc",
        resourceRef: null,
        iconKey: null,
        collapsed: false,
        origin: "user",
      },
    }) as ArchNode;

  const sizedText = (over: { color?: string | null; fontSize?: number } = {}): ArchNode =>
    ({
      id: "t1",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        text: "note",
        fontSize: over.fontSize ?? 14,
        bold: false,
        italic: false,
        color: over.color ?? null,
        align: "left",
        origin: "user",
      },
    }) as ArchNode;

  const openSubmenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole("menuitem", { name }));
  };

  it("a box offers text colour but not text size", () => {
    open(colorNode());
    expect(screen.getByRole("menuitem", { name: "Text color" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Text size" })).toBeNull();
  });

  it("text offers both", () => {
    open(sizedText());
    expect(screen.getByRole("menuitem", { name: "Text color" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Text size" })).toBeTruthy();
  });

  it("a resource icon offers neither (it is drawn from the resource data)", () => {
    open(resourceNode(null));
    expect(screen.queryByRole("menuitem", { name: "Text color" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Text size" })).toBeNull();
  });

  it("seven colours plus Reset to default", async () => {
    const user = userEvent.setup();
    open(colorNode());
    await openSubmenu(user, "Text color");

    const submenu = screen.getByRole("menu", { name: "Text color" });
    const choices = within(submenu).getAllByRole("menuitemradio");
    expect(choices).toHaveLength(8);
    expect(choices.at(-1)!.getAttribute("aria-label")).toBe("Reset to default");
  });

  it("picking a colour passes the hex value", async () => {
    const user = userEvent.setup();
    const h = open(colorNode());
    await openSubmenu(user, "Text color");
    await user.click(screen.getByRole("menuitemradio", { name: "Blue" }));

    expect(h.onSetTextColor).toHaveBeenCalledWith("#3f5bd9");
    expect(h.onClose).toHaveBeenCalled();
  });

  it("Reset to default passes null", async () => {
    const user = userEvent.setup();
    const h = open(colorNode({ labelColor: "#c0504d" }));
    await openSubmenu(user, "Text color");
    await user.click(screen.getByRole("menuitemradio", { name: "Reset to default" }));

    expect(h.onSetTextColor).toHaveBeenCalledWith(null);
  });

  it("the current colour is ticked", async () => {
    const user = userEvent.setup();
    open(colorNode({ labelColor: "#c0504d" }));
    await openSubmenu(user, "Text color");

    expect(screen.getByRole("menuitemradio", { name: "Red" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Blue" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("the current colour's name shows on the parent row", () => {
    open(colorNode({ labelColor: "#7a52c7" }));
    expect(screen.getByRole("menuitem", { name: "Text color" }).textContent).toContain("Purple");
  });

  it("sizes run 7px to 14px, with the default as the largest", async () => {
    const user = userEvent.setup();
    open(sizedText());
    await openSubmenu(user, "Text size");

    const submenu = screen.getByRole("menu", { name: "Text size" });
    const choices = within(submenu).getAllByRole("menuitemradio");
    expect(choices).toHaveLength(8);
    expect(choices[0]!.getAttribute("aria-label")).toBe("7px");
    // Nothing larger than the default is offered
    expect(choices.at(-1)!.getAttribute("aria-label")).toBe("Default (14px)");
    expect(within(submenu).queryByRole("menuitemradio", { name: "15px" })).toBeNull();
  });

  it("picking a size passes the number", async () => {
    const user = userEvent.setup();
    const h = open(sizedText());
    await openSubmenu(user, "Text size");
    await user.click(screen.getByRole("menuitemradio", { name: "10px" }));

    expect(h.onSetFontSize).toHaveBeenCalledWith(10);
  });

  it("the default size can be chosen again", async () => {
    const user = userEvent.setup();
    const h = open(sizedText({ fontSize: 9 }));
    await openSubmenu(user, "Text size");
    await user.click(screen.getByRole("menuitemradio", { name: "Default (14px)" }));

    expect(h.onSetFontSize).toHaveBeenCalledWith(14);
  });

  it("the current size is ticked and shows on the parent row", async () => {
    const user = userEvent.setup();
    open(sizedText({ fontSize: 11 }));

    expect(screen.getByRole("menuitem", { name: "Text size" }).textContent).toContain("11px");
    await openSubmenu(user, "Text size");
    expect(
      screen.getByRole("menuitemradio", { name: "11px" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("the submenu stays closed until it is opened (a drill-down)", () => {
    open(sizedText());
    expect(screen.queryByRole("menu", { name: "Text size" })).toBeNull();
  });
});

describe("the fill colour / opacity drill-down", () => {
  const box = (over: { fillColor?: string | null; fillOpacity?: number | null } = {}): ArchNode =>
    ({
      id: "g1",
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: "vpc",
        labelColor: null,
        fillColor: over.fillColor ?? null,
        fillOpacity: over.fillOpacity ?? null,
        style: "vpc",
        resourceRef: null,
        iconKey: null,
        collapsed: false,
        origin: "user",
      },
    }) as ArchNode;

  const shape = (
    over: { fillColor?: string | null; fillOpacity?: number | null } = {},
  ): ArchNode =>
    ({
      id: "s1",
      type: "shape",
      position: { x: 0, y: 0 },
      data: {
        shape: "rect",
        fillColor: over.fillColor ?? null,
        fillOpacity: over.fillOpacity ?? null,
        stroke: null,
        origin: "user",
      },
    }) as ArchNode;

  const openSub = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole("menuitem", { name }));
  };

  it("a box offers fill colour and opacity", () => {
    open(box());
    expect(screen.getByRole("menuitem", { name: "Fill color" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Opacity" })).toBeTruthy();
  });

  it("a shape offers only the fill items (it holds no text)", () => {
    open(shape());
    expect(screen.getByRole("menuitem", { name: "Fill color" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Opacity" })).toBeTruthy();

    for (const name of ["Rename", "Text color", "Text size"]) {
      expect(screen.queryByRole("menuitem", { name })).toBeNull();
    }
  });

  it("text offers no fill items (it is glyphs only)", () => {
    open(
      {
        id: "t1",
        type: "text",
        position: { x: 0, y: 0 },
        data: { text: "note", fontSize: 14, bold: false, italic: false, color: null, align: "left", origin: "user" },
      } as unknown as ArchNode,
    );
    expect(screen.queryByRole("menuitem", { name: "Fill color" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Opacity" })).toBeNull();
  });

  it("the fill offers the same seven colours plus Reset to default", async () => {
    const user = userEvent.setup();
    open(box());
    await openSub(user, "Fill color");

    const submenu = screen.getByRole("menu", { name: "Fill color" });
    expect(within(submenu).getAllByRole("menuitemradio")).toHaveLength(8);
  });

  it("picking a fill colour passes the hex value", async () => {
    const user = userEvent.setup();
    const h = open(box());
    await openSub(user, "Fill color");
    await user.click(
      within(screen.getByRole("menu", { name: "Fill color" })).getByRole("menuitemradio", {
        name: "Green",
      }),
    );
    expect(h.onSetFillColor).toHaveBeenCalledWith("#2f7d4f");
  });

  it("fill colour is stored separately from text colour", async () => {
    const user = userEvent.setup();
    const h = open(box());
    await openSub(user, "Fill color");
    await user.click(
      within(screen.getByRole("menu", { name: "Fill color" })).getByRole("menuitemradio", {
        name: "Red",
      }),
    );

    expect(h.onSetFillColor).toHaveBeenCalledWith("#c0504d");
    expect(h.onSetTextColor).not.toHaveBeenCalled();
  });

  it("opacity offers nine steps from 10% to 90%, plus Reset to default", async () => {
    const user = userEvent.setup();
    open(box());
    await openSub(user, "Opacity");

    const submenu = screen.getByRole("menu", { name: "Opacity" });
    const choices = within(submenu).getAllByRole("menuitemradio");
    expect(choices).toHaveLength(10);
    expect(choices[0]!.getAttribute("aria-label")).toBe("10%");
    expect(choices[8]!.getAttribute("aria-label")).toBe("90%");
    expect(choices[9]!.getAttribute("aria-label")).toBe("Reset to default");
  });

  it("picking an opacity passes a value between 0 and 1", async () => {
    const user = userEvent.setup();
    const h = open(box());
    await openSub(user, "Opacity");
    await user.click(screen.getByRole("menuitemradio", { name: "40%" }));

    expect(h.onSetFillOpacity).toHaveBeenCalledWith(0.4);
  });

  it("opacity can be reset to the default", async () => {
    const user = userEvent.setup();
    const h = open(box({ fillOpacity: 0.6 }));
    await openSub(user, "Opacity");
    await user.click(
      within(screen.getByRole("menu", { name: "Opacity" })).getByRole("menuitemradio", {
        name: "Reset to default",
      }),
    );
    expect(h.onSetFillOpacity).toHaveBeenCalledWith(null);
  });

  it("the current value shows on the parent row and as a tick", async () => {
    const user = userEvent.setup();
    open(box({ fillColor: "#c2691e", fillOpacity: 0.7 }));

    expect(screen.getByRole("menuitem", { name: "Fill color" }).textContent).toContain("Orange");
    expect(screen.getByRole("menuitem", { name: "Opacity" }).textContent).toContain("70%");

    await openSub(user, "Opacity");
    expect(
      screen.getByRole("menuitemradio", { name: "70%" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a shape passes fill colour and opacity too", async () => {
    const user = userEvent.setup();
    const h = open(shape());
    await openSub(user, "Opacity");
    await user.click(screen.getByRole("menuitemradio", { name: "50%" }));
    expect(h.onSetFillOpacity).toHaveBeenCalledWith(0.5);
  });

  it("a shape still offers Delete", () => {
    open(shape());
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });
});

describe("the menu's padding", () => {
  const box = (): ArchNode =>
    ({
      id: "g1",
      type: "group",
      position: { x: 0, y: 0 },
      data: {
        label: "vpc",
        labelColor: null,
        fillColor: null,
        fillOpacity: null,
        style: "vpc",
        resourceRef: null,
        iconKey: null,
        collapsed: false,
        origin: "user",
      },
    }) as ArchNode;

  it("the bottom padding keeps the last item off the edge", async () => {
    const user = userEvent.setup();
    open(box());

    const root = screen.getByRole("menu", { name: "Node actions" });
    expect(root.className).toContain("pb-2");
    expect(root.className).toContain("pt-1");

    // The same for the submenu that holds Reset to default
    await user.click(screen.getByRole("menuitem", { name: "Fill color" }));
    const submenu = screen.getByRole("menu", { name: "Fill color" });
    expect(submenu.className).toContain("pb-2");
    expect(submenu.className).toContain("pt-1");
  });

  it("no leftover symmetric py", () => {
    open(box());
    const root = screen.getByRole("menu", { name: "Node actions" });
    expect(root.className).not.toContain("py-1 ");
  });

  it("every submenu has the same padding (opacity does not look tighter)", async () => {
    const user = userEvent.setup();
    open(box());

    const classNames: string[] = [];
    for (const name of ["Text color", "Fill color", "Opacity"]) {
      await user.click(screen.getByRole("menuitem", { name }));
      classNames.push(screen.getByRole("menu", { name }).className);
    }
    expect(new Set(classNames).size).toBe(1);
  });

  it("the tallest menu, opacity, still does not scroll", async () => {
    const user = userEvent.setup();
    open(box());
    await user.click(screen.getByRole("menuitem", { name: "Opacity" }));

    const submenu = screen.getByRole("menu", { name: "Opacity" });
    const rows = within(submenu).getAllByRole("menuitemradio").length;
    // 28px rows + 9px separator + 12px padding. It must stay under the limit.
    expect(rows * 28 + 9 + 12).toBeLessThanOrEqual(384);
    expect(submenu.className).toContain("max-h-96");
  });
});
