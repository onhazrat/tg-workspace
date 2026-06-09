/** Shared proxy/Tor list builder for scrape, publish, and channel-info calls. */

export interface ProxySettings {
  proxyEnabled: boolean;
  defaultProxyUrls: string;
  torEnabled: boolean;
  torMode: "auto" | "custom";
  torProxyUrls: string;
}

export function parseProxyList(raw: string): string[] {
  return raw.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
}

export function buildActiveProxies(settings: ProxySettings): string[] {
  const proxies = parseProxyList(settings.defaultProxyUrls);
  const torPool = parseProxyList(settings.torProxyUrls);
  const active: string[] = [];

  if (settings.proxyEnabled) {
    active.push(...proxies);
  }
  if (settings.torEnabled) {
    if (settings.torMode === "auto") {
      active.push("socks5h://127.0.0.1:9050");
    } else {
      active.push(...torPool);
    }
  }
  return active;
}

export function isNetworkRoutingActive(settings: ProxySettings): boolean {
  return settings.proxyEnabled || settings.torEnabled;
}
