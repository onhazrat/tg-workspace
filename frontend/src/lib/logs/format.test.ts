import { describe, expect, test } from "bun:test"

import {
  networkConnectionLabel,
  parseDateInputValue,
  toDateInputValue,
} from "@/lib/logs/format"

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

describe("date input helpers", () => {
  test("parse then format round-trips the input", () => {
    const ts = parseDateInputValue("2026-07-12")
    expect(ts).not.toBeNull()
    expect(toDateInputValue(ts)).toBe("2026-07-12")
  })

  test("empty input parses to null", () => {
    expect(parseDateInputValue("")).toBeNull()
  })

  test("invalid input parses to null", () => {
    expect(parseDateInputValue("not-a-date")).toBeNull()
  })

  test("null or invalid timestamps format to empty string", () => {
    expect(toDateInputValue(null)).toBe("")
    expect(toDateInputValue(Number.NaN)).toBe("")
  })
})
