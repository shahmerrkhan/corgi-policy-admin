import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BalanceSummary } from "@/components/balance-summary";
import { LedgerTable } from "@/components/ledger-table";
import { PolicyDetail } from "@/components/policy-detail";
import { PolicyTimeline } from "@/components/policy-timeline";
import { charge, correctedEntries, statementOf } from "./statement-fixtures";

afterEach(cleanup);

function bodyRows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-entry-type]")];
}

function money(row: HTMLElement) {
  return [...row.querySelectorAll('[data-slot="money-cell"]')].map((m) => m.textContent);
}

describe("LedgerTable", () => {
  it("shows the running balance after each entry, oldest first", () => {
    const { rows } = statementOf([...correctedEntries].reverse());
    const { container } = render(<LedgerTable rows={rows} />);
    const trs = bodyRows(container);
    expect(trs.map((tr) => tr.dataset.entryType)).toEqual(["CHARGE", "PAYMENT", "REVERSAL", "CHARGE"]);
    expect(trs.map(money)).toEqual([
      ["$730.00", "$730.00"],
      ["-$500.00", "$230.00"],
      ["-$730.00", "(500.00) CR"],
      ["$400.00", "(100.00) CR"],
    ]);
  });

  it("strikes through a reversed charge and links it to its reversal", () => {
    const { rows } = statementOf(correctedEntries);
    const { container } = render(<LedgerTable rows={rows} />);
    const original = container.querySelector<HTMLElement>("#entry-c1")!;
    expect(original.dataset.reversed).toBe("true");
    expect(original.querySelector('[data-slot="entry-description"]')?.className).toContain("line-through");
    expect(original.querySelector('[data-slot="money-cell"]')?.className).toContain("line-through");
    const link = within(original).getByRole("link", { name: "Reversed by #3" });
    expect(link.getAttribute("href")).toBe("#entry-r1");
    expect(container.querySelector("#entry-r1")).not.toBeNull();

    const reversal = container.querySelector<HTMLElement>("#entry-r1")!;
    expect(within(reversal).getByText("Reversal of #1")).toBeTruthy();
    expect(within(reversal).getByRole("link", { name: "Reverses #1" }).getAttribute("href")).toBe("#entry-c1");

    const rebook = container.querySelector<HTMLElement>("#entry-c2")!;
    expect(rebook.dataset.reversed).toBeUndefined();
    expect(within(rebook).getByText("Premium, corrected effective date").className).not.toContain("line-through");
  });

  it("expands a charge to show its calculation from the domain", () => {
    const { rows } = statementOf([charge()]);
    render(<LedgerTable rows={rows} />);
    const toggle = screen.getByRole("button", { name: /Premium, policy issued/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-slot="charge-calculation"]')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const calc = document.querySelector<HTMLElement>('[data-slot="charge-calculation"]')!;
    expect(calc.textContent).toContain("$73,000.00 × 100 ÷ 10,000 = $730.00 (exact)");
    expect(calc.textContent).toContain("$730.00 × 365 ÷ 365 = $730.00 (exact)");
    expect(within(calc).queryByRole("status")).toBeNull();
  });

  it("warns, without failing, when a stored charge does not match its calculation", () => {
    const { rows } = statementOf([charge({ amountCents: 72_999 })]);
    render(<LedgerTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /Premium, policy issued/ }));
    expect(screen.getByRole("status").textContent).toContain("Calculation does not match the stored amount");
  });

  it("shows an empty state for a policy with no entries", () => {
    const { rows, balance } = statementOf([]);
    const { container } = render(<LedgerTable rows={rows} />);
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByText("No ledger entries yet")).toBeTruthy();
    expect(balance).toEqual({ kind: "due", cents: 0 });
  });
});

describe("BalanceSummary", () => {
  it("shows a credit balance as Credit with the positive amount", () => {
    const { balance } = statementOf(correctedEntries);
    expect(balance).toEqual({ kind: "credit", cents: 10_000 });
    const { container } = render(<BalanceSummary balance={balance} />);
    expect(container.textContent).toBe("Credit$100.00");
  });

  it("shows money owed as Balance due", () => {
    const { container } = render(<BalanceSummary balance={statementOf([charge()]).balance} />);
    expect(container.textContent).toBe("Balance due$730.00");
  });

  it("shows zero as Balance due $0.00", () => {
    const { container } = render(<BalanceSummary balance={{ kind: "due", cents: 0 }} />);
    expect(container.textContent).toBe("Balance due$0.00");
  });
});

describe("PolicyTimeline", () => {
  const statement = statementOf(correctedEntries.slice(0, 2), {
    eventRows: [
      {
        id: "ev-pay",
        type: "PAYMENT_RECORDED",
        transactionDate: "2026-01-10",
        actorRole: "policyholder",
        actorUserId: "user_holder",
        payload: {},
      },
      {
        id: "ev-issue",
        type: "POLICY_ISSUED",
        transactionDate: "2026-01-01",
        actorRole: "broker",
        actorUserId: "user_broker",
        payload: {},
      },
    ],
    actorNames: [
      { role: "broker", clerkUserId: "user_broker", name: "Harbourline Insurance Brokers" },
      { role: "policyholder", clerkUserId: "user_holder", name: "Maple Lane Landscaping Ltd." },
    ],
  });

  it("lists events newest first with date, label, who and the related entry", () => {
    const { container } = render(<PolicyTimeline events={statement.events} />);
    const items = [...container.querySelectorAll("li")];
    expect(items.map((li) => li.dataset.eventType)).toEqual(["PAYMENT_RECORDED", "POLICY_ISSUED"]);
    expect(items[1]!.textContent).toContain("Jan 1, 2026");
    expect(items[1]!.textContent).toContain("Policy issued");
    expect(items[1]!.textContent).toContain("by Harbourline Insurance Brokers (Broker)");
    expect(within(items[1]!).getByRole("link", { name: "Ledger entry #1" }).getAttribute("href")).toBe("#entry-c1");
    expect(items[0]!.textContent).toContain("by Maple Lane Landscaping Ltd. (Policyholder)");
  });

  it("shows status as dot + text only on payment events", () => {
    const { container } = render(<PolicyTimeline events={statement.events} />);
    const [payment, issued] = [...container.querySelectorAll("li")];
    expect(payment!.querySelector('[data-slot="status-badge"]')?.textContent).toBe("Succeeded");
    expect(issued!.querySelector('[data-slot="status-badge"]')).toBeNull();
  });

  it("falls back to the role, or System, when there is no name", () => {
    const s = statementOf([], {
      eventRows: [
        { id: "a", type: "PAYMENT_RECORDED", transactionDate: "2026-01-02", actorRole: "stripe", actorUserId: null, payload: {} },
        { id: "b", type: "POLICY_ISSUED", transactionDate: "2026-01-01", actorRole: "broker", actorUserId: "user_x", payload: {} },
      ],
    });
    expect(s.events.map((e) => e.actor)).toEqual(["System", "Broker"]);
  });
});

describe("PolicyDetail", () => {
  it("shows the balance at the top, then the statement and the timeline", () => {
    const { container } = render(<PolicyDetail statement={statementOf([charge()])} />);
    const order = [...container.querySelectorAll('[data-slot="balance-summary"], h2')].map((el) => el.textContent);
    expect(order).toEqual(["Balance due$730.00", "Statement", "Timeline"]);
  });
});
