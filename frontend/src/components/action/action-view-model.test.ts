import { describe, expect, test } from "bun:test"

import { discoverButton, startChatButton } from "./action-view-model"

describe("discoverButton", () => {
  const ready = { isGenerating: false, isOffline: false, channelCount: 3 }

  test("ready with channels, the server and nothing running", () => {
    expect(discoverButton(ready)).toEqual({
      disabled: false,
      label: "Generate report",
    })
  })

  test("each missing condition disables it, and running says so", () => {
    expect(discoverButton({ ...ready, isOffline: true }).disabled).toBe(true)
    expect(discoverButton({ ...ready, channelCount: 0 }).disabled).toBe(true)
    expect(discoverButton({ ...ready, isGenerating: true })).toEqual({
      disabled: true,
      label: "Generating…",
    })
  })
})

describe("startChatButton", () => {
  const ready = {
    draft: "what changed?",
    isChatting: false,
    isOffline: false,
    noKey: false,
  }

  test("ready with a question, the server and a Key", () => {
    expect(startChatButton(ready)).toEqual({
      disabled: false,
      title: undefined,
    })
  })

  test("a blank question, a running chat or no server disables it silently", () => {
    for (const blocked of [
      { draft: "   " },
      { isChatting: true },
      { isOffline: true },
    ]) {
      expect(startChatButton({ ...ready, ...blocked })).toEqual({
        disabled: true,
        title: undefined,
      })
    }
  })

  test("no Key disables it and says why", () => {
    expect(startChatButton({ ...ready, noKey: true })).toEqual({
      disabled: true,
      title: "Add an AI key above to run this.",
    })
  })
})
