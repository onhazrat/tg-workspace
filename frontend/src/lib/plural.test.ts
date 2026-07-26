import { describe, expect, it } from "bun:test"
import { countOf, pluralize } from "./plural"

describe("pluralize", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralize(1, "channel")).toBe("channel")
    expect(pluralize(0, "channel")).toBe("channels")
    expect(pluralize(2, "channel")).toBe("channels")
  })

  it("accepts an irregular plural", () => {
    expect(pluralize(2, "entry", "entries")).toBe("entries")
    expect(pluralize(1, "entry", "entries")).toBe("entry")
  })
})

describe("countOf", () => {
  it("renders count and noun together", () => {
    expect(countOf(1, "channel")).toBe("1 channel")
    expect(countOf(43, "channel")).toBe("43 channels")
    expect(countOf(0, "channel")).toBe("0 channels")
  })

  // The string the audit flagged: `43 selected channel(s)`.
  it("never emits the (s) hedge", () => {
    for (const n of [0, 1, 2, 43]) {
      expect(countOf(n, "channel")).not.toContain("(s)")
    }
  })
})
