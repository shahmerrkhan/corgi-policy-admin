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

describe("Added coverage (step 8)", () => {
  // $730 policy charge paid in full, then Liquor Liability $73,000 at 100 bps effective
  // 2026-03-01: 306 of 365 days = $612.00.
  const coverage = charge({
    id: "c-liquor",
    date: "2026-11-13",
    seq: 3,
    amountCents: 61_200,
    effectiveDate: "2026-03-01",
    coverageLineId: "line-liquor",
    daysInEffect: 306,
  });
  const statement = statementOf([...correctedEntries.slice(0, 2), coverage], {
    entryRows: [
      { entry: correctedEntries[0]!, eventId: "ev-issue" },
      { entry: correctedEntries[1]!, eventId: "ev-pay" },
      { entry: coverage, eventId: "ev-cov" },
    ],
    eventRows: [
      { id: "ev-cov", type: "COVERAGE_ADDED", transactionDate: "2026-11-13", actorRole: "broker", actorUserId: "user_broker", payload: {} },
      { id: "ev-pay", type: "PAYMENT_RECORDED", transactionDate: "2026-01-10", actorRole: "stripe", actorUserId: null, payload: {} },
      { id: "ev-issue", type: "POLICY_ISSUED", transactionDate: "2026-01-01", actorRole: "broker", actorUserId: "user_broker", payload: {} },
    ],
    lineRows: [{ id: "line-liquor", name: "Liquor Liability", limitCents: 7_300_000, rateBps: 100 }],
    actorNames: [{ role: "broker", clerkUserId: "user_broker", name: "Harbourline Insurance Brokers" }],
  });

  it("shows the coverage charge with its own limit, days and the $612.00 proration", () => {
    const { container } = render(<LedgerTable rows={statement.rows} />);
    const row = container.querySelector<HTMLElement>("#entry-c-liquor")!;
    expect(money(row)).toEqual(["$612.00", "$842.00"]);
    const toggle = within(row).getByRole("button", { name: /Premium, Liquor Liability/ });
    fireEvent.click(toggle);
    const calc = document.querySelector<HTMLElement>('[data-slot="charge-calculation"]')!;
    expect(calc.textContent).toContain("Limit (Liquor Liability)");
    expect(calc.textContent).toContain("$73,000.00 × 100 ÷ 10,000 = $730.00 (exact)");
    expect(calc.textContent).toContain("$730.00 × 306 ÷ 365 = $612.00 (exact)");
    expect(within(calc).queryByRole("status")).toBeNull();
  });

  it("raises the balance due by the charge and lists Coverage added in the timeline", () => {
    expect(statement.balance).toEqual({ kind: "due", cents: 23_000 + 61_200 });
    const { container } = render(<PolicyTimeline events={statement.events} />);
    const first = container.querySelector("li")!;
    expect(first.dataset.eventType).toBe("COVERAGE_ADDED");
    expect(first.textContent).toContain("Coverage added");
    expect(first.textContent).toContain("by Harbourline Insurance Brokers (Broker)");
    expect(within(first).getByRole("link", { name: "Ledger entry #3" }).getAttribute("href")).toBe("#entry-c-liquor");
  });

  it("is read-only for the policyholder: no actions unless the page passes them", () => {
    render(<PolicyDetail statement={statement} />);
    expect(screen.queryByRole("link", { name: "Add coverage" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
  });
});

describe("Coverage date corrected (step 9)", () => {
  // Liquor Liability $612.00 (2026-03-01, 306/365), fully paid, corrected to 2026-02-22
  // (313/365 = $626.00): reversal -$612.00, new charge $626.00, balance due $14.00.
  const original = charge({ id: "c-old", date: "2026-03-01", seq: 1, amountCents: 61_200, effectiveDate: "2026-03-01", coverageLineId: "line-liquor", daysInEffect: 306 });
  const pay = { id: "p1", type: "PAYMENT" as const, date: "2026-03-05", seq: 2, amountCents: -61_200, paymentId: "pay-1" };
  const reversal = { id: "r1", type: "REVERSAL" as const, date: "2026-03-22", seq: 3, amountCents: -61_200, reversesEntryId: "c-old" };
  const rebook = charge({ id: "c-new", date: "2026-03-22", seq: 4, amountCents: 62_600, effectiveDate: "2026-02-22", coverageLineId: "line-liquor", rebookOf: "c-old", daysInEffect: 313 });
  const statement = statementOf([original, pay, reversal, rebook], {
    entryRows: [
      { entry: original, eventId: "ev-cov" },
      { entry: pay, eventId: "ev-pay" },
      { entry: reversal, eventId: "ev-fix" },
      { entry: rebook, eventId: "ev-fix" },
    ],
    eventRows: [
      {
        id: "ev-fix",
        type: "COVERAGE_DATE_CORRECTED",
        transactionDate: "2026-03-22",
        actorRole: "broker",
        actorUserId: "user_broker",
        payload: { coverageName: "Liquor Liability", oldEffectiveDate: "2026-03-01", newEffectiveDate: "2026-02-22", reason: "Keyed the wrong start date" },
      },
      { id: "ev-pay", type: "PAYMENT_RECORDED", transactionDate: "2026-03-05", actorRole: "stripe", actorUserId: null, payload: {} },
      { id: "ev-cov", type: "COVERAGE_ADDED", transactionDate: "2026-03-01", actorRole: "broker", actorUserId: "user_broker", payload: {} },
    ],
    lineRows: [{ id: "line-liquor", name: "Liquor Liability", limitCents: 7_300_000, rateBps: 100 }],
    actorNames: [{ role: "broker", clerkUserId: "user_broker", name: "Harbourline Insurance Brokers" }],
  });

  it("shows the original struck through and linked, the reversal, and the corrected charge; balance due $14.00", () => {
    const { container } = render(<LedgerTable rows={statement.rows} />);
    const old = container.querySelector<HTMLElement>("#entry-c-old")!;
    expect(old.dataset.reversed).toBe("true");
    expect(within(old).getByRole("link", { name: "Reversed by #3" }).getAttribute("href")).toBe("#entry-r1");
    const rev = container.querySelector<HTMLElement>("#entry-r1")!;
    expect(within(rev).getByRole("link", { name: "Reverses #1" }).getAttribute("href")).toBe("#entry-c-old");
    expect(money(rev)).toEqual(["-$612.00", "(612.00) CR"]);
    const fresh = container.querySelector<HTMLElement>("#entry-c-new")!;
    expect(fresh.querySelector('[data-slot="entry-description"]')?.textContent).toBe("Premium, Liquor Liability (corrected)");
    expect(money(fresh)).toEqual(["$626.00", "$14.00"]);
    fireEvent.click(within(fresh).getByRole("button", { name: /Liquor Liability \(corrected\)/ }));
    const calc = document.querySelector<HTMLElement>('[data-slot="charge-calculation"]')!;
    expect(calc.textContent).toContain("$730.00 × 313 ÷ 365 = $626.00 (exact)");
    expect(statement.balance).toEqual({ kind: "due", cents: 1_400 });
  });

  it("timeline shows Coverage date corrected with the dates and reason, linked to both new entries", () => {
    const { container } = render(<PolicyTimeline events={statement.events} />);
    const first = container.querySelector("li")!;
    expect(first.dataset.eventType).toBe("COVERAGE_DATE_CORRECTED");
    expect(first.textContent).toContain("Coverage date corrected");
    expect(first.querySelector('[data-slot="event-detail"]')?.textContent).toBe(
      "Liquor Liability: 2026-03-01 to 2026-02-22. Reason: Keyed the wrong start date",
    );
    expect(within(first).getAllByRole("link").map((a) => a.textContent)).toEqual(["Ledger entry #3", "Ledger entry #4"]);
  });

  it("lists the coverage line at its current date; Correct date only when the page passes correctHref", () => {
    expect(statement.coverageLines).toEqual([
      { id: "line-liquor", name: "Liquor Liability", limitCents: 7_300_000, rateBps: 100, effectiveDate: "2026-02-22", liveChargeId: "c-new", liveChargeCents: 62_600 },
    ]);
    const { unmount } = render(<PolicyDetail statement={statement} />);
    expect(screen.getByText("2026-02-22", { selector: '[data-slot="line-effective-date"]' })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Correct date/ })).toBeNull();
    unmount();
    render(<PolicyDetail statement={statement} correctHref={(id) => `/fix/${id}`} />);
    expect(screen.getByRole("link", { name: /Correct date/ }).getAttribute("href")).toBe("/fix/line-liquor");
  });
});
