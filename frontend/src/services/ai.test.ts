import { afterEach, describe, expect, test } from "bun:test"

import { api } from "@/api"

import { AIServiceError, generateTagStream } from "./ai"

const original = api.tagStream
afterEach(() => {
  api.tagStream = original
})

const body = {
  channels: ["alpha", "beta"],
  channelsText: "",
  postsText: "",
  allTags: "news",
  tagMode: "add" as const,
  language: "English",
  model: "m",
}

describe("generateTagStream", () => {
  test("wraps each streamed string as a chunk and records the run's shape", async () => {
    const sent: unknown[] = []
    api.tagStream = async function* (b: Record<string, unknown>) {
      sent.push(b)
      yield "a"
      yield "b"
    } as typeof api.tagStream

    const result = await generateTagStream({ ...body, temperature: 0.2 })
    const chunks: { text: string }[] = []
    for await (const chunk of result.stream) chunks.push(chunk)

    expect(chunks).toEqual([{ text: "a" }, { text: "b" }])
    expect(result.prompt).toBe("tag_mode=add; channels=alpha,beta")
    expect(result.config).toEqual({ temperature: 0.2 })
    expect(sent).toEqual([{ ...body, temperature: 0.2 }])
  })

  test("defaults the temperature to 0.7", async () => {
    api.tagStream = async function* () {} as typeof api.tagStream
    expect((await generateTagStream(body)).config).toEqual({ temperature: 0.7 })
  })

  test("turns a failure to open the stream into an AIServiceError", async () => {
    api.tagStream = () => {
      throw new Error("no key")
    }
    const err = await generateTagStream(body).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AIServiceError)
    expect((err as Error).message).toBe("no key")

    api.tagStream = () => {
      throw "not an Error"
    }
    expect(
      ((await generateTagStream(body).catch((e: unknown) => e)) as Error)
        .message,
    ).toBe("Failed to generate tag stream")
  })
})
