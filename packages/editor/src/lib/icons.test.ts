import type { IconCatalog, IconEntry } from "@architecture/schema";
import { describe, expect, it, vi } from "vitest";
import { groupByCategory, iconForResourceType, loadIconCatalog, searchIcons } from "./icons.js";

const icon = (over: Partial<IconEntry>): IconEntry =>
  ({
    key: "Architecture/Compute/Amazon-EC2",
    group: "Architecture",
    category: "Compute",
    label: "Amazon EC2",
    path: "/icons/ec2.svg",
    aliases: ["amazon ec2", "ec2", "virtual server"],
    resourceTypes: ["AWS::EC2::Instance"],
    ...over,
  }) as IconEntry;

const ICONS = [
  icon({}),
  icon({
    key: "Architecture/Databases/Amazon-RDS",
    category: "Database",
    label: "Amazon RDS",
    aliases: ["amazon rds", "rds", "database"],
    resourceTypes: ["AWS::RDS::DBInstance"],
  }),
  icon({
    key: "Architecture/Compute/AWS-Lambda",
    category: "Compute",
    label: "AWS Lambda",
    aliases: ["aws lambda", "lambda", "serverless"],
    resourceTypes: ["AWS::Lambda::Function"],
  }),
];

describe("icon search", () => {
  it("an empty query returns everything", () => {
    expect(searchIcons(ICONS, "  ")).toHaveLength(3);
  });

  it("matches part of the label", () => {
    expect(searchIcons(ICONS, "lambda").map((i) => i.label)).toEqual(["AWS Lambda"]);
  });

  it("matches an alias", () => {
    expect(searchIcons(ICONS, "database").map((i) => i.label)).toEqual(["Amazon RDS"]);
  });

  it("ranks prefix matches above substring matches", () => {
    const results = searchIcons(ICONS, "amazon");
    expect(results.map((i) => i.label)).toEqual(["Amazon EC2", "Amazon RDS"]);
  });

  it("is case-insensitive", () => {
    expect(searchIcons(ICONS, "EC2")).toHaveLength(1);
  });

  it("returns nothing when there is no match", () => {
    expect(searchIcons(ICONS, "nothing-like-this")).toEqual([]);
  });
});

describe("grouping by category", () => {
  it("keeps the catalog's order", () => {
    expect(groupByCategory(ICONS).map(([c, e]) => [c, e.length])).toEqual([
      ["Compute", 2],
      ["Database", 1],
    ]);
  });
});

describe("finding an icon from a resourceType", () => {
  it("returns the matching icon", () => {
    expect(iconForResourceType(ICONS, "AWS::RDS::DBInstance")?.label).toBe("Amazon RDS");
  });
  it("an unknown type is undefined", () => {
    expect(iconForResourceType(ICONS, "AWS::Foo::Bar")).toBeUndefined();
  });
});

describe("loading the catalog", () => {
  const catalog = (icons: IconEntry[]): IconCatalog =>
    ({
      schemaVersion: "1.0",
      generatedAt: "2026-09-19T00:00:00Z",
      packageRelease: null,
      icons,
    }) as IconCatalog;

  it("uses the official catalog when it exists", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(catalog(ICONS)), { status: 200 }),
    );
    const result = await loadIconCatalog(fetchImpl as unknown as typeof fetch);
    expect(result.isPlaceholder).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the placeholders without it", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url === "/icons.json"
        ? new Response("", { status: 404 })
        : new Response(JSON.stringify(catalog(ICONS)), { status: 200 }),
    );
    const result = await loadIconCatalog(fetchImpl as unknown as typeof fetch);
    expect(result.isPlaceholder).toBe(true);
    expect(result.catalog.icons).toHaveLength(3);
  });

  it("with neither, the error says why", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      loadIconCatalog(fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/icons:placeholder/);
  });

  it("an empty catalog is invalid, so the next source is tried", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url === "/icons.json"
        ? new Response(JSON.stringify(catalog([])), { status: 200 })
        : new Response(JSON.stringify(catalog(ICONS)), { status: 200 }),
    );
    const result = await loadIconCatalog(fetchImpl as unknown as typeof fetch);
    expect(result.isPlaceholder).toBe(true);
  });
});

describe("what the palette leaves out", () => {
  const groupIcon = {
    key: "Group/Group/AWS-Account",
    group: "Group",
    category: "Group",
    label: "AWS Account",
    path: "/icons/g.svg",
    aliases: ["account"],
    resourceTypes: [],
  } as IconEntry;

  it("Group frame icons are not listed", () => {
    // Frames are the box tool's job. Dropped from the palette they would
    // land as small resource icons.
    const categories = groupByCategory([...ICONS, groupIcon]);
    expect(categories.map(([name]) => name)).not.toContain("Group");
  });

  it("and they do not appear in search", () => {
    expect(searchIcons([...ICONS, groupIcon], "account")).not.toContain(groupIcon);
  });
});
