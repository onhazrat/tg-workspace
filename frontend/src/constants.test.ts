import { describe, expect, test } from "bun:test"

import { needsTranslation } from "@/constants"

describe("needsTranslation", () => {
  test("a Post with no words needs none", () => {
    expect(needsTranslation("zxx", "English")).toBe(false)
  })

  test("a Post already in the Translation language needs none", () => {
    expect(needsTranslation("en", "English")).toBe(false)
    expect(needsTranslation("fa", "Persian")).toBe(false)
  })

  test("a Post in another Language needs one", () => {
    expect(needsTranslation("fa", "English")).toBe(true)
  })

  test("an undetermined Post keeps the button", () => {
    expect(needsTranslation("und", "English")).toBe(true)
  })

  test("an unread Post keeps the button", () => {
    expect(needsTranslation(null, "English")).toBe(true)
    expect(needsTranslation(undefined, "English")).toBe(true)
    expect(needsTranslation(undefined, "Klingon")).toBe(true)
  })

  test("an unmapped Translation language hides nothing but no words", () => {
    expect(needsTranslation("en", "Klingon")).toBe(true)
    expect(needsTranslation("zxx", "Klingon")).toBe(false)
  })
})
