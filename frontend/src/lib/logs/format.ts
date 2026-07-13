import { formatDateToLocalISO } from "@/lib/utils"

/** Human label for how a network request was routed. */
export function networkConnectionLabel(
  proxyUsed?: string,
): "Tor" | "Proxy" | "Direct" {
  if (!proxyUsed) return "Direct"
  return proxyUsed.includes("socks5h://127.0.0.1") ? "Tor" : "Proxy"
}

/** Format a millisecond timestamp as a local `YYYY-MM-DD` date-input value. */
export function toDateInputValue(timestamp: number | null): string {
  if (!timestamp || Number.isNaN(timestamp)) return ""
  return formatDateToLocalISO(new Date(timestamp)).split("T")[0]
}

/** Parse a `YYYY-MM-DD` date-input value to local midnight in milliseconds. */
export function parseDateInputValue(value: string): number | null {
  if (!value) return null
  const time = new Date(`${value}T00:00:00`).getTime()
  return Number.isNaN(time) ? null : time
}
