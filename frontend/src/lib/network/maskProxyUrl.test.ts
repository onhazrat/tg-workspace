import { describe, expect, it } from "bun:test"
import {
  hasProxyCredentials,
  maskProxyList,
  maskProxyUrl,
} from "./maskProxyUrl"

describe("maskProxyUrl", () => {
  it("masks user:password credentials, keeping scheme, host and port", () => {
    expect(maskProxyUrl("socks5h://someuser:s3cr3t@203.0.113.10:6328")).toBe(
      "socks5h://***@203.0.113.10:6328",
    )
    expect(maskProxyUrl("http://user:pass@proxy.example.com:8080")).toBe(
      "http://***@proxy.example.com:8080",
    )
  })

  it("masks a username-only credential", () => {
    expect(maskProxyUrl("socks5://user@host:1080")).toBe(
      "socks5://***@host:1080",
    )
  })

  it("leaves credential-free URLs untouched", () => {
    expect(maskProxyUrl("socks5h://203.0.113.10:6328")).toBe(
      "socks5h://203.0.113.10:6328",
    )
    expect(maskProxyUrl("http://127.0.0.1:9050")).toBe("http://127.0.0.1:9050")
  })

  it("passes through 'direct' and empty input", () => {
    expect(maskProxyUrl("direct")).toBe("direct")
    expect(maskProxyUrl("")).toBe("")
    expect(maskProxyUrl("   ")).toBe("   ")
  })

  it("returns malformed input unchanged rather than mangling it", () => {
    expect(maskProxyUrl("not a url")).toBe("not a url")
    expect(maskProxyUrl("socks5h://")).toBe("socks5h://")
    // Half-typed, mid-edit: no scheme separator yet.
    expect(maskProxyUrl("user:pass@host")).toBe("user:pass@host")
  })

  it("splits at the last @ when the password contains one", () => {
    expect(maskProxyUrl("http://user:p@ss@host:8080")).toBe(
      "http://***@host:8080",
    )
  })

  it("does not treat an @ in the path as a credential", () => {
    expect(maskProxyUrl("http://host:8080/a@b")).toBe("http://host:8080/a@b")
  })

  it("preserves surrounding whitespace instead of leaking an indented line", () => {
    expect(maskProxyUrl("  socks5h://u:p@host:1  ")).toBe(
      "  socks5h://***@host:1  ",
    )
  })
})

describe("maskProxyList", () => {
  it("masks each line and preserves line structure", () => {
    const list = [
      "socks5h://u1:p1@1.1.1.1:1080",
      "socks5h://2.2.2.2:1080",
      "",
      "http://u2:p2@3.3.3.3:8080",
    ].join("\n")

    expect(maskProxyList(list)).toBe(
      [
        "socks5h://***@1.1.1.1:1080",
        "socks5h://2.2.2.2:1080",
        "",
        "http://***@3.3.3.3:8080",
      ].join("\n"),
    )
  })

  it("keeps blank trailing lines so the masked text lines up with the editor", () => {
    expect(maskProxyList("socks5h://u:p@h:1\n\n")).toBe("socks5h://***@h:1\n\n")
  })
})

describe("hasProxyCredentials", () => {
  it("detects a credentialed line anywhere in the list", () => {
    expect(hasProxyCredentials("socks5h://h:1\nhttp://u:p@h:2")).toBe(true)
  })

  it("is false when nothing needs hiding", () => {
    expect(hasProxyCredentials("socks5h://h:1\nhttp://h:2")).toBe(false)
    expect(hasProxyCredentials("")).toBe(false)
  })
})
