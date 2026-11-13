import { EntryLink } from "@/components/ledger-table";
import { StatusBadge } from "@/components/status-badge";
import { formatShortDate } from "@/lib/format/date";
import type { TimelineEvent } from "@/lib/services/statement-view";

// Event log, newest first (the read model orders it). Payment events carry the payment's
// status as dot + text (StatusBadge); other events have no status.
export function PolicyTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }
  return (
    <ol data-slot="policy-timeline" className="flex flex-col border-l border-border-strong">
      {events.map((e) => (
        <li
          key={e.id}
          data-event-type={e.type}
          className="relative flex flex-col gap-0.5 py-2 pl-4 before:absolute before:top-3.5 before:-left-px before:h-px before:w-2.5 before:bg-border-strong"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <time dateTime={e.transactionDate} className="text-sm text-muted-foreground">
              {formatShortDate(e.transactionDate)}
            </time>
            <span className="text-sm font-medium">{e.label}</span>
            {e.paymentStatus ? <StatusBadge status={e.paymentStatus} /> : null}
          </div>
          {e.detail ? (
            <p data-slot="event-detail" className="text-sm break-words">
              {e.detail}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            <span>by {e.actor}</span>
            {e.relatedEntries.map((ref) => (
              <EntryLink key={ref.id} to={ref}>
                Ledger entry #{ref.seq}
              </EntryLink>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
