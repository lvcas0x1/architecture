import type { Inventory, NormalizedResource } from "@architecture/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResourceStore } from "./resources.js";

const ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc";

const resource = (over: Partial<NormalizedResource> = {}): NormalizedResource =>
  ({
    schemaVersion: "1.0",
    arn: ARN,
    accountId: "123456789012",
    accountAlias: "prod",
    region: "ap-northeast-1",
    resourceType: "AWS::EC2::Instance",
    resourceId: "i-0abc",
    service: "EC2",
    name: "ec2-ap1",
    tags: [],
    iconKey: "Architecture/Compute/Amazon-EC2",
    lifecycle: "active",
    fetchedAt: "2026-09-19T00:00:00Z",
    deletedAt: null,
    lastError: null,
    sections: [],
    relations: [],
    raw: null,
    ...over,
  }) as NormalizedResource;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => useResourceStore.getState().reset());
afterEach(() => vi.unstubAllGlobals());

describe("the resource store", () => {
  it("what was put in comes back by ARN", () => {
    useResourceStore.getState().put(resource());
    expect(useResourceStore.getState().get(ARN)?.name).toBe("ec2-ap1");
    expect(useResourceStore.getState().get(null)).toBeUndefined();
    expect(
      useResourceStore.getState().get("arn:aws:s3:::none"),
    ).toBeUndefined();
  });
});

describe("refresh (re-running Describe)", () => {
  it("success replaces the contents", async () => {
    useResourceStore.getState().put(resource({ name: "old name" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(resource({ name: "new name" }))),
    );

    const updated = await useResourceStore.getState().refresh(ARN);
    expect(updated?.name).toBe("new name");
    expect(useResourceStore.getState().get(ARN)?.name).toBe("new name");
    expect(useResourceStore.getState().refreshing[ARN]).toBe("idle");
  });

  it("a deleted result sets lifecycle to deleted", async () => {
    useResourceStore.getState().put(resource());
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          resource({ lifecycle: "deleted", deletedAt: "2026-09-19T01:00:00Z" }),
        ),
      ),
    );

    await useResourceStore.getState().refresh(ARN);
    const after = useResourceStore.getState().get(ARN)!;
    expect(after.lifecycle).toBe("deleted");
    expect(after.deletedAt).toBeTruthy();
  });

  it("no permission is error, not deleted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          resource({
            lifecycle: "error",
            lastError: "AccessDenied: ec2:DescribeInstances",
          }),
        ),
      ),
    );

    await useResourceStore.getState().refresh(ARN);
    const after = useResourceStore.getState().get(ARN)!;
    expect(after.lifecycle).toBe("error");
    expect(after.lifecycle).not.toBe("deleted");
  });

  it("a failure keeps the existing data and records the reason", async () => {
    useResourceStore.getState().put(resource({ name: "original" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "resource not found" }, 404)),
    );

    const result = await useResourceStore.getState().refresh(ARN);
    expect(result).toBeNull();
    expect(useResourceStore.getState().get(ARN)?.name).toBe("original");
    expect(useResourceStore.getState().refreshing[ARN]).toBe("error");
    expect(useResourceStore.getState().lastError).toContain(
      "resource not found",
    );
  });

  it("with the backend down it explains what to do", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await useResourceStore.getState().refresh(ARN);
    expect(useResourceStore.getState().lastError).toContain(
      "Cannot reach the backend",
    );
  });
});

describe("the inventory", () => {
  it("becomes ready once it loads", async () => {
    const inventory = {
      schemaVersion: "1.0",
      generatedAt: "2026-09-19T00:00:00Z",
      source: "resource-explorer",
      entries: [{ arn: ARN, service: "EC2" }],
    } as unknown as Inventory;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(inventory)),
    );

    await useResourceStore.getState().loadInventory();
    expect(useResourceStore.getState().inventoryStatus).toBe("ready");
    expect(useResourceStore.getState().inventory).toHaveLength(1);
  });

  it("the backend being down is unavailable, not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await useResourceStore.getState().loadInventory();
    // Loading from a file still works, so it is not fatal
    expect(useResourceStore.getState().inventoryStatus).toBe("unavailable");
  });

  it("a server error is an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "broken" }, 500)),
    );
    await useResourceStore.getState().loadInventory();
    expect(useResourceStore.getState().inventoryStatus).toBe("error");
  });
});

describe("fetching what is missing", () => {
  it("fetches only the ARNs that are not there", async () => {
    useResourceStore.getState().put(resource());
    const other = "arn:aws:rds:ap-northeast-1:123456789012:db:rds1";
    const fetchMock = vi.fn(async () => jsonResponse(resource({ arn: other })));
    vi.stubGlobal("fetch", fetchMock);

    await useResourceStore.getState().fetchMissing([ARN, other]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useResourceStore.getState().get(other)).toBeDefined();
  });

  it("the rest still apply when some fail", async () => {
    const a = "arn:aws:rds:ap-northeast-1:123456789012:db:a";
    const b = "arn:aws:rds:ap-northeast-1:123456789012:db:b";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes(encodeURIComponent(a))
          ? jsonResponse({ detail: "not found" }, 404)
          : jsonResponse(resource({ arn: b })),
      ),
    );

    await useResourceStore.getState().fetchMissing([a, b]);
    expect(useResourceStore.getState().get(a)).toBeUndefined();
    expect(useResourceStore.getState().get(b)).toBeDefined();
  });
});

it("does not let an old GET replace locally configured data", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const fetching = useResourceStore.getState().fetchMissing([ARN]);
  useResourceStore.getState().put(resource({ name: "local" }));
  finish(jsonResponse(resource({ name: "old GET" })));
  await fetching;
  expect(useResourceStore.getState().get(ARN)?.name).toBe("local");
});
it("ignores pending requests after reset", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const refreshing = useResourceStore.getState().refresh(ARN);
  useResourceStore.getState().reset();
  finish(jsonResponse(resource()));
  await refreshing;
  expect(useResourceStore.getState().byArn).toEqual({});
  expect(useResourceStore.getState().refreshing).toEqual({});
});
it("only the most recent refresh can update the cache", async () => {
  const finishes: ((value: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((resolve) => finishes.push(resolve))),
  );
  const first = useResourceStore.getState().refresh(ARN);
  const second = useResourceStore.getState().refresh(ARN);
  finishes[1]!(jsonResponse(resource({ name: "new" })));
  await second;
  finishes[0]!(jsonResponse(resource({ name: "old" })));
  await first;
  expect(useResourceStore.getState().get(ARN)?.name).toBe("new");
});
