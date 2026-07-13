import { describe, expect, it } from "bun:test"
import {
  effectiveProxyCapacity,
  normalizeProxyUrl,
  slotsForProxy,
} from "./proxy-concurrency"

describe("normalizeProxyUrl", () => {
  it("prefixes local addresses with socks5h://", () => {
    expect(normalizeProxyUrl("127.0.0.1:9050")).toBe("socks5h://127.0.0.1:9050")
    expect(normalizeProxyUrl("localhost:9050")).toBe("socks5h://localhost:9050")
  })

  it("prefixes remote addresses with http://", () => {
    expect(normalizeProxyUrl("1.2.3.4:8080")).toBe("http://1.2.3.4:8080")
  })

  it("upgrades socks5:// to socks5h://", () => {
    expect(normalizeProxyUrl("socks5://1.2.3.4:1080")).toBe(
      "socks5h://1.2.3.4:1080",
    )
  })

  it("keeps explicit schemes and trims whitespace", () => {
    expect(normalizeProxyUrl(" http://user:pass@host:3128 ")).toBe(
      "http://user:pass@host:3128",
    )
  })
})

describe("slotsForProxy", () => {
  it("uses the override keyed by the normalized url", () => {
    expect(
      slotsForProxy("127.0.0.1:9050", { "socks5h://127.0.0.1:9050": 4 }, 2),
    ).toBe(4)
  })

  it("falls back to the default concurrency", () => {
    expect(slotsForProxy("1.2.3.4:8080", {}, 2)).toBe(2)
  })
})

describe("effectiveProxyCapacity", () => {
  it("sums slots across proxies, honoring overrides", () => {
    expect(
      effectiveProxyCapacity(
        ["127.0.0.1:9050", "1.2.3.4:8080"],
        { "socks5h://127.0.0.1:9050": 3 },
        2,
      ),
    ).toBe(5)
  })

  it("is zero for an empty proxy list", () => {
    expect(effectiveProxyCapacity([], {}, 2)).toBe(0)
  })
})
