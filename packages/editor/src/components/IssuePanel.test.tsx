import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../lib/validate.js";
import { IssuePanel } from "./IssuePanel.js";

const issues: Issue[] = [
  { level: "error", message: "Icon is not in the catalog: X/Y/Z", nodeIds: ["n1"] },
  { level: "warning", message: "2 icons have no resource JSON linked", nodeIds: ["n2", "n3"] },
];

afterEach(cleanup);

const open = (over: Partial<Parameters<typeof IssuePanel>[0]> = {}) => {
  const props = { issues, onFocus: vi.fn(), onClose: vi.fn(), ...over };
  render(<IssuePanel {...props} />);
  return props;
};

describe("the check-results panel", () => {
  it("renders nothing when there are no problems", () => {
    const { container } = render(
      <IssuePanel issues={[]} onFocus={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("puts the error count in the heading", () => {
    open();
    expect(screen.getByText(/1 error/)).toBeTruthy();
  });

  it("warnings alone read as to review", () => {
    open({ issues: [issues[1]!] });
    expect(screen.getByText(/1 to review/)).toBeTruthy();
  });

  it("clicking a row selects its nodes", async () => {
    const user = userEvent.setup();
    const props = open();
    await user.click(screen.getByText("2 icons have no resource JSON linked"));
    expect(props.onFocus).toHaveBeenCalledWith(["n2", "n3"]);
  });

  it("collapses", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByLabelText("Collapse"));
    expect(screen.queryByText(/not in the catalog/)).toBeNull();
  });

  it("closes", async () => {
    const user = userEvent.setup();
    const props = open();
    await user.click(screen.getByLabelText("Close check results"));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
