import { describe, expect, test } from "bun:test"

import {
  telegramWebBaseUrl,
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "./telegram-web"

describe("telegram-web", () => {
  test("builds channel and post URLs with configured domain", () => {
    expect(telegramWebBaseUrl()).toBe("https://telegram.me")
    expect(telegramWebViewChannelUrl("durov")).toBe(
      "https://telegram.me/s/durov",
    )
    expect(telegramWebViewPostUrl("durov", 123)).toBe(
      "https://telegram.me/s/durov/123",
    )
  })
})
