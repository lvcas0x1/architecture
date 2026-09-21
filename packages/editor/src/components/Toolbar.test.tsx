import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "../store/editor.js";
import { Toolbar } from "./Toolbar.js";

const noop = () => {};

beforeEach(() => {
  useEditorStore.getState().newDiagram();
  // The box style is a tool setting kept across diagrams, so reset it per test
  useEditorStore.getState().setGroupStyle("generic");
});
afterEach(cleanup);

const renderToolbar = (over: Partial<Parameters<typeof Toolbar>[0]> = {}) =>
  render(
    <Toolbar
      onSave={noop}
      onOpen={noop}
      onNew={noop}
      onExport={noop}
      onAutoLayout={noop}
      {...over}
    />,
  );

describe("the toolbar", () => {
  it("switches tools", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText("Box"));
    expect(useEditorStore.getState().tool).toBe("box");
  });

  it("marks the active tool with aria-pressed", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText("Line"));
    expect(screen.getByLabelText("Line").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Select").getAttribute("aria-pressed")).toBe("false");
  });

  it("changes the line style and the arrows", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByTitle("Line style: Dashed"));
    await user.click(screen.getByTitle("Arrow: Both"));

    expect(useEditorStore.getState().edgeStyle.line).toBe("dashed");
    expect(useEditorStore.getState().edgeStyle.arrow).toBe("both");
  });

  it("the style picker appears only with the box tool", async () => {
    const user = userEvent.setup();
    renderToolbar();
    expect(screen.queryByLabelText("Box type")).toBeNull();

    await user.click(screen.getByLabelText("Box"));
    expect(screen.getByLabelText("Box type")).toBeTruthy();
  });

  it("a box preset can be picked", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText("Box"));
    await user.click(screen.getByLabelText("Box type"));
    await user.click(screen.getByRole("option", { name: "VPC" }));

    expect(useEditorStore.getState().groupStyle).toBe("vpc");
  });

  it("the list opens downwards", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText("Box"));

    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(screen.getByLabelText("Box type"));

    const list = screen.getByRole("listbox");
    expect(list.className).toContain("top-full");
  });

  it("style names are the official AWS group names", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText("Box"));
    await user.click(screen.getByLabelText("Box type"));

    for (const name of ["AWS Cloud", "Region", "VPC", "Availability Zone", "Public subnet"]) {
      expect(screen.getByRole("option", { name })).toBeTruthy();
    }
  });

  it("styles are ordered by nesting depth (outermost first)", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByLabelText("Box"));
    await user.click(screen.getByLabelText("Box type"));

    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    const at = (label: string) => names.findIndex((n) => n.includes(label));
    expect(at("AWS Cloud")).toBeLessThan(at("Region"));
    expect(at("Region")).toBeLessThan(at("VPC"));
    expect(at("VPC")).toBeLessThan(at("Availability Zone"));
    expect(at("Availability Zone")).toBeLessThan(at("Public subnet"));
  });

  it("undo and redo are disabled with an empty history", () => {
    renderToolbar();
    expect(screen.getByText("Undo").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Redo").hasAttribute("disabled")).toBe(true);
  });

  it("undo becomes available after an edit", async () => {
    const user = userEvent.setup();
    renderToolbar();
    // Also checks that a change made through the store reaches the toolbar
    act(() => {
      useEditorStore.getState().addGroupNode({ x: 0, y: 0 });
    });

    expect(screen.getByText("Undo").hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByText("Undo"));
    expect(useEditorStore.getState().nodes).toHaveLength(0);
  });

  it("the title can be edited", async () => {
    const user = userEvent.setup();
    renderToolbar();
    const input = screen.getByLabelText("Diagram title");
    await user.clear(input);
    await user.type(input, "production");
    expect(useEditorStore.getState().meta.title).toBe("production");
  });

  it("Save / Open / New / Export HTML call their handlers", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onOpen = vi.fn();
    const onNew = vi.fn();
    const onExport = vi.fn();
    renderToolbar({ onSave, onOpen, onNew, onExport });

    await user.click(screen.getByText("Save"));
    await user.click(screen.getByText("Open"));
    await user.click(screen.getByText("New"));
    await user.click(screen.getByText("Export HTML"));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onNew).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("the unsaved marker appears", () => {
    useEditorStore.getState().addGroupNode({ x: 0, y: 0 });
    renderToolbar();
    expect(screen.getByTitle("Unsaved changes")).toBeTruthy();
  });
});

describe("telling the tools apart", () => {
  it("the select tool shows a hand, not an arrow", () => {
    renderToolbar();
    const select = screen.getByLabelText("Select");

    // An arrow glyph is too close to the line tool's, so it is not used
    expect(select.textContent).not.toContain("↖");
    expect(select.querySelector("svg")).toBeTruthy();
  });

  it("the box tool shows a square icon", () => {
    renderToolbar();
    const box = screen.getByLabelText("Box");

    // The wide glyph did not match the box it places
    expect(box.textContent).not.toContain("▭");
    const rect = box.querySelector("rect");
    expect(rect?.getAttribute("width")).toBe(rect?.getAttribute("height"));
  });

  it("it is a different shape from the line tool", () => {
    renderToolbar();

    expect(screen.getByLabelText("Line").textContent).toContain("↗");
    expect(screen.getByLabelText("Select").textContent).not.toContain("↗");
  });
});
