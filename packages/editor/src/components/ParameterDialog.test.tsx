import type { NormalizedResource } from "@architecture/schema";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResourceStore } from "../store/resources.js";
import { ParameterDialog } from "./ParameterDialog.js";

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
    tags: [{ key: "Env", value: "prod" }],
    iconKey: "Architecture/Compute/Amazon-EC2",
    lifecycle: "active",
    fetchedAt: "2026-09-19T03:12:00Z",
    deletedAt: null,
    lastError: null,
    sections: [
      {
        title: "Overview",
        collapsed: false,
        rows: [
          {
            label: "Instance type",
            value: "m5.large",
            kind: "text",
            tone: null,
            href: null,
            ref: null,
          },
          {
            label: "State",
            value: "running",
            kind: "badge",
            tone: "ok",
            href: null,
            ref: null,
          },
        ],
      },
      {
        title: "Network",
        collapsed: false,
        rows: [
          {
            label: "Private IP",
            value: "10.0.2.23",
            kind: "code",
            tone: null,
            href: null,
            ref: null,
          },
          {
            label: "Public IP",
            value: null,
            kind: "text",
            tone: null,
            href: null,
            ref: null,
          },
          {
            label: "SG",
            value: ["sg-a", "sg-b"],
            kind: "list",
            tone: null,
            href: null,
            ref: null,
          },
          {
            label: "VPC",
            value: "vpc-01",
            kind: "link",
            tone: null,
            href: null,
            ref: "arn:aws:ec2:ap-northeast-1:123456789012:vpc/vpc-01",
          },
        ],
      },
      { title: "Storage", collapsed: false, rows: [] },
    ],
    relations: [],
    raw: null,
    ...over,
  }) as NormalizedResource;

beforeEach(() => {
  useResourceStore.getState().reset();
  useResourceStore.getState().put(resource());
});
afterEach(cleanup);

const open = (props: Partial<Parameters<typeof ParameterDialog>[0]> = {}) =>
  render(<ParameterDialog arn={ARN} open onOpenChange={() => {}} {...props} />);

describe("the parameter popup", () => {
  it("a list value with a ref can jump to its target", async () => {
    const target = "arn:aws:ec2:ap-northeast-1:123456789012:vpc/vpc-01";
    useResourceStore
      .getState()
      .put(
        resource({
          sections: [
            {
              title: "References",
              collapsed: false,
              rows: [
                {
                  label: "VPC",
                  value: ["vpc-01"],
                  kind: "list",
                  ref: target,
                  href: null,
                  tone: null,
                },
              ],
            },
          ],
        }),
      );
    const onJump = vi.fn();
    open({ onJump, canJump: () => true });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "vpc-01" }));
    expect(onJump).toHaveBeenCalledWith(target);
  });
  it("categories appear in the JSON's order", () => {
    open();
    const headings = screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => /Overview|Network|Storage/.test(t));
    expect(headings[0]).toContain("Overview");
    expect(headings[1]).toContain("Network");
    expect(headings[2]).toContain("Storage");
  });

  it("rows form a label / value table", () => {
    open();
    const row = screen.getByRole("row", { name: /Instance type/ });
    expect(within(row).getByText("m5.large")).toBeTruthy();
  });

  it("a row with no value shows an em dash", () => {
    open();
    const row = screen.getByRole("row", { name: /Public IP/ });
    expect(within(row).getByText("—")).toBeTruthy();
  });

  it("an array becomes chips", () => {
    open();
    const row = screen.getByRole("row", { name: /SG/ });
    expect(within(row).getByText("sg-a")).toBeTruthy();
    expect(within(row).getByText("sg-b")).toBeTruthy();
  });

  it("a row with a ref can jump", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    open({ onJump });
    await user.click(screen.getByText("vpc-01"));
    expect(onJump).toHaveBeenCalledWith(
      "arn:aws:ec2:ap-northeast-1:123456789012:vpc/vpc-01",
    );
  });

  it("a category can be collapsed", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByText("m5.large")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Overview/ }));
    expect(screen.queryByText("m5.large")).toBeNull();
  });

  it("shows the service, account, region and fetch time", () => {
    open();
    expect(
      screen.getByText("AWS::EC2::Instance", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText("prod")).toBeTruthy();
    expect(screen.getByText("ap-northeast-1")).toBeTruthy();
    expect(screen.getByText(/Fetched:/)).toBeTruthy();
  });

  it("the popup says deleted too", () => {
    useResourceStore.getState().put(resource({ lifecycle: "deleted" }));
    open();
    expect(screen.getByText("Deleted")).toBeTruthy();
  });

  it("a failed fetch shows the reason", () => {
    useResourceStore
      .getState()
      .put(resource({ lifecycle: "error", lastError: "AccessDenied" }));
    open();
    expect(screen.getByText("Fetch failed")).toBeTruthy();
    expect(screen.getByText("AccessDenied")).toBeTruthy();
  });

  it("the Refresh button re-runs Describe", async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    open({ onRefresh });
    await user.click(screen.getByText("Refresh"));
    expect(onRefresh).toHaveBeenCalledWith(ARN);
  });

  it("not fetched explains how to fetch it", () => {
    useResourceStore.getState().reset();
    open();
    expect(screen.getByText(/has not been loaded yet/)).toBeTruthy();
  });

  it("the raw response is collapsed", async () => {
    useResourceStore
      .getState()
      .put(resource({ raw: { InstanceId: "i-0abc" } }));
    const user = userEvent.setup();
    open();
    expect(screen.queryByText(/"InstanceId"/)).toBeNull();
    await user.click(screen.getByText(/Raw Describe response/));
    expect(screen.getByText(/"InstanceId"/)).toBeTruthy();
  });
});
