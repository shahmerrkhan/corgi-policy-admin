// Real "today" in Toronto as YYYY-MM-DD. Used only as a form default; every command
// still receives its transaction date explicitly.
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
