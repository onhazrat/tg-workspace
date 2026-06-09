import { describe, it, expect } from "vitest";

import { buildActiveProxies, isNetworkRoutingActive } from "./syncSettings";

describe("syncSettings", () => {
  it("builds direct routing when proxy and tor are disabled", () => {
    expect(
      buildActiveProxies({
        proxyEnabled: false,
        defaultProxyUrls: "http://proxy:8080",
        torEnabled: false,
        torMode: "auto",
        torProxyUrls: "",
      })
    ).toEqual([]);
  });

  it("includes tor auto endpoint when tor is enabled", () => {
    expect(
      buildActiveProxies({
        proxyEnabled: false,
        defaultProxyUrls: "",
        torEnabled: true,
        torMode: "auto",
        torProxyUrls: "",
      })
    ).toEqual(["socks5h://127.0.0.1:9050"]);
  });

  it("detects active network routing", () => {
    expect(
      isNetworkRoutingActive({
        proxyEnabled: true,
        defaultProxyUrls: "http://x",
        torEnabled: false,
        torMode: "auto",
        torProxyUrls: "",
      })
    ).toBe(true);
  });
});
