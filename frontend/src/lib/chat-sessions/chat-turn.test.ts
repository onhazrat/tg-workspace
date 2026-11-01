import { describe, expect, it } from "bun:test"
import { AIServiceError } from "@/services/ai"
import type { ChatMessage, Post } from "@/types"
import {
  chatErrorText,
  chatLLMLog,
  chatSessionRecord,
  replaceLastTurn,
  type TurnResult,
  transcriptLoad,
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

  it("keeps the answer's Missing Post count on the answer, and the Chat's count", () => {
    const record = chatSessionRecord(
      "s1",
      [],
      "q",
      { ...turn, postCount: undefined, missingPosts: 2 },
      100,
    )
    expect(record.messages?.at(-1)).toEqual({
      role: "model",
      text: "answer",
      missingPosts: 2,
    })
    // A turn over the Covered Posts leaves the Chat's recorded count alone.
    expect(record).not.toHaveProperty("postCount")
    expect(
      chatSessionRecord("s1", [], "q", { ...turn, missingPosts: 0 }, 1)
        .messages?.[1],
    ).toEqual({ role: "model", text: "answer" })
  })
})

describe("transcriptLoad", () => {
  const turns: ChatMessage[] = [{ role: "user", text: "hi" }]

  it("clears the transcript for an empty Chat tab after a filled one", () => {
    expect(transcriptLoad(null, "c1", { messages: turns })).toEqual({
      loadedId: null,
      messages: [],
    })
  })

  it("keeps a first turn's buffer in the empty tab it streams into", () => {
    expect(transcriptLoad(null, null, undefined)).toEqual({ loadedId: null })
  })

  it("does nothing while the opened transcript is still loading", () => {
    expect(transcriptLoad("c1", null, undefined)).toBeNull()
  })

  it("does nothing once that session is already loaded", () => {
    expect(transcriptLoad("c1", "c1", { messages: [] })).toBeNull()
  })

  it("loads the opened session's transcript once it arrives", () => {
    expect(transcriptLoad("c2", "c1", { messages: turns })).toEqual({
      loadedId: "c2",
      messages: turns,
    })
  })

  it("loads an empty transcript for a session stored without one", () => {
    expect(transcriptLoad("c2", null, { messages: null })).toEqual({
      loadedId: "c2",
      messages: [],
    })
  })
})
