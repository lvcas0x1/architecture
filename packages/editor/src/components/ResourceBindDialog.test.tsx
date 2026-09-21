import { describe, expect, it } from "vitest";
import { parseResourceFile } from "./ResourceBindDialog.js";

const valid = {
  schemaVersion: "1.0",
  arn: "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc",
  accountId: "123456789012",
  region: "ap-northeast-1",
  resourceType: "AWS::EC2::Instance",
  resourceId: "i-0abc",
  service: "EC2",
  name: "ec2-ap1",
  iconKey: "Architecture/Compute/Amazon-EC2",
  lifecycle: "active",
  fetchedAt: "2026-09-19T00:00:00Z",
  tags: [{ key: "Env", value: "prod" }],
  sections: [{ title: "Overview", rows: [] }],
  relations: [],
};

describe("loading a resource JSON file", () => {
  it("accepts a valid file", () => {
    const parsed = parseResourceFile(JSON.stringify(valid));
    expect(parsed.arn).toBe(valid.arn);
    expect(parsed.service).toBe("EC2");
  });

  it("broken JSON fails with a reason", () => {
    expect(() => parseResourceFile("{broken")).toThrow(/Not valid JSON/);
  });

  it("refuses a missing required field", () => {
    const { arn: _arn, ...without } = valid;
    expect(() => parseResourceFile(JSON.stringify(without))).toThrow(
      /required property.*arn/,
    );
  });

  it("refuses sections that is not an array", () => {
    expect(() =>
      parseResourceFile(JSON.stringify({ ...valid, sections: {} })),
    ).toThrow(/sections/);
  });

  it("fills in tags / relations when they are absent", () => {
    const { tags: _t, relations: _r, ...without } = valid;
    const parsed = parseResourceFile(JSON.stringify(without));
    expect(parsed.tags).toEqual([]);
    expect(parsed.relations).toEqual([]);
  });

  it("refuses anything that is not an object", () => {
    expect(() => parseResourceFile("[]")).toThrow();
    expect(() => parseResourceFile("null")).toThrow();
  });

  it("takes an omitted sections, as the server does", () => {
    const { sections: _s, ...without } = valid;
    expect(parseResourceFile(JSON.stringify(without)).sections).toEqual([]);
  });

  it("refuses fields whose format the server would reject", () => {
    expect(() =>
      parseResourceFile(JSON.stringify({ ...valid, arn: "i-0abc" })),
    ).toThrow(/arn/);
    expect(() =>
      parseResourceFile(JSON.stringify({ ...valid, iconKey: "nope" })),
    ).toThrow(/iconKey/);
    expect(() =>
      parseResourceFile(JSON.stringify({ ...valid, resourceType: "EC2" })),
    ).toThrow(/resourceType/);
    expect(() =>
      parseResourceFile(JSON.stringify({ ...valid, fetchedAt: "today" })),
    ).toThrow(/fetchedAt/);
  });

  it("refuses a row that is not a row", () => {
    const rows = { ...valid, sections: [{ title: "Overview", rows: [null] }] };
    expect(() => parseResourceFile(JSON.stringify(rows))).toThrow(
      /rows\/0.*object/,
    );
  });

  it("refuses a duplicate tag key and a malformed relation", () => {
    const tags = {
      ...valid,
      tags: [
        { key: "Env", value: "a" },
        { key: "Env", value: "b" },
      ],
    };
    expect(() => parseResourceFile(JSON.stringify(tags))).toThrow(
      /Duplicate tag key/,
    );

    const relations = {
      ...valid,
      relations: [{ type: "In VPC", targetArn: valid.arn }],
    };
    expect(() => parseResourceFile(JSON.stringify(relations))).toThrow(
      /relations\/0\/type/,
    );
  });
});

it.each([
  { name: {} },
  { schemaVersion: "2.0" },
  { lastError: [] },
  { raw: [] },
  { region: " " },
  { sections: [{ title: "x", rows: [{ label: "a", kind: "" }] }] },
  { sections: [{ title: "x", rows: [{ label: "a", tone: "blue" }] }] },
])("rejects unsafe or invalid resource properties: %j", (patch) => {
  expect(() =>
    parseResourceFile(JSON.stringify({ ...valid, ...patch })),
  ).toThrow();
});
it("fills nested defaults and checks tags after trimming", () => {
  const parsed = parseResourceFile(
    JSON.stringify({
      ...valid,
      sections: [{ title: "Overview" }],
      tags: [{ key: " Env " }],
    }),
  );
  expect(parsed.sections[0]!.rows).toEqual([]);
  expect(parsed.tags).toEqual([{ key: "Env", value: "" }]);
  expect(() =>
    parseResourceFile(
      JSON.stringify({ ...valid, tags: [{ key: "Env" }, { key: " Env " }] }),
    ),
  ).toThrow(/Duplicate/);
});
