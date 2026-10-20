/** Human label for how a network request was routed. */
export function networkConnectionLabel(
  proxyUsed?: string,
): "Tor" | "Proxy" | "Direct" {
  if (!proxyUsed) return "Direct"
  return proxyUsed.includes("socks5h://127.0.0.1") ? "Tor" : "Proxy"
}
