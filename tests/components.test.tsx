import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MoneyCell } from "@/components/money-cell";
import { StatusBadge } from "@/components/status-badge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it.each([
    ["pending", "Pending"],
    ["succeeded", "Succeeded"],
    ["failed", "Failed"],
  ] as const)("renders %s as %s", (status, label) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.querySelector('[data-slot="status-badge"]');
    expect(badge?.textContent).toBe(label);
    expect(badge?.getAttribute("data-status")).toBe(status);
  });
});

describe("MoneyCell", () => {
  it("renders a formatted amount, right-aligned, in mono", () => {
    const { container } = render(<MoneyCell cents={123456} />);
    const cell = container.querySelector('[data-slot="money-cell"]');
    expect(cell?.textContent).toBe("$1,234.56");
    expect(cell?.classList.contains("text-right")).toBe(true);
    expect(cell?.classList.contains("font-mono")).toBe(true);
  });

  it("renders negative amounts with a minus sign", () => {
    const { container } = render(<MoneyCell cents={-123400} />);
    expect(container.textContent).toBe("-$1,234.00");
  });

  it("renders credit balances as (x) CR", () => {
    const { container } = render(<MoneyCell cents={-61200} variant="balance" />);
    const cell = container.querySelector('[data-slot="money-cell"]');
    expect(cell?.textContent).toBe("(612.00) CR");
    expect(cell?.classList.contains("text-right")).toBe(true);
    expect(cell?.classList.contains("font-mono")).toBe(true);
  });
});
