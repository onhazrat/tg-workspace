import { describe, expect, it } from "bun:test"
import {
  buildNetworkSavePayload,
  legacyNetworkFlags,
  mergeNetworkSettings,
  NETWORK_SETTINGS_DEFAULTS,
} from "./network"

describe("mergeNetworkSettings", () => {
  it("returns the defaults untouched for an empty payload", () => {
    expect(mergeNetworkSettings(NETWORK_SETTINGS_DEFAULTS, {})).toEqual(
      NETWORK_SETTINGS_DEFAULTS,
    )
  })

  it("joins server proxyUrls arrays into newline-separated text", () => {
    const merged = mergeNetworkSettings(NETWORK_SETTINGS_DEFAULTS, {
      proxyUrls: ["http://a:1", "http://b:2"],
    })
    expect(merged.defaultProxyUrls).toBe("http://a:1\nhttp://b:2")
  })

  it("applies valid fields and ignores malformed ones", () => {
    const merged = mergeNetworkSettings(NETWORK_SETTINGS_DEFAULTS, {
      proxyEnabled: true,
      torEnabled: "yes",
      torMode: "custom",
      torRotationStrategy: "diagonal",
      torControlPort: 9151,
      torRotationThreshold: "many",
    })
    expect(merged.proxyEnabled).toBe(true)
    expect(merged.torEnabled).toBe(false)
    expect(merged.torMode).toBe("custom")
    expect(merged.torRotationStrategy).toBe("sequential")
    expect(merged.torControlPort).toBe(9151)
    expect(merged.torRotationThreshold).toBe(10)
  })

  // Every field at once, so a field the merge forgets (or copies under the
  // wrong name) fails here rather than silently keeping its default.
  const full = {
    proxyEnabled: true,
    defaultProxyUrls: "http://a:1",
    proxyDefaultConcurrency: 4,
    proxyConcurrencyOverrides: { "http://a:1": 2 },
    envFallbackConfigured: true,
    torAvailable: true,
    torEnabled: true,
    torMode: "custom",
    torProxyUrls: "socks5h://tor:9050",
    torRotationStrategy: "random",
    torControlEnabled: true,
    torControlPort: 9151,
    torAutoRotate: true,
    torRotationThreshold: 3,
  } as const

  it("applies every field of a well-formed payload, read-only ones included", () => {
    expect(mergeNetworkSettings(NETWORK_SETTINGS_DEFAULTS, full)).toEqual(full)
  })

  it("keeps the current value of every field sent with the wrong type", () => {
    const malformed = Object.fromEntries(
      Object.keys(full).map((key) => [key, null]),
    )
    expect(mergeNetworkSettings(full, malformed)).toEqual(full)
    expect(
      mergeNetworkSettings(full, {
        proxyEnabled: "true",
        proxyDefaultConcurrency: "4",
        proxyConcurrencyOverrides: "none",
        torMode: "manual",
        torProxyUrls: 9050,
      }),
    ).toEqual(full)
  })

  it("prefers the server's proxyUrls list over a defaultProxyUrls string", () => {
    const merged = mergeNetworkSettings(NETWORK_SETTINGS_DEFAULTS, {
      proxyUrls: ["http://list:1"],
      defaultProxyUrls: "http://text:1",
    })
    expect(merged.defaultProxyUrls).toBe("http://list:1")
  })
})

describe("buildNetworkSavePayload", () => {
  it("splits proxy urls and excludes read-only fields", () => {
    const payload = buildNetworkSavePayload({
      ...NETWORK_SETTINGS_DEFAULTS,
      proxyEnabled: true,
      defaultProxyUrls: "http://a:1\nhttp://b:2, http://c:3",
    })
    expect(payload.proxyUrls).toEqual([
      "http://a:1",
      "http://b:2",
      "http://c:3",
    ])
    expect(payload.proxyEnabled).toBe(true)
    expect("envFallbackConfigured" in payload).toBe(false)
    expect("torAvailable" in payload).toBe(false)
    expect("defaultProxyUrls" in payload).toBe(false)
  })
})

describe("legacyNetworkFlags", () => {
  const storage = (record: Record<string, string>) => ({
    getItem: (key: string) => record[key] ?? null,
  })

  it("takes stored flags the server lacks, as booleans", () => {
    expect(
      legacyNetworkFlags(
        {},
        storage({ proxyEnabled: "true", torEnabled: "false" }),
      ),
    ).toEqual({ proxyEnabled: true, torEnabled: false })
  })

  it("lets the server win and ignores absent keys", () => {
    expect(
      legacyNetworkFlags(
        { proxyEnabled: false },
        storage({ proxyEnabled: "true" }),
      ),
    ).toEqual({})
  })
})
