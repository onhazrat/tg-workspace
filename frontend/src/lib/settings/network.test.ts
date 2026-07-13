import { describe, expect, it } from "bun:test"
import {
  buildNetworkSavePayload,
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
