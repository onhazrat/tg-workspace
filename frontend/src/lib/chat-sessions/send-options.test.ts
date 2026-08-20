import { describe, expect, it } from "bun:test"

import type { ChatMessage } from "@/types"

import { resolveSend } from "./send-options"

const live = {
  chatInput: "typed in the composer",
  chatMessages: [{ role: "user", text: "earlier turn" }] as ChatMessage[],
  sessionId: "existing-session",
}

describe("resolveSend", () => {
  it("falls back to the live composer state when nothing is overridden", () => {
    expect(resolveSend(undefined, live)).toEqual({
      message: "typed in the composer",
      history: live.chatMessages,
      sessionId: "existing-session",
    })
  })

  it("trims the message from either source", () => {
    expect(resolveSend({ message: "  hi  " }, live).message).toBe("hi")
    expect(
      resolveSend(undefined, { ...live, chatInput: "  hi  " }).message,
    ).toBe("hi")
  })

  /**
   * The whole reason this is a function.
   *
   * `??` reads an explicit `null` as "not supplied" and falls back to the live
   * id — so a chat started from the Action tab would keep the id of whatever
   * conversation was last open, and the payload write replaces `messages`
   * wholesale. The previous chat's transcript is gone. `null` has to mean
   * "mint a new one", and only a presence check can tell the two apart.
   */
  it("treats an explicit null session id as a new conversation", () => {
    expect(resolveSend({ sessionId: null }, live).sessionId).toBeNull()
  })

  it("treats a present-but-undefined session id as a new conversation", () => {
    expect(resolveSend({ sessionId: undefined }, live).sessionId).toBeNull()
  })

  it("keeps the live id when the caller says nothing about it", () => {
    expect(resolveSend({ message: "hi" }, live).sessionId).toBe(
      "existing-session",
    )
  })

  /**
   * Same hazard, different field: a fresh chat must not inherit the turns of
   * the one on screen, and `setChatMessages([])` in the caller cannot help —
   * the send reads its history from a closure captured before that render.
   */
  it("treats an explicit empty history as a new conversation", () => {
    expect(resolveSend({ history: [] }, live).history).toEqual([])
  })
})
