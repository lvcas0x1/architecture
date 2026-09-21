import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IconEntry } from "@architecture/schema";
import { api } from "../lib/api.js";
import { useCatalogStore } from "./catalog.js";

const entry = (key: string): IconEntry =>
  ({
    key,
    group: "Architecture",
    category: "Compute",
    label: key.split("/").pop() ?? key,
    path: `/icons/${key}.svg`,
    aliases: [],
    resourceTypes: [],
  }) as IconEntry;

const EC2 = "Architecture/Compute/Amazon-EC2";
const LAMBDA = "Architecture/Compute/AWS-Lambda";
const ICONS = [entry(EC2), entry(LAMBDA)];

beforeEach(() => {
  useCatalogStore.setState({
    icons: ICONS,
    byKey: new Map(ICONS.map((i) => [i.key, i])),
    scopeOverrides: new Map(),
    scopesLoaded: true,
    scopeEdits: new Map(),
    scopeSaveError: null,
    status: "ready",
  });
  vi.restoreAllMocks();
});

describe("icon attributes", () => {
  it("every icon starts with no attribute", () => {
    expect(useCatalogStore.getState().scopeFor(EC2)).toBe("any");
    expect(useCatalogStore.getState().scopeFor(LAMBDA)).toBe("any");
  });

  it("an unknown key counts as no attribute", () => {
    expect(useCatalogStore.getState().scopeFor("Architecture/Nope")).toBe(
      "any",
    );
    expect(useCatalogStore.getState().scopeFor(null)).toBe("any");
  });

  it("an attribute that was set comes back", async () => {
    vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
    await useCatalogStore.getState().setScope(EC2, "subnet");

    expect(useCatalogStore.getState().scopeFor(EC2)).toBe("subnet");
    // An icon that was not given one still has none
    expect(useCatalogStore.getState().scopeFor(LAMBDA)).toBe("any");
  });

  it("going back to no attribute removes the setting", async () => {
    vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
    await useCatalogStore.getState().setScope(EC2, "global");
    await useCatalogStore.getState().setScope(EC2, "any");

    expect(useCatalogStore.getState().scopeFor(EC2)).toBe("any");
    // No attribute is the same state as never having had one
    expect(useCatalogStore.getState().scopeOverrides.has(EC2)).toBe(false);
  });

  it("sends the whole set to the server", async () => {
    const save = vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
    await useCatalogStore.getState().setScope(EC2, "vpc");
    await useCatalogStore.getState().setScope(LAMBDA, "region");

    expect(save).toHaveBeenLastCalledWith({ [EC2]: "vpc", [LAMBDA]: "region" });
  });

  it("a failed save keeps the setting on screen and says why", async () => {
    vi.spyOn(api, "saveIconScopes").mockRejectedValue(
      new Error("cannot connect"),
    );
    await useCatalogStore.getState().setScope(EC2, "vpc");

    expect(useCatalogStore.getState().scopeFor(EC2)).toBe("vpc");
    expect(useCatalogStore.getState().scopeSaveError).toContain(
      "cannot connect",
    );
  });

  it("a later successful save clears the message", async () => {
    vi.spyOn(api, "saveIconScopes").mockRejectedValueOnce(new Error("nope"));
    await useCatalogStore.getState().setScope(EC2, "vpc");
    vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
    await useCatalogStore.getState().setScope(EC2, "region");

    expect(useCatalogStore.getState().scopeSaveError).toBeNull();
  });
});

it("merges saved attributes before saving an edit made during initial loading", async () => {
  useCatalogStore.setState({ scopesLoaded: false, scopeEdits: new Map() });
  let finish!: (value: Awaited<ReturnType<typeof api.iconScopes>>) => void;
  vi.spyOn(api, "iconScopes").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const save = vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
  const changing = useCatalogStore.getState().setScope(EC2, "vpc");
  await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
  finish({ scopes: { [LAMBDA]: "region" } } as never);
  await changing;
  expect(save).toHaveBeenCalledWith({ [EC2]: "vpc", [LAMBDA]: "region" });
});
it("does not replace saved settings when initial read fails, and retries later", async () => {
  useCatalogStore.setState({ scopesLoaded: false, scopeEdits: new Map() });
  const read = vi
    .spyOn(api, "iconScopes")
    .mockRejectedValueOnce(new Error("offline"));
  const save = vi.spyOn(api, "saveIconScopes").mockResolvedValue({} as never);
  await useCatalogStore.getState().setScope(EC2, "vpc");
  expect(save).not.toHaveBeenCalled();
  read.mockResolvedValue({ scopes: { [LAMBDA]: "region" } } as never);
  await useCatalogStore.getState().setScope(EC2, "subnet");
  expect(save).toHaveBeenCalledWith({ [EC2]: "subnet", [LAMBDA]: "region" });
});
