import { describe, expect, test } from "bun:test"

import {
  isUnavailableWebViewMessage,
  parseApiError,
  unavailableChannelToastMessage,
} from "@/lib/api-errors"

describe("parseApiError", () => {
  test("parses structured unavailable detail", () => {
    const parsed = parseApiError(
      new Error(
        JSON.stringify({
          error: "Channel is not available on the web view.",
          isUnavailableOnWebView: true,
        }),
      ),
    )
    expect(parsed.isUnavailableOnWebView).toBe(true)
    expect(parsed.message).toContain("not available on the web view")
  })

  test("detects unavailable from plain error text", () => {
    const parsed = parseApiError(
      new Error("Channel is not available on the web view."),
    )
    expect(parsed.isUnavailableOnWebView).toBe(true)
  })
})

describe("unavailable helpers", () => {
  test("isUnavailableWebViewMessage matches known phrases", () => {
    expect(
      isUnavailableWebViewMessage("Channel is not available on the web view."),
    ).toBe(true)
    expect(isUnavailableWebViewMessage("network timeout")).toBe(false)
  })

  test("unavailableChannelToastMessage includes handle", () => {
    expect(unavailableChannelToastMessage("AiSegaro")).toContain("@AiSegaro")
    expect(unavailableChannelToastMessage("AiSegaro")).toContain("Unavailable")
  })
})
