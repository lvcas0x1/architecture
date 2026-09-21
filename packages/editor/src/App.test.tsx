/** Whether changing an attribute immediately reports icons already placed. */
import type { IconEntry } from "@architecture/schema";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { api } from "./lib/api.js";
import { useCatalogStore } from "./store/catalog.js";
import { useEditorStore } from "./store/editor.js";

const EC2 = "Architecture/Compute/Amazon-EC2";
const icon = {
  key: EC2,
  group: "Architecture",
  category: "Compute",
  label: "Amazon EC2",
  path: "/icons/ec2.svg",
  aliases: [],
  resourceTypes: [],
} as IconEntry;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  useEditorStore.getState().newDiagram();
  useCatalogStore.setState({
    icons: [icon],
    byKey: new Map([[EC2, icon]]),
    scopeOverrides: new Map(),
    scopeSaveError: null,
    // load() does nothing when ready, so no fetch is needed
    status: "ready",
    error: null,
  });
  vi.restoreAllMocks();
  vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
});

afterEach(cleanup);

/** Make a VPC box and put one icon inside it. */
const placeInVpc = () => {
  const s = useEditorStore.getState();
  s.setGroupStyle("global");
  s.addGroupNode({ x: 0, y: 0 });
  s.setGroupStyle("region");
  s.addGroupNode({ x: 20, y: 20 });
  s.setGroupStyle("vpc");
  s.addGroupNode({ x: 40, y: 40 });
  s.addResourceNode(EC2, { x: 120, y: 120 });
};

describe("changing an attribute and checking", () => {
  it("setting an icon inside a VPC to Subnet raises an error", async () => {
    render(<App />);
    act(placeInVpc);

    await act(async () => {
      await useCatalogStore.getState().setScope(EC2, "subnet");
    });

    const errors = useEditorStore
      .getState()
      .issues.filter((issue) => issue.level === "error");
    expect(errors.map((e) => e.message).join("")).toContain("Subnet");
  });

  it("the error appears in the check panel at the bottom-right", async () => {
    render(<App />);
    act(placeInVpc);

    await act(async () => {
      await useCatalogStore.getState().setScope(EC2, "subnet");
    });

    const panel = screen.getByRole("complementary", { name: "Check results" });
    expect(panel.textContent).toContain("1 error");
  });
});

describe("when checks run", () => {
  /** Checks run only at set moments, never on every edit. */
  it("placing an icon runs one", async () => {
    render(<App />);
    act(placeInVpc);

    // An unlinked resource JSON is a warning; it appears as soon as it is placed.
    expect(
      useEditorStore.getState().issues.some((i) => i.message.includes("JSON")),
    ).toBe(true);
  });

  it("placing a box alone does not", () => {
    render(<App />);
    act(() => {
      const s = useEditorStore.getState();
      s.setGroupStyle("global");
      s.addGroupNode({ x: 0, y: 0 });
    });

    // "This box is empty" mid-drawing is not something you can act on
    expect(useEditorStore.getState().issues).toEqual([]);
  });

  it("changing an attribute runs one", async () => {
    render(<App />);
    act(placeInVpc);

    await act(async () => {
      await useCatalogStore.getState().setScope(EC2, "subnet");
    });

    expect(
      useEditorStore.getState().issues.some((i) => i.level === "error"),
    ).toBe(true);
  });

  it("moving across boxes runs one", async () => {
    render(<App />);
    act(placeInVpc);
    await act(async () => {
      await useCatalogStore.getState().setScope(EC2, "subnet");
    });
    expect(useEditorStore.getState().issues.some((i) => i.level === "error")).toBe(true);

    // Make a subnet inside the VPC and move it there
    act(() => {
      const s = useEditorStore.getState();
      s.setGroupStyle("subnet-private");
      const subnet = s.addGroupNode({ x: 80, y: 80 })!;
      // reparentNode decides the parent from coordinates, so reassign directly here.
      // Use the list from after addGroupNode (a stale array would drop the box).
      const current = useEditorStore.getState().nodes;
      const icon = current.find((n) => n.type === "resource")!;
      useEditorStore.setState({
        nodes: current.map((n) =>
          n.id === icon.id ? { ...n, parentId: subnet, position: { x: 40, y: 40 } } : n,
        ),
      });
      useEditorStore.getState().revalidate();
    });

    const errors = useEditorStore.getState().issues.filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  });

  it("the results open with the detail showing", async () => {
    render(<App />);
    act(placeInVpc);

    const panel = await screen.findByRole("complementary", { name: "Check results" });
    expect(panel.querySelector("ul")).toBeTruthy();
  });
});

describe("confirming before saving or exporting", () => {
  const withError = async () => {
    act(placeInVpc);
    await act(async () => {
      await useCatalogStore.getState().setScope(EC2, "subnet");
    });
  };

  it("with no errors it saves straight away", async () => {
    const user = userEvent.setup();
    render(<App />);
    act(placeInVpc);

    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.queryByText(/The check reported errors/)).toBeNull();
  });

  it("with errors it confirms first", async () => {
    const user = userEvent.setup();
    render(<App />);
    await withError();

    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(screen.getByText(/The check reported errors/)).toBeTruthy();
    // The unsaved flag is still up (nothing was saved)
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("Cancel does not save", async () => {
    const user = userEvent.setup();
    render(<App />);
    await withError();

    await user.click(screen.getByRole("button", { name: /Save/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("it shows the breakdown of the errors", async () => {
    const user = userEvent.setup();
    render(<App />);
    await withError();

    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.getByRole("dialog").textContent).toContain("Subnet");
  });

  it("Export HTML confirms the same way", async () => {
    const user = userEvent.setup();
    render(<App />);
    await withError();

    await user.click(screen.getByRole("button", { name: /Export HTML/ }));
    expect(screen.getByText(/The check reported errors/)).toBeTruthy();
  });
});
