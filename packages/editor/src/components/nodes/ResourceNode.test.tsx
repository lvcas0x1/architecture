import type { IconEntry, NormalizedResource, ResourceNodeData } from "@architecture/schema";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCatalogStore } from "../../store/catalog.js";
import { useResourceStore } from "../../store/resources.js";
import type { ArchResourceNode } from "../../lib/types.js";
import { ResourceNode } from "./ResourceNode.js";

const ARN = "arn:aws:ec2:ap-northeast-1:123456789012:instance/i-0abc123";
const ICON = "Architecture/Compute/Amazon-EC2";

const catalogEntry: IconEntry = {
  key: ICON,
  group: "Architecture",
  category: "Compute",
  label: "Amazon EC2",
  path: "/icons/ec2.svg",
  aliases: [],
  resourceTypes: ["AWS::EC2::Instance"],
  scope: "zone",
} as IconEntry;

const resource = (over: Partial<NormalizedResource> = {}): NormalizedResource =>
  ({
    schemaVersion: "1.0",
    arn: ARN,
    accountId: "123456789012",
    accountAlias: "prod",
    region: "ap-northeast-1",
    resourceType: "AWS::EC2::Instance",
    resourceId: "i-0abc123",
    service: "EC2",
    name: "ec2-ap1",
    tags: [
      { key: "Env", value: "prod" },
      { key: "Owner", value: "platform" },
      { key: "Team", value: "sre" },
      { key: "Cost", value: "1000" },
    ],
    iconKey: ICON,
    lifecycle: "active",
    fetchedAt: "2026-09-19T00:00:00Z",
    deletedAt: null,
    lastError: null,
    sections: [],
    relations: [],
    raw: null,
    ...over,
  }) as NormalizedResource;

const nodeData = (over: Partial<ResourceNodeData> = {}): ResourceNodeData => ({
  iconKey: ICON,
  resourceRef: ARN,
  labelOverride: null,
  showFields: ["service", "name", "resourceId", "tags"],
  maxTags: 3,
  mount: "inside",
  borderSide: null,
  origin: "user",
  ...over,
});

const renderNode = (data: ResourceNodeData) =>
  render(
    <ReactFlowProvider>
      <ResourceNode
        {...({ id: "n1", data, selected: false } as unknown as NodeProps<ArchResourceNode>)}
      />
    </ReactFlowProvider>,
  );

beforeEach(() => {
  useResourceStore.getState().reset();
  useCatalogStore.setState({
    icons: [catalogEntry],
    byKey: new Map([[ICON, catalogEntry]]),
    status: "ready",
    isPlaceholder: false,
    error: null,
  });
});
afterEach(cleanup);

describe("the labels under a resource icon", () => {
  it("shows the service, the resource name and the resource id", () => {
    useResourceStore.getState().put(resource());
    renderNode(nodeData());

    expect(screen.getByText("EC2")).toBeTruthy();
    expect(screen.getByText("ec2-ap1")).toBeTruthy();
    expect(screen.getByText("i-0abc123")).toBeTruthy();
  });

  it("shows tags up to maxTags and folds the rest into +N", () => {
    useResourceStore.getState().put(resource());
    renderNode(nodeData({ maxTags: 3 }));

    expect(screen.getByText("Env: prod")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.queryByText("Cost: 1000")).toBeNull();
  });

  it("showFields narrows what is shown", () => {
    useResourceStore.getState().put(resource());
    renderNode(nodeData({ showFields: ["service"] }));

    expect(screen.getByText("EC2")).toBeTruthy();
    expect(screen.queryByText("i-0abc123")).toBeNull();
    expect(screen.queryByText("Env: prod")).toBeNull();
  });

  it("labelOverride wins over the name", () => {
    useResourceStore.getState().put(resource());
    renderNode(nodeData({ labelOverride: "manual name" }));
    expect(screen.getByText("manual name")).toBeTruthy();
  });

  it("unlinked shows the catalog's label and a badge", () => {
    renderNode(nodeData({ resourceRef: null }));
    expect(screen.getByText("Amazon EC2")).toBeTruthy();
    expect(screen.getByText("Not linked")).toBeTruthy();
  });

  it("linked but not fetched shows the Not fetched badge", () => {
    renderNode(nodeData());
    expect(screen.getByText("Not fetched")).toBeTruthy();
  });
});

