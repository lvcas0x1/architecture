import type { Diagram } from "@architecture/schema";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog.js";

const diagram = {
  schemaVersion: "1.0",
  meta: { title: "production" },
  viewport: { x: 0, y: 0, zoom: 1 },
  layout: { mode: "manual" },
  nodes: [],
  edges: [],
} as unknown as Diagram;

const summary = (over = {}) => ({
  resourceCount: 3,
  iconCount: 2,
  missingResources: [],
  missingIcons: [],
  bytesEstimate: 51200,
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const open = (props: Partial<Parameters<typeof ExportDialog>[0]> = {}) =>
  render(
    <ExportDialog
      open
      onOpenChange={() => {}}
      getDiagram={() => diagram}
      onNotice={() => {}}
      {...props}
    />,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the HTML export dialog", () => {
  it("ignores an older summary after an option changes", async () => {
    const finishes: ((value: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => finishes.push(resolve))),
    );
    const user = userEvent.setup();
    open();
    await user.click(screen.getByLabelText(/raw Describe response/));
    await act(async () => {
      finishes[1]!(jsonResponse(summary({ bytesEstimate: 102400 })));
    });
    expect(screen.getByText(/100 KB/)).toBeTruthy();
    await act(async () => {
      finishes[0]!(jsonResponse(summary({ bytesEstimate: 51200 })));
    });
    expect(screen.getByText(/100 KB/)).toBeTruthy();
    expect(screen.queryByText(/50 KB/)).toBeNull();
  });
  it("shows what will be included first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(summary())),
    );
    open();

    await waitFor(() => expect(screen.getByText(/3 resources/)).toBeTruthy());
    expect(screen.getByText(/50 KB/)).toBeTruthy();
  });

  it("warns about resources that are not fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(summary({ missingResources: ["arn:aws:ec2:::i-1"] })),
      ),
    );
    open();

    await waitFor(() =>
      expect(screen.getByText(/are not fetched yet/)).toBeTruthy(),
    );
  });

  it("the raw response is off by default (it may hold secrets)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(summary())),
    );
    open();

    const checkbox = screen.getByLabelText(/raw Describe response/);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("the parameter view and search are on by default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(summary())),
    );
    open();

    expect(
      (screen.getByLabelText(/parameter view/) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/search box/) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("changing an option recalculates the contents", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return jsonResponse(summary());
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    open();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByLabelText(/Mask account IDs/));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.options.maskAccountIds).toBe(true);
  });

  it("with the backend down it says what to do", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    open();

    await waitFor(() =>
      expect(screen.getByText(/Cannot reach the backend/)).toBeTruthy(),
    );
  });

  it("exporting starts a download", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/export/summary"
        ? jsonResponse(summary())
        : new Response("<!doctype html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const onNotice = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    open({ onNotice, onOpenChange });

    await waitFor(() => expect(screen.getByText(/3 resources/)).toBeTruthy());
    await user.click(screen.getByText("Export"));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(onNotice).toHaveBeenCalledWith("Exported the HTML file.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    click.mockRestore();
  });

  it("shows why it failed, such as the viewer not being built", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/export/summary"
          ? jsonResponse(summary())
          : jsonResponse({ detail: "The viewer has not been built." }, 503),
      ),
    );
    const user = userEvent.setup();
    open();

    await waitFor(() => expect(screen.getByText(/3 resources/)).toBeTruthy());
    await user.click(screen.getByText("Export"));

    await waitFor(() =>
      expect(screen.getByText(/viewer has not been built/)).toBeTruthy(),
    );
  });

  it("says when an icon cannot be included", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(summary({ missingIcons: ["Architecture/Compute/Gone"] })),
      ),
    );
    open();

    await waitFor(() =>
      expect(screen.getByText(/icon file\(s\) are missing/)).toBeTruthy(),
    );
  });
});

describe("what masking covers", () => {
  it("is spelled out only while masking is on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(summary())),
    );
    open();

    expect(screen.queryByTestId("mask-scope")).toBeNull();

    await userEvent.click(screen.getByLabelText(/Mask account IDs/));
    const note = await screen.findByTestId("mask-scope");

    expect(note.textContent).toMatch(
      /title and the download file name are left/,
    );
  });
});
