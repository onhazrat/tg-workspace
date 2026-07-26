import { describe, expect, it } from "bun:test"
import { reportDirection } from "./report-direction"

describe("reportDirection", () => {
  it("marks RTL languages and keeps Persian on its own typeface", () => {
    const persian = reportDirection("Persian", "English")
    expect(persian.dir).toBe("rtl")
    expect(persian.isRTL).toBe(true)
    expect(persian.className).toContain("text-right")
    expect(persian.className).toContain("font-persian")

    const arabic = reportDirection("Arabic", "English")
    expect(arabic.dir).toBe("rtl")
    expect(arabic.className).toContain("font-serif")
  })

  it("leaves LTR languages unstyled", () => {
    const english = reportDirection("English", "Persian")
    expect(english.dir).toBe("ltr")
    expect(english.isRTL).toBe(false)
    expect(english.className).toBe("")
  })

  /**
   * Regression guard for A6's deferred half: the report's direction must come
   * from the record. When it was read from the global `aiLanguage`, opening a
   * saved report had to overwrite that setting to render correctly.
   */
  it("prefers the report's own language over the global setting", () => {
    expect(reportDirection("Persian", "English").dir).toBe("rtl")
    expect(reportDirection("English", "Persian").dir).toBe("ltr")
  })

  it("falls back to the global language before a report exists", () => {
    expect(reportDirection(null, "Persian").dir).toBe("rtl")
    expect(reportDirection(undefined, "English").dir).toBe("ltr")
    // An empty language on a record is treated as absent, not as LTR.
    expect(reportDirection("", "Persian").dir).toBe("rtl")
  })
})
