import type { IconEntry } from "@architecture/schema";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api.js";
import { useCatalogStore } from "../store/catalog.js";
import { Palette } from "./Palette.js";

const entry = (over: Partial<IconEntry>): IconEntry =>
  ({
    key: "Architecture/Compute/Amazon-EC2",
    group: "Architecture",
    category: "Compute",
    label: "Amazon EC2",
    path: "/icons/ec2.svg",
    aliases: [],
    resourceTypes: [],
    ...over,
  }) as IconEntry;

const EC2 = "Architecture/Compute/Amazon-EC2";
const LAMBDA = "Architecture/Compute/AWS-Lambda";
const ICONS = [entry({}), entry({ key: LAMBDA, label: "AWS Lambda" })];

beforeEach(() => {
  useCatalogStore.setState({
    icons: ICONS,
    byKey: new Map(ICONS.map((i) => [i.key, i])),
    scopeOverrides: new Map(),
    scopesLoaded: true,
    scopeEdits: new Map(),
    scopeSaveError: null,
    isPlaceholder: false,
    status: "ready",
    error: null,
  });
  vi.restoreAllMocks();
  vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
});

afterEach(cleanup);

/** Open the category (or leave it open) and right-click the icon. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, label = /Amazon EC2/) {
  if (!screen.queryByTitle(label)) {
    await user.click(screen.getByRole("button", { name: /Compute/ }));
  }
  await user.pointer({ keys: "[MouseRight]", target: screen.getByTitle(label) });
}

describe("the icon attribute menu", () => {
  it("right-click opens it and names the icon", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);

    expect(screen.getByRole("menu", { name: "Amazon EC2 attribute" })).toBeTruthy();
  });

  it("offers six attributes", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);

    for (const label of ["Global", "Region", "VPC", "Availability Zone", "Subnet", "No attribute"]) {
      expect(screen.getByRole("menuitemradio", { name: label })).toBeTruthy();
    }
  });

  it("no attribute is ticked by default", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);

    expect(
      screen.getByRole("menuitemradio", { name: "No attribute" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("the tick moves to what was chosen", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "Availability Zone" }));

    await openMenu(user);
    expect(
      screen
        .getByRole("menuitemradio", { name: "Availability Zone" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("choosing one changes the attribute immediately", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "Subnet" }));

    expect(useCatalogStore.getState().scopeFor(EC2)).toBe("subnet");
  });

  it("choosing one closes the menu", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "Subnet" }));

    expect(screen.queryByRole("menu", { name: "Amazon EC2 attribute" })).toBeNull();
  });

  it("it can go back to no attribute", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "Global" }));

    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "No attribute" }));
    expect(useCatalogStore.getState().scopeFor(EC2)).toBe("any");
  });

  it("it also says where the icon becomes placeable", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);

    const subnet = screen.getByRole("menuitemradio", { name: "Subnet" });
    expect(subnet.textContent).toContain("Public subnet");
  });

  it("Esc closes it", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu", { name: "Amazon EC2 attribute" })).toBeNull();
  });

  it("every icon can be set the same way", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user, /AWS Lambda/);
    await user.click(screen.getByRole("menuitemradio", { name: "Region" }));

    expect(useCatalogStore.getState().scopeFor(LAMBDA)).toBe("region");
  });

  it("the attribute shows in the icon's tooltip too", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "Availability Zone" }));

    expect(screen.getByTitle(/Amazon EC2/).getAttribute("title")).toContain(
      "Attribute: Availability Zone",
    );
  });

  it("only icons with an attribute get a marker", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.click(screen.getByRole("button", { name: /Compute/ }));
    expect(screen.getByTitle(/Amazon EC2/).textContent).not.toContain("AZ");

    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "Availability Zone" }));

    expect(screen.getByTitle(/Amazon EC2/).textContent).toContain("AZ");
    expect(screen.getByTitle(/AWS Lambda/).textContent).not.toContain("AZ");
  });
});
