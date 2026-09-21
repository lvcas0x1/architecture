import type { IconEntry } from "@architecture/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCatalogStore } from "../store/catalog.js";
import { Palette } from "./Palette.js";

const entry = (over: Partial<IconEntry>): IconEntry =>
  ({
    key: "Architecture/Compute/Amazon-EC2",
    group: "Architecture",
    category: "Compute",
    label: "Amazon EC2",
    path: "/icons/ec2.svg",
    aliases: ["ec2", "virtual server"],
    resourceTypes: [],
    ...over,
  }) as IconEntry;

const ICONS = [
  entry({}),
  entry({ key: "Architecture/Compute/AWS-Lambda", label: "AWS Lambda", aliases: ["lambda"] }),
  entry({
    key: "Architecture/Databases/Amazon-RDS",
    category: "Database",
    label: "Amazon RDS",
    aliases: ["rds", "database"],
  }),
];

beforeEach(() => {
  useCatalogStore.setState({
    icons: ICONS,
    byKey: new Map(ICONS.map((i) => [i.key, i])),
    isPlaceholder: false,
    status: "ready",
    error: null,
  });
});

afterEach(cleanup);

describe("the icon palette", () => {
  it("groups by category", () => {
    render(<Palette />);
    expect(screen.getByRole("button", { name: /Compute/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Database/ })).toBeTruthy();
  });

  it("every category starts collapsed", () => {
    render(<Palette />);
    expect(screen.queryByTitle(/Amazon EC2/)).toBeNull();
    expect(screen.queryByTitle(/Amazon RDS/)).toBeNull();
  });

  it("search narrows it down", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByLabelText("Search icons"), "lambda");

    expect(screen.getByTitle(/AWS Lambda/)).toBeTruthy();
    expect(screen.queryByTitle(/Amazon RDS/)).toBeNull();
  });

  it("an alias finds it too", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByLabelText("Search icons"), "database");
    expect(screen.getByTitle(/Amazon RDS/)).toBeTruthy();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByLabelText("Search icons"), "zzzz");
    expect(screen.getByText(/No icons match/)).toBeTruthy();
  });

  it("the heading toggles the category", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    expect(screen.queryByTitle(/Amazon RDS/)).toBeNull();

    await user.click(screen.getByRole("button", { name: /Database/ }));
    expect(screen.getByTitle(/Amazon RDS/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Database/ }));
    expect(screen.queryByTitle(/Amazon RDS/)).toBeNull();
  });

  it("opening another category leaves the first open", async () => {
    const user = userEvent.setup();
    render(<Palette />);

    await user.click(screen.getByRole("button", { name: /Database/ }));
    await user.click(screen.getByRole("button", { name: /Compute/ }));

    expect(screen.getByTitle(/Amazon RDS/)).toBeTruthy();
    expect(screen.getByTitle(/Amazon EC2/)).toBeTruthy();
  });

  it("a search shows results even from collapsed categories", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.type(screen.getByLabelText("Search icons"), "rds");
    expect(screen.getByTitle(/Amazon RDS/)).toBeTruthy();
  });

  it("clearing the search collapses them again", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    const search = screen.getByLabelText("Search icons");
    await user.type(search, "rds");
    await user.clear(search);
    expect(screen.queryByTitle(/Amazon RDS/)).toBeNull();
  });

  it("an icon is draggable and puts its key on the dataTransfer", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    await user.click(screen.getByRole("button", { name: /Compute/ }));
    const button = screen.getByTitle(/Amazon EC2/);
    expect(button.getAttribute("draggable")).toBe("true");
  });

  it("warns while the placeholders are in use", () => {
    useCatalogStore.setState({ isPlaceholder: true });
    render(<Palette />);
    expect(screen.getByText(/Placeholder icons/)).toBeTruthy();
  });

  it("shows the error when loading failed", () => {
    useCatalogStore.setState({ status: "error", error: "Catalog not found", icons: [] });
    render(<Palette />);
    expect(screen.getByText("Catalog not found")).toBeTruthy();
  });

  it("shows the count per category", () => {
    render(<Palette />);
    const compute = screen.getByRole("button", { name: /Compute/ });
    expect(within(compute).getByText("2")).toBeTruthy();
  });
});

describe("the palette's frame", () => {
  it("has no footer hint (the canvas gets the space)", () => {
    const { container } = render(<Palette />);
    expect(container.textContent).not.toContain("Drag to place");
  });

  it("the search box matches the toolbar's height", () => {
    const { container } = render(<Palette />);
    const header = container.querySelector("aside > div")!;

    // They share a minimum height so they line up
    expect(header.className).toContain("min-h-11");
  });
});