describe("showing a deleted resource", () => {
  it("greys it out with a Deleted badge", () => {
    useResourceStore.getState().put(resource({ lifecycle: "deleted" }));
    const { container } = renderNode(nodeData());

    expect(screen.getByText("Deleted")).toBeTruthy();
    const root = screen.getByTestId("resource-node");
    expect(root.getAttribute("data-lifecycle")).toBe("deleted");
    expect(root.className).toContain("opacity-55");
    expect(container.querySelector("img")?.className).toContain("grayscale");
  });

  it("a deleted resource stays in the diagram", () => {
    useResourceStore.getState().put(resource({ lifecycle: "deleted" }));
    renderNode(nodeData());
    expect(screen.getByText("i-0abc123")).toBeTruthy();
  });

  it("a failed fetch gets a different badge and is not greyed out", () => {
    useResourceStore
      .getState()
      .put(resource({ lifecycle: "error", lastError: "AccessDenied" }));
    renderNode(nodeData());

    expect(screen.getByText("Fetch failed")).toBeTruthy();
    expect(screen.queryByText("Deleted")).toBeNull();
    expect(screen.getByTestId("resource-node").className).not.toContain("opacity-55");
  });

  it("a healthy resource has no badge", () => {
    useResourceStore.getState().put(resource());
    renderNode(nodeData());
    expect(screen.queryByText("Deleted")).toBeNull();
    expect(screen.queryByText("Not linked")).toBeNull();
    expect(screen.queryByText("Not fetched")).toBeNull();
  });
});

describe("resolving the icon", () => {
  it("an unknown key does not break it and says so", () => {
    renderNode(nodeData({ iconKey: "Architecture/Unknown/Nope", resourceRef: null }));
    expect(screen.getByText("No icon")).toBeTruthy();
  });
});

describe("where the connection points sit", () => {
  const handlesOf = (container: HTMLElement) =>
    [...container.querySelectorAll(".react-flow__handle")];

  it("all four appear", () => {
    useResourceStore.getState().put(resource());
    const { container } = renderNode(nodeData());

    const positions = handlesOf(container).map((h) =>
      [...h.classList].find((c) => c.startsWith("react-flow__handle-")),
    );
    expect(positions.toSorted()).toEqual([
      "react-flow__handle-bottom",
      "react-flow__handle-left",
      "react-flow__handle-right",
      "react-flow__handle-top",
    ]);
  });

  it("they sit on the icon's edge, not the node's (so label lines do not move them)", () => {
    useResourceStore.getState().put(resource());
    const { container } = renderNode(nodeData());

    const icon = screen.getByTestId("resource-icon");
    for (const handle of handlesOf(container)) {
      expect(icon.contains(handle)).toBe(true);
    }
  });

  it("more labels leave them inside the icon", () => {
    useResourceStore.getState().put(resource());
    const { container: few } = renderNode(nodeData({ showFields: ["service"] }));
    const fewInside = handlesOf(few).every((h) =>
      few.querySelector('[data-testid="resource-icon"]')!.contains(h),
    );
    cleanup();

    const { container: many } = renderNode(
      nodeData({ showFields: ["service", "name", "resourceId", "tags"] }),
    );
    const manyInside = handlesOf(many).every((h) =>
      many.querySelector('[data-testid="resource-icon"]')!.contains(h),
    );

    expect(fewInside).toBe(true);
    expect(manyInside).toBe(true);
  });

  it("they come after the icon so they are not hidden behind it", () => {
    useResourceStore.getState().put(resource());
    const { container } = renderNode(nodeData());

    const icon = screen.getByTestId("resource-icon");
    const image = icon.querySelector("img")!;
    const handle = container.querySelector(".react-flow__handle")!;
    // Later in the DOM = in front at the same stacking level
    expect(image.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the icon's background", () => {
  it("transparent by default (no fill behind it)", () => {
    useResourceStore.getState().put(resource());
    renderNode(nodeData());
    expect(screen.getByTestId("resource-icon").className).not.toContain("bg-white");
  });

  it("opaque only when straddling a border, to hide the line", () => {
    useResourceStore.getState().put(resource());
    renderNode(nodeData({ mount: "border", borderSide: "left" }));
    expect(screen.getByTestId("resource-icon").className).toContain("bg-white");
  });

  it("the ring appears only when selected", () => {
    useResourceStore.getState().put(resource());
    const { container } = renderNode(nodeData());
    expect(screen.getByTestId("resource-icon").className).not.toContain("ring-2");
    expect(container).toBeTruthy();
  });
});
