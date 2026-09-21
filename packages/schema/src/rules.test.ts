import { describe, expect, it } from "vitest";
import {
  RULES,
  allowedParentsOf,
  canBeTopLevel,
  canNestGroup,
  canOverlapGroups,
  canPlaceResource,
  explainNesting,
  explainScope,
  groupStyleLabel,
} from "./rules.js";

describe("box nesting rules", () => {
  it("only Global, on-premises and generic sit on the bare canvas", () => {
    expect(RULES.topLevelGroupStyles.toSorted()).toEqual([
      "generic",
      "global",
      "on-premises",
    ]);
  });

  it("the hierarchy stacks", () => {
    expect(canNestGroup("account", "global")).toBe(true);
    expect(canNestGroup("region", "account")).toBe(true);
    expect(canNestGroup("vpc", "region")).toBe(true);
    expect(canNestGroup("az", "vpc")).toBe(true);
    expect(canNestGroup("subnet-private", "az")).toBe(true);
    expect(canNestGroup("security-group", "subnet-private")).toBe(true);
  });

  it("a region only goes inside Global or an account", () => {
    expect(canNestGroup("region", "global")).toBe(true);
    expect(canNestGroup("region", "account")).toBe(true);
    expect(canNestGroup("region", "vpc")).toBe(false);
    expect(canNestGroup("region", null)).toBe(false);
  });

  it("a subnet cannot sit on the bare canvas", () => {
    expect(canNestGroup("subnet-public", null)).toBe(false);
    expect(canBeTopLevel("subnet-public")).toBe(false);
  });

  it("Global goes inside nothing", () => {
    expect(canNestGroup("global", null)).toBe(true);
    expect(canNestGroup("global", "account")).toBe(false);
    expect(allowedParentsOf("global")).toEqual([]);
  });

  it("on-premises is outside AWS, so it stands alone", () => {
    expect(canNestGroup("on-premises", null)).toBe(true);
    expect(canNestGroup("on-premises", "region")).toBe(false);
  });

  it("generic is unconstrained on either side (the escape hatch)", () => {
    expect(canNestGroup("generic", null)).toBe(true);
    expect(canNestGroup("generic", "subnet-private")).toBe(true);
    expect(canNestGroup("vpc", "generic")).toBe(true);
    expect(canNestGroup("subnet-public", "generic")).toBe(true);
  });

  it("the hierarchy cannot be inverted", () => {
    expect(canNestGroup("vpc", "subnet-private")).toBe(false);
    expect(canNestGroup("account", "vpc")).toBe(false);
    expect(canNestGroup("az", "subnet-public")).toBe(false);
  });

  it("the common shorthand is allowed (a subnet straight inside a VPC)", () => {
    expect(canNestGroup("subnet-private", "vpc")).toBe(true);
    expect(canNestGroup("az", "region")).toBe(true);
  });
});

describe("resource scopes", () => {
  it("unset goes anywhere", () => {
    expect(canPlaceResource("any", "subnet-private")).toBe(true);
    expect(canPlaceResource(undefined, "global")).toBe(true);
  });

  it("a global service only goes inside Global or an account", () => {
    expect(canPlaceResource("global", "global")).toBe(true);
    expect(canPlaceResource("global", "account")).toBe(true);
    expect(canPlaceResource("global", "vpc")).toBe(false);
    expect(canPlaceResource("global", "subnet-private")).toBe(false);
  });

  it("a zone service only goes inside an AZ or a subnet", () => {
    expect(canPlaceResource("zone", "subnet-private")).toBe(true);
    expect(canPlaceResource("zone", "az")).toBe(true);
    expect(canPlaceResource("zone", "vpc")).toBe(false);
    expect(canPlaceResource("zone", "region")).toBe(false);
  });

  it("a region service goes anywhere inside a region", () => {
    // Drawing S3 inside a VPC is common in practice, so it is allowed
    expect(canPlaceResource("region", "region")).toBe(true);
    expect(canPlaceResource("region", "vpc")).toBe(true);
    expect(canPlaceResource("region", "subnet-private")).toBe(true);
    expect(canPlaceResource("region", "global")).toBe(false);
  });

  it("inside a shape (no style) is always allowed", () => {
    expect(canPlaceResource("zone", null)).toBe(true);
  });

  it("a generic box takes anything", () => {
    expect(canPlaceResource("zone", "generic")).toBe(true);
    expect(canPlaceResource("global", "generic")).toBe(true);
  });
});

describe("the wording of the reasons", () => {
  it("style names use the official AWS group names", () => {
    expect(groupStyleLabel("global")).toBe("AWS Cloud");
    expect(groupStyleLabel("vpc")).toBe("VPC");
    expect(groupStyleLabel("subnet-public")).toBe("Public subnet");
    expect(groupStyleLabel("az")).toBe("Availability Zone");
  });

  it("the bare-canvas reason lists where it can go", () => {
    const message = explainNesting("vpc", null);
    expect(message).toContain("VPC");
    expect(message).toContain("Region");
  });

  it("a wrong-parent reason names both", () => {
    const message = explainNesting("region", "vpc");
    expect(message).toContain("Region");
    expect(message).toContain("VPC");
  });

  it("a scope violation lists where it can go", () => {
    const message = explainScope("zone", "vpc");
    expect(message).toContain("VPC");
    expect(message).toContain("Availability Zone");
  });

  it("the sentence itself reads as prose", () => {
    expect(explainNesting("vpc", null)).toContain("cannot sit directly on the canvas");
  });
});

describe("staying in step with Python", () => {
  it("the rules table is distributed as a generated file", () => {
    expect(Object.keys(RULES.groupNesting).length).toBeGreaterThan(8);
    expect(RULES.connectableNodeTypes).toEqual(["group", "resource", "shape"]);
    expect(RULES.containerNodeTypes).toEqual(["group", "shape"]);
  });

  it("every style has a display name", () => {
    for (const style of Object.keys(RULES.groupNesting)) {
      expect(RULES.groupStyleLabels[style]).toBeTruthy();
    }
  });
});

describe("boxes overlapping", () => {
  it("a VPC and an AZ may overlap (neither is really outside the other)", () => {
    expect(canOverlapGroups("vpc", "az")).toBe(true);
    expect(canOverlapGroups("az", "vpc")).toBe(true);
  });

  it("two boxes of the same style may not", () => {
    expect(canOverlapGroups("az", "az")).toBe(false);
    expect(canOverlapGroups("vpc", "vpc")).toBe(false);
    expect(canOverlapGroups("region", "region")).toBe(false);
  });

  it("no other combination may either", () => {
    expect(canOverlapGroups("vpc", "subnet-private")).toBe(false);
    expect(canOverlapGroups("region", "vpc")).toBe(false);
    expect(canOverlapGroups("global", "on-premises")).toBe(false);
  });
});
