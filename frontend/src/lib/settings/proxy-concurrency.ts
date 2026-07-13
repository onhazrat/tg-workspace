/** Pure helpers for per-proxy concurrency slots in the network settings UI. */

/**
 * Normalize a raw proxy line to the canonical URL used as the override key:
 * local addresses default to socks5h://, remote ones to http://, and plain
 * socks5:// is upgraded to socks5h:// (remote DNS).
 */
export function normalizeProxyUrl(proxyUrl: string): string {
  let url = proxyUrl.trim()
  if (!url.includes("://")) {
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      url = `socks5h://${url}`
    } else {
      url = `http://${url}`
    }
  }
  if (url.startsWith("socks5://")) {
    url = url.replace("socks5://", "socks5h://")
  }
  return url
}

/** Concurrency slots for one proxy: per-proxy override, else the default. */
export function slotsForProxy(
  url: string,
  overrides: Record<string, number>,
  defaultConcurrency: number,
): number {
  return overrides[normalizeProxyUrl(url)] ?? defaultConcurrency
}

/** Total parallel capacity across the configured proxy list. */
export function effectiveProxyCapacity(
  proxyLines: string[],
  overrides: Record<string, number>,
  defaultConcurrency: number,
): number {
  return proxyLines.reduce(
    (sum, url) => sum + slotsForProxy(url, overrides, defaultConcurrency),
    0,
  )
}
