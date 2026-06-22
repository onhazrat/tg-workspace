/** Rewrite backend email links to the Playwright app origin (path + query only). */
export function toPlaywrightAppUrl(href: string): string {
  const parsed = new URL(href, "http://localhost:5173")
  return `${parsed.pathname}${parsed.search}`
}
