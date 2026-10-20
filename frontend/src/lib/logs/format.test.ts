import { describe, expect, test } from "bun:test"

import { networkConnectionLabel } from "@/lib/logs/format"

describe("networkConnectionLabel", () => {
  test("no proxy is Direct", () => {
    expect(networkConnectionLabel(undefined)).toBe("Direct")
    expect(networkConnectionLabel("")).toBe("Direct")
  })

  test("local socks5h proxy is Tor", () => {
    expect(networkConnectionLabel("socks5h://127.0.0.1:9050")).toBe("Tor")
  })

  test("any other proxy is Proxy", () => {
    expect(networkConnectionLabel("http://proxy.example:8080")).toBe("Proxy")
    expect(networkConnectionLabel("socks5h://10.0.0.5:9050")).toBe("Proxy")
  })
})
