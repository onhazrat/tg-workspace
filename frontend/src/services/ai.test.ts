import { afterEach, describe, expect, test } from "bun:test"

import { api } from "@/api"

import {
  AIServiceError,
  chatWithHistoryStream,
  generateChatStream,
  generateTagStream,
  getSummaryPrompt,
  getTagPrompt,
} from "./ai"

const original = {
  summaryPrompt: api.summaryPrompt,
  tagStream: api.tagStream,
  tagPrompt: api.tagPrompt,
  chatStream: api.chatStream,
}
afterEach(() => {
  Object.assign(api, original)
})

const tagBody = {
  tagRunId: "run-1",
  allTags: "news",
  tagMode: "add" as const,
  model: "m",
}

/**
 * A stream that announces `missing` Missing Posts before its text, as the
 * server does (ADR-038), and records the body it was sent.
 */
const streamSending = (sent: unknown[], missing: number, chunks: string[]) =>
  async function* (
    b: Record<string, unknown>,
    onFrame?: (frame: Record<string, unknown>) => void,
  ) {
    sent.push(b)
    onFrame?.({ missingPosts: missing })
    for (const chunk of chunks) yield chunk
  }

const drain = async (stream: AsyncIterable<{ text: string }>) => {
  const chunks: { text: string }[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe("the prompt routes are sent the Artifact's id, never a Scope", () => {
  test("a Tag prompt names its run and answers the Missing Post count", async () => {
    const sent: unknown[] = []
    api.tagPrompt = async (b) => {
      sent.push(b)
      return { prompt: "p", missingPosts: 4 }
    }

    expect(await getTagPrompt(tagBody)).toEqual({
      prompt: "p",
      missingPosts: 4,
    })
    expect(sent).toEqual([tagBody])
  })

  test("a Summary prompt names its Summary and nothing else", async () => {
    const sent: unknown[] = []
    api.summaryPrompt = async (b) => {
      sent.push(b)
      return { prompt: "p", missingPosts: 0 }
    }

    await getSummaryPrompt("sum-1")

    // The server describes the Channels from the Account's setting (AC-03).
    expect(sent).toEqual([{ summaryId: "sum-1" }])
  })

  test("a Chat turn names its Chat, with no Posts, Scope or Channels", async () => {
    const sent: unknown[] = []
    api.chatStream = streamSending(sent, 2, ["a"]) as typeof api.chatStream

    const result = await generateChatStream(
      "chat-1",
      "English",
      "m",
      [{ role: "user", text: "earlier" }],
      "why?",
      0.3,
    )

    expect(await drain(result.stream)).toEqual([{ text: "a" }])
    expect(result.missingPosts()).toBe(2)
    expect(sent).toEqual([
      {
        chatId: "chat-1",
        language: "English",
        model: "m",
        history: [{ role: "user", text: "earlier" }],
        message: "why?",
        temperature: 0.3,
        ragMode: false,
      },
    ])
  })

  test("a semantic Chat turn names its Chat beside the ranked Posts", async () => {
    const sent: Record<string, unknown>[] = []
    api.chatStream = streamSending(sent, 0, []) as typeof api.chatStream

    const result = await chatWithHistoryStream(
      "chat-2",
      [{ text: "t", channelName: "news", date: "2026-01-01", id: 7 }],
      "English",
      "m",
      [],
      "q",
    )
    await drain(result.stream)

    expect(sent[0]).toMatchObject({ chatId: "chat-2", ragMode: true })
    expect(sent[0]?.postsText).toContain("[news] ID: 7")
    expect(sent[0]).not.toHaveProperty("scope")
    expect(sent[0]).not.toHaveProperty("channels")
  })
})

describe("generateTagStream", () => {
  test("wraps each streamed string as a chunk and records the run's shape", async () => {
    const sent: unknown[] = []
    api.tagStream = streamSending(sent, 3, ["a", "b"]) as typeof api.tagStream

    const result = await generateTagStream({ ...tagBody, temperature: 0.2 })

    expect(await drain(result.stream)).toEqual([{ text: "a" }, { text: "b" }])
    expect(result.missingPosts()).toBe(3)
    expect(result.prompt).toBe("tag_mode=add; tagRun=run-1")
    expect(result.config).toEqual({ temperature: 0.2 })
    expect(sent).toEqual([{ ...tagBody, temperature: 0.2 }])
  })

  test("defaults the temperature to 0.7 and the count to zero", async () => {
    api.tagStream = async function* () {} as typeof api.tagStream
    const result = await generateTagStream(tagBody)
    expect(result.config).toEqual({ temperature: 0.7 })
    expect(result.missingPosts()).toBe(0)
  })

  test("turns a failure to open the stream into an AIServiceError", async () => {
    api.tagStream = () => {
      throw new Error("no key")
    }
    const err = await generateTagStream(tagBody).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AIServiceError)
    expect((err as Error).message).toBe("no key")

    api.tagStream = () => {
      throw "not an Error"
    }
    expect(
      ((await generateTagStream(tagBody).catch((e: unknown) => e)) as Error)
        .message,
    ).toBe("Failed to generate tag stream")
  })
})
