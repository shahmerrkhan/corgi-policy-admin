// Display-only date formatting for plain YYYY-MM-DD strings. No Date objects, so a time
// zone can never shift the day.
import { parseIsoDate } from "@/lib/domain";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-22" -> "Feb 22, 2026" (plain-language history). Throws on an invalid date. */
export function formatShortDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}
