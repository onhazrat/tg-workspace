/**
 * A Channel counter or View count, rendered the way Telegram renders it.
 *
 * The server stores and sends the number (ADR-023): `28300`, not `"28.3K"`.
 * This puts the text back: exact below 1,000, three significant digits above.
 * Fixed to English because Telegram renders ASCII digits on every channel,
 * Persian and Arabic ones included, and the page is what a reader compares to.
 */
const COUNT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumSignificantDigits: 3,
})

export function formatCount(count: number): string {
  return COUNT.format(count)
}
