"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ChargeCalculation } from "@/components/charge-calculation";
import { DateCell } from "@/components/date-cell";
import { EmptyState } from "@/components/empty-state";
import { MoneyCell } from "@/components/money-cell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { StatementRow } from "@/lib/services/statement-view";

// Statement ledger. Oldest first, running balance per row, all amounts from the server.
// At md and up it is a normal table. Below md every row stacks into a grid (date,
// description, then amount and balance) so nothing scrolls sideways at 390px. Explicit
// roles keep the table semantics when the display is changed.

type LedgerTableProps = {
  rows: StatementRow[];
  emptyTitle?: string;
};

const STACK_TABLE = "max-md:block";
const STACK_ROW =
  "max-md:grid max-md:h-auto max-md:grid-cols-[1fr_auto_auto] max-md:gap-x-4 max-md:gap-y-1 max-md:py-2";
const STACK_CELL = "max-md:px-3 max-md:whitespace-normal";

export function EntryLink({ to, children }: { to: { id: string; seq: number }; children: React.ReactNode }) {
  return (
    <a href={`#entry-${to.id}`} className="text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function LedgerTable({ rows, emptyTitle = "No ledger entries yet" }: LedgerTableProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description="Charges, payments and refunds appear here." />;
  }
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Table role="table" data-slot="ledger-table" className={STACK_TABLE}>
      <TableHeader role="rowgroup" className="max-md:sr-only">
        <TableRow role="row">
          <TableHead role="columnheader">Date</TableHead>
          <TableHead role="columnheader">Description</TableHead>
          <TableHead role="columnheader" className="text-right">
            Amount
          </TableHead>
          <TableHead role="columnheader" className="text-right">
            Balance
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody role="rowgroup" className={STACK_TABLE}>
        {rows.map((r) => {
          const reversed = r.reversedBy !== null;
          const expanded = open.has(r.id);
          const detailId = `calc-${r.id}`;
          return (
            <Fragment key={r.id}>
              <TableRow
                role="row"
                id={`entry-${r.id}`}
                data-entry-type={r.type}
                data-reversed={reversed || undefined}
                className={cn(STACK_ROW, "scroll-mt-4 target:bg-sunken")}
              >
                <TableCell role="cell" className={cn(STACK_CELL, "max-md:col-span-3")}>
                  <DateCell date={r.date} />
                  <span className="ml-2 font-mono text-xs text-muted-foreground">#{r.seq}</span>
                </TableCell>
                <TableCell role="cell" className={cn(STACK_CELL, "max-md:col-span-3")}>
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {r.calculation ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={detailId}
                        onClick={() => toggle(r.id)}
                        className="inline-flex items-center gap-1 text-left text-foreground hover:text-accent"
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
                        />
                        <span data-slot="entry-description" className={cn(reversed && "line-through")}>
                          {r.description}
                        </span>
                        <span className="sr-only">{expanded ? ", hide calculation" : ", show calculation"}</span>
                      </button>
                    ) : (
                      <span data-slot="entry-description" className={cn(reversed && "line-through")}>
                        {r.description}
                      </span>
                    )}
                    {r.reversedBy ? (
                      <span className="text-xs text-muted-foreground">
                        <span className="sr-only">Reversed. </span>
                        <EntryLink to={r.reversedBy}>Reversed by #{r.reversedBy.seq}</EntryLink>
                      </span>
                    ) : null}
                    {r.reverses ? (
                      <span className="text-xs text-muted-foreground">
                        <EntryLink to={r.reverses}>Reverses #{r.reverses.seq}</EntryLink>
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell role="cell" className={cn(STACK_CELL, "max-md:col-start-2")}>
                  <span className="text-xs text-muted-foreground md:hidden">Amount</span>
                  <MoneyCell
                    cents={r.amountCents}
                    className={cn(reversed && "text-muted-foreground line-through")}
                  />
                </TableCell>
                <TableCell role="cell" className={STACK_CELL}>
                  <span className="text-xs text-muted-foreground md:hidden">Balance</span>
                  <MoneyCell cents={r.balanceCents} variant="balance" />
                </TableCell>
              </TableRow>
              {r.calculation && expanded ? (
                <TableRow role="row" id={detailId} className={cn(STACK_ROW, "bg-sunken hover:bg-sunken max-md:block")}>
                  <TableCell role="cell" colSpan={4} className={cn(STACK_CELL, "whitespace-normal md:pl-9")}>
                    <ChargeCalculation calc={r.calculation} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
