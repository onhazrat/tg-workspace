import { describe, expect, it } from "bun:test"
import { AIServiceError } from "@/services/ai"
import type { Channel, ChatMessage, Post } from "@/types"
import {
  chatErrorText,
  chatLLMLog,
  chatSessionRecord,
  replaceLastTurn,
  staleSelectedChannels,
  type TurnResult,
} from "./chat-turn"

/**
 * The rules `handleSendMessage` used to hold inline. The one with history is
 * `replaceLastTurn`: a failed submission reports its error before any turn is
 * on screen, and writing index `length - 1` of an empty list set a property
 * instead of an element, so the error was invisible.
 */

const user: ChatMessage = { role: "user", text: "q" }
const pending: ChatMessage = { role: "model", text: "" }

describe("replaceLastTurn", () => {
  it("replaces the placeholder without touching earlier turns", () => {
    const before = [user, pending]
    const after = replaceLastTurn(before, { role: "model", text: "answer" })
    expect(after).toEqual([user, { role: "model", text: "answer" }])
    expect(before).toEqual([user, pending])
  })

  it("starts the transcript when nothing is on screen yet", () => {
    const failure: ChatMessage = { role: "model", text: "Error: offline" }
    expect(replaceLastTurn([], failure)).toEqual([failure])
  })
})

describe("staleSelectedChannels", () => {
  const minute = 60_000
  const channels = [
    { name: "stale", lastUpdated: 1_000_000 - minute - 1 },
    { name: "edge", lastUpdated: 1_000_000 - minute },
    { name: "fresh", lastUpdated: 1_000_000 },
    { name: "never" },
    { name: "unselected", lastUpdated: 0 },
  ] as Channel[]
  const selected = new Set(["stale", "edge", "fresh", "never"])

  it("syncs selected channels older than a minute before the window's end", () => {
    expect(
      staleSelectedChannels(channels, selected, 1_000_000, 5_000_000).map(
        (c) => c.name,
      ),
    ).toEqual(["stale", "never"])
  })

  it("measures from now when the window ends in the future", () => {
    expect(
      staleSelectedChannels(channels, selected, 9_000_000, 1_000_000).map(
        (c) => c.name,
      ),
    ).toEqual(["stale", "never"])
  })
})

describe("chatErrorText", () => {
  it("shows the service's own message, and a fallback for a non-Error", () => {
    expect(chatErrorText(new AIServiceError("Key rejected"))).toBe(
      "Error: Key rejected",
    )
    expect(chatErrorText(new Error("offline"))).toBe("Error: offline")
    expect(chatErrorText("boom")).toBe("Error: Failed to generate response")
  })
})

const turn: TurnResult = {
  text: "answer",
  lastChunk: { text: "r", usageMetadata: { totalTokenCount: 42 } },
  prompt: "p",
  config: { temperature: 0.2 },
  systemInstruction: "sys",
  postCount: 7,
}
const ctx = {
  id: "log1",
  model: "m",
  mode: "full_scope" as const,
  message: "q",
  history: [],
  now: 100,
  durationMs: 5,
}

describe("chatLLMLog", () => {
  it("records the turn with its tokens and mode", () => {
    expect(chatLLMLog(turn, ctx)).toMatchObject({
      prompt: "q",
      response: "answer",
      tokens: 42,
      status: "success",
      type: "chat_full_scope",
      duration: 5,
    })
    expect(chatLLMLog(turn, { ...ctx, mode: "semantic" })?.type).toBe(
      "chat_semantic",
    )
  })

  it("an empty answer is a failure, and a model never asked writes no log", () => {
    expect(chatLLMLog({ ...turn, text: "" }, ctx)?.status).toBe("failed")
    expect(chatLLMLog({ ...turn, prompt: "" }, ctx)).toBeNull()
    expect(
      chatLLMLog({ ...turn, lastChunk: null }, ctx)?.tokens,
    ).toBeUndefined()
  })
})

describe("chatSessionRecord", () => {
  it("appends the question and the answer, with its sources, after the history", () => {
    const sources = [{ id: 1 } as Post]
    const history: ChatMessage[] = [
      { role: "user", text: "earlier" },
      { role: "model", text: "reply" },
    ]
    expect(
      chatSessionRecord("s1", history, "q", { ...turn, sources }, 100),
    ).toEqual({
      id: "s1",
      postCount: 7,
      timestamp: 100,
      messages: [
        ...history,
        { role: "user", text: "q" },
        { role: "model", text: "answer", sources },
      ],
    })
  })
})
