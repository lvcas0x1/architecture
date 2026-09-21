import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseResourceGraphInput } from "@architecture/schema";
import { App } from "./App.js";
import { parseDiagram } from "./lib/file.js";
import * as files from "./lib/project.js";
import { useCatalogStore } from "./store/catalog.js";
import { useEditorStore } from "./store/editor.js";
import { useResourceStore } from "./store/resources.js";

vi.mock("./components/Canvas.js", () => ({ Canvas: () => <div>Canvas</div> }));
vi.mock("./components/Palette.js", () => ({ Palette: () => <div>Palette</div> }));
vi.mock("./lib/project.js", async (original) => ({
  ...await original<typeof import("./lib/project.js")>(),
  pickProject: vi.fn(), projectRequest: vi.fn(), writeProject: vi.fn(),
  reserveProjectFile: vi.fn(async (file) => file),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().newDiagram();
  useResourceStore.getState().reset();
  useCatalogStore.setState({ status: "ready", icons: [], byKey: new Map(), scopeOverrides: new Map() });
});
afterEach(cleanup);

it("imports without AWS access and saves human corrections with the inventory", async () => {
  const graph = parseResourceGraphInput({ resources: [{ arn: "arn:aws:ec2:us-east-1:111111111111:instance/i-1",
    accountId: "111111111111", region: "us-east-1", resourceType: "AWS::EC2::Instance", resourceId: "i-1" }] });
  const diagram = parseDiagram(JSON.stringify({ nodes: [
    { id: "box", type: "group", position: { x: 0, y: 0 }, data: { style: "generic", label: "Initial" } },
  ] })).diagram;
  const project = { ...files.protectDiagram(diagram), graph };
  vi.mocked(files.pickProject).mockResolvedValue({ value: graph, file: {} });
  vi.mocked(files.projectRequest).mockResolvedValue(project);
  vi.mocked(files.writeProject).mockResolvedValue({});
  render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByText(/Inventory: 1/);
  expect(useResourceStore.getState().inventory).toHaveLength(1);
  expect(useResourceStore.getState().localInventory).toBe(true);
  act(() => useEditorStore.getState().updateNodeData("box", { label: "Human correction" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(files.writeProject).toHaveBeenCalledOnce());
  const saved = vi.mocked(files.writeProject).mock.calls[0]![0];
  expect(saved.graph.resources).toHaveLength(1);
  expect(saved.authority.protected["nodes:box"]).toContain("data.label");
  await waitFor(() => expect(useEditorStore.getState().dirty).toBe(false));
  expect(files.projectRequest).toHaveBeenCalledExactlyOnceWith("import", { graph });
});
