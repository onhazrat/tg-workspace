/**
 * When a translation batch is sent, and how its response settles each card.
 *
 * Both failure modes here are silent in the UI: a batch that never sends, or a
 * request the response forgot, leaves a card spinning with no error. So each
 * test asserts that every request ends up settled one way or the other.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import {
  BATCH_FAILED_MESSAGE,
  createTranslationQueue,
  QUOTA_EXCEEDED_MESSAGE,
  type SendTranslationBatchIO,
  sendTranslationBatch,
  type TranslationRequest,
} from "./translation-batch"

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** A request that records how it was settled. */
function request(id: string, text = id) {
  const outcome: { value?: string; error?: string } = {}
  const req: TranslationRequest = {
    id,
    text,
    resolve: (value) => {
      outcome.value = value
    },
    reject: (error) => {
      outcome.error = error.message
    },
  }
  return { req, outcome }
}

describe("createTranslationQueue", () => {
  const limits = { maxChars: 10, debounceMs: 15 }

  test("sends one batch after a quiet spell, holding every request queued before it", async () => {
    const sent: string[][] = []
    const queue = createTranslationQueue(
      (batch) => sent.push(batch.map((r) => r.id)),
      limits,
    )
    queue.push(request("a").req)
    await settle(5)
    queue.push(request("b").req)
    await settle(5)
    // The second request restarted the wait, so nothing has gone yet.
    expect(sent).toEqual([])
    await settle(30)
    expect(sent).toEqual([["a", "b"]])
  })

  test("sends at once when the queued text reaches the cap, and not again later", async () => {
    const sent: string[][] = []
    const queue = createTranslationQueue(
      (batch) => sent.push(batch.map((r) => r.id)),
      limits,
    )
    queue.push(request("a", "12345").req)
    queue.push(request("b", "67890").req)
    expect(sent).toEqual([["a", "b"]])
    await settle(30)
    expect(sent).toEqual([["a", "b"]])
  })

  test("cancel drops the pending send", async () => {
    const sent: string[][] = []
    const queue = createTranslationQueue(
      (batch) => sent.push(batch.map((r) => r.id)),
      limits,
    )
    queue.push(request("a").req)
    queue.cancel()
    await settle(30)
    expect(sent).toEqual([])
  })
})

describe("sendTranslationBatch", () => {
  let errors: ReturnType<typeof spyOn>
  beforeEach(() => {
    errors = spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => errors.mockRestore())

  function io(overrides: Partial<SendTranslationBatchIO> = {}) {
    const calls = { translated: 0, quota: 0, notified: [] as string[] }
    const value: SendTranslationBatchIO = {
      enabled: true,
      translate: async (posts) => {
        calls.translated++
        return posts.map((p) => ({ id: p.id, translation: `T(${p.text})` }))
      },
      onQuotaExceeded: () => {
        calls.quota++
      },
      notifyError: (message) => calls.notified.push(message),
      ...overrides,
    }
    return { value, calls }
  }

  test("with translation off, each request gets its own text and nothing is sent", async () => {
    const a = request("a", "hello")
    const { value, calls } = io({ enabled: false })
    await sendTranslationBatch([a.req], value)
    expect(a.outcome).toEqual({ value: "hello" })
    expect(calls.translated).toBe(0)
  })

  test("each request gets its own translation, and one the response left out is rejected", async () => {
    const a = request("a")
    const b = request("b")
    const c = request("c")
    const { value } = io({
      translate: async () => [
        { id: "b", translation: "B" },
        { id: "a", translation: "A" },
        { id: "c", translation: "" },
      ],
    })
    const d = request("d")
    await sendTranslationBatch([a.req, b.req, c.req, d.req], value)
    expect(a.outcome).toEqual({ value: "A" })
    expect(b.outcome).toEqual({ value: "B" })
    expect(c.outcome.error).toBe("Translation missing from batch response")
    expect(d.outcome.error).toBe("Translation missing from batch response")
  })

  test("a quota refusal turns auto-translate off and rejects the whole batch", async () => {
    const a = request("a")
    const b = request("b")
    const { value, calls } = io({
      translate: async () => {
        throw new Error("429 quota exceeded")
      },
    })
    await sendTranslationBatch([a.req, b.req], value)
    expect(calls.quota).toBe(1)
    expect(calls.notified).toEqual([QUOTA_EXCEEDED_MESSAGE])
    expect(a.outcome.error).toBe("429 quota exceeded")
    expect(b.outcome.error).toBe("429 quota exceeded")
  })

  test("any other failure says so, leaves auto-translate on, and rejects with an Error", async () => {
    const a = request("a")
    const { value, calls } = io({
      translate: () => Promise.reject("socket closed"),
    })
    await sendTranslationBatch([a.req], value)
    expect(calls.quota).toBe(0)
    expect(calls.notified).toEqual([BATCH_FAILED_MESSAGE])
    expect(a.outcome.error).toBe("socket closed")
  })
})
