// Real "today" in Toronto as YYYY-MM-DD. Used as a form default, and by the Stripe webhook
// to date a live payment from the event's timestamp. Commands still receive dates explicitly.
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
