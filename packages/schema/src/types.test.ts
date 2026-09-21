import { describe, expect, it } from "vitest";
import type { Diagram, NormalizedResource } from "./generated/models.js";
import {
  canConnect,
  dashArrayFor,
  isDeleted,
  isResourceNode,
  isUnavailable,
  referencedArns,
  referencedIconKeys,
} from "./types.js";

const EC2_ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc123";

const diagram = {
  schemaVersion: "1.0",
  meta: { title: "t", generator: "user", accountIds: [], regions: [] },
  viewport: { x: 0, y: 0, zoom: 1 },
  layout: {
    mode: "manual",
    algorithm: "layered",
    direction: "RIGHT",
    nodeSpacing: 48,
    layerSpacing: 96,
    padding: 32,
  },
  nodes: [
    {
      id: "n1",
      type: "resource",
      position: { x: 0, y: 0 },
      size: null,
      parentId: null,
      zIndex: 0,
      locked: false,
      hidden: false,
      data: {
        iconKey: "Architecture/Compute/Amazon-EC2",
        resourceRef: EC2_ARN,
        labelOverride: null,
        showFields: ["service", "name", "resourceId", "tags"],
        maxTags: 3,
        origin: "user",
      },
    },
    {
      id: "t1",
      type: "text",
      position: { x: 5, y: 5 },
      size: null,
      parentId: null,
      zIndex: 0,
      locked: false,
      hidden: false,
      data: {
        text: "note",
        fontSize: 14,
        bold: false,
        italic: false,
        color: null,
        align: "left",
        origin: "user",
      },
    },
  ],
  edges: [],
} as unknown as Diagram;

const resource = (over: Partial<NormalizedResource> = {}) =>
  ({ arn: EC2_ARN, lifecycle: "active", ...over }) as NormalizedResource;

describe("diagram helpers", () => {
  it("collects the ARNs it references", () => {
    expect(referencedArns(diagram)).toEqual(new Set([EC2_ARN]));
  });

  it("collects only the icons in use (what an export embeds)", () => {
    expect(referencedIconKeys(diagram)).toEqual(
      new Set(["Architecture/Compute/Amazon-EC2"]),
    );
  });

  it("line endpoints are resources, boxes or shapes only", () => {
    expect(canConnect("resource")).toBe(true);
    expect(canConnect("group")).toBe(true);
    expect(canConnect("shape")).toBe(true);
    // Text cannot be an endpoint (a line always joins parts of the diagram)
    expect(canConnect("text")).toBe(false);
  });

  it("the type guards work", () => {
    expect(isResourceNode(diagram.nodes[0]! as never)).toBe(true);
    expect(isResourceNode(diagram.nodes[1]! as never)).toBe(false);
  });
});

describe("detecting a deleted resource", () => {
  it("deleted means greyed out with a Deleted badge", () => {
    expect(isDeleted(resource({ lifecycle: "deleted" }))).toBe(true);
    expect(isUnavailable(resource({ lifecycle: "deleted" }))).toBe(true);
  });

  it("error is kept apart from deleted (no permission is not gone)", () => {
    expect(isDeleted(resource({ lifecycle: "error" }))).toBe(false);
    expect(isUnavailable(resource({ lifecycle: "error" }))).toBe(true);
  });

  it("active renders normally", () => {
    expect(isDeleted(resource())).toBe(false);
    expect(isUnavailable(resource())).toBe(false);
  });

  it("unlinked (undefined) counts as unavailable too", () => {
    expect(isDeleted(undefined)).toBe(false);
    expect(isUnavailable(undefined)).toBe(true);
  });
});

describe("line styles", () => {
  it("solid has no dasharray", () => {
    expect(dashArrayFor("solid")).toBeUndefined();
  });
  it("dashed and dotted differ", () => {
    expect(dashArrayFor("dashed")).not.toEqual(dashArrayFor("dotted"));
    expect(dashArrayFor("dashed")).toBeTruthy();
    expect(dashArrayFor("dotted")).toBeTruthy();
  });
});
