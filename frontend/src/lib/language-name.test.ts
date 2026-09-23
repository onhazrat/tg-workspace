import { describe, expect, it } from "bun:test"

import { languageName } from "@/lib/language-name"

describe("languageName", () => {
  it("names a code in the locale it is given", () => {
    expect(languageName("fa", "en")).toBe("Persian")
    expect(languageName("fa", "de")).toBe("Persisch")
  })

  it("names the longer codes fastText uses where ISO 639-1 has none", () => {
    // ICU versions disagree on the wording ("Central Kurdish", "Kurdish,
    // Sorani"), so assert only that it is named.
    expect(languageName("ckb", "en")).toContain("Kurdish")
  })

  it("falls back to the value itself when it is not a language tag", () => {
    expect(languageName("not a tag", "en")).toBe("not a tag")
  })
})
