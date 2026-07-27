/**
 * Human-readable date ranges for display prose.
 *
 * `formatDateToLocalISO` (`lib/utils.tsx`) exists to feed
 * `<input type="datetime-local">`, whose `value` must literally be
 * `YYYY-MM-DDTHH:mm`. That is correct for a form field and wrong for a sentence,
 * and reusing it for one is how the Discovery Scope card came to read
 * `Date range: 2026-07-24T23:54 – 2026-07-25T00:24`.
 *
 * Locale is a parameter rather than the ambient default so the output is
 * assertable in tests; production passes nothing and gets the user's locale.
 */

/** Same calendar day in local time — not the same 24 hours. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * `24 Jul 2026, 11:54 PM – 25 Jul 2026, 12:24 AM`, collapsing to
 * `25 Jul 2026, 11:54 PM – 12:24 AM` when both ends fall on one day.
 */
export function formatDateRange(
  start: Date,
  end: Date,
  locale?: string,
): string {
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  })

  const startText = `${day.format(start)}, ${time.format(start)}`
  if (isSameLocalDay(start, end)) {
    return `${startText} – ${time.format(end)}`
  }
  return `${startText} – ${day.format(end)}, ${time.format(end)}`
}
