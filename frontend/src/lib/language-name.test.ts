import { describe, expect, it } from "bun:test"

import {
  languageLabel,
  languageName,
  languageValue,
  NOT_READ,
  sortLanguages,
} from "@/lib/language-name"

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

describe("languageLabel", () => {
  it("names the three values that are not Languages, and codes by name", () => {
    expect(languageLabel("zxx")).toBe("No words")
    expect(languageLabel("und")).toBe("Undetermined")
    expect(languageLabel(NOT_READ)).toBe("Not read yet")
    expect(languageLabel("fa", "en")).toBe("Persian")
  })
})

describe("languageValue", () => {
  it("is the stored code, or `null` for a row not read yet", () => {
    expect(languageValue("fa")).toBe("fa")
    expect(languageValue(null)).toBe("null")
  })
})

describe("sortLanguages", () => {
  it("orders Languages by count, then the three non-Languages last, fixed", () => {
    expect(
      sortLanguages(
        [
          { value: "null", count: 50 },
          { value: "en", count: 2 },
          { value: "zxx", count: 40 },
          { value: "fa", count: 9 },
          { value: "und", count: 1 },
          { value: "de", count: 2 },
        ],
        "en",
      ).map((option) => option.value),
    ).toEqual(["fa", "en", "de", "und", "zxx", "null"])
  })

  it("orders uncounted Languages by name", () => {
    expect(
      sortLanguages(
        [{ value: "ru" }, { value: "zxx" }, { value: "fa" }, { value: "en" }],
        "en",
      ).map((option) => option.value),
    ).toEqual(["en", "fa", "ru", "zxx"])
  })
})
