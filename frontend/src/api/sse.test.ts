import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { ApiError, sseDataPayloads, sseJsonStream, sseTextStream } from "./base"

/**
 * The SSE readers behind sync progress, bulk-follow progress, and every AI
 * stream (summary, tag, chat).
 *
 * A network delivers bytes, not events, so the cases that matter are the ones a
 * localhost dev server never produces: an event split across two reads, a
 * multi-byte character split across two reads, a connection dropping halfway.
 *
 * The `fetch` stub answers only `http://sse.test/`, so a request another test
 * file left in flight still reaches the real `fetch` while this one is swapped.
 */

const encoder = new TextEncoder()

/** A body that hands each chunk to a separate `read()`. */
function streamOf(...chunks: (string | Uint8Array)[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        )
      controller.close()
    },
  })
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of gen) out.push(item)
  return out
}

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let respond: (init: RequestInit) => Response
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.startsWith("http://sse.test/")) return realFetch(input, init)
    calls.push({ url, init: init ?? {} })
    return respond(init ?? {})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("sseDataPayloads", () => {
  it("reassembles an event split across reads", async () => {
    const body = streamOf('data: {"a"', ':1}\ndata: {"a":2}\n')
    expect(await collect(sseDataPayloads(body))).toEqual(['{"a":1}', '{"a":2}'])
  })

  it("reassembles a multi-byte character split across reads", async () => {
    const bytes = encoder.encode('data: {"text":"سلام"}\n')
    // Byte 16 falls inside the first two-byte Arabic letter.
    const body = streamOf(bytes.slice(0, 16), bytes.slice(16))
    expect(await collect(sseDataPayloads(body))).toEqual(['{"text":"سلام"}'])
  })

  it("treats each data line as its own payload", async () => {
    const body = streamOf("data: first\ndata: second\n\n")
    expect(await collect(sseDataPayloads(body))).toEqual(["first", "second"])
  })

  it("skips lines that are not data lines", async () => {
    const body = streamOf(
      ": keep-alive\nevent: progress\nid: 7\ndata:nospace\ndata: kept\n",
    )
    expect(await collect(sseDataPayloads(body))).toEqual(["kept"])
  })

  it("stops at [DONE] and reads nothing after it", async () => {
    const body = streamOf("data: one\ndata: [DONE]\ndata: two\n")
    expect(await collect(sseDataPayloads(body))).toEqual(["one"])
  })

  it("drops an unterminated last line when the body closes", async () => {
    const body = streamOf("data: one\ndata: half")
    expect(await collect(sseDataPayloads(body))).toEqual(["one"])
  })

  it("yields nothing for a missing body", async () => {
    expect(await collect(sseDataPayloads(null))).toEqual([])
  })

  it("surfaces a connection dropped mid-stream after what arrived", async () => {
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(new Error("connection reset"))
        else controller.enqueue(encoder.encode("data: one\n"))
        sent = true
      },
    })
    const seen: string[] = []
    const run = (async () => {
      for await (const p of sseDataPayloads(body)) seen.push(p)
    })()
    await expect(run).rejects.toThrow("connection reset")
    expect(seen).toEqual(["one"])
  })
})

describe("sseJsonStream", () => {
  it("yields each JSON payload and skips malformed ones", async () => {
    respond = () =>
      new Response(streamOf('data: {"n":1}\ndata: {oops\n', 'data: {"n":2}\n'))
    const got = await collect(
      sseJsonStream<{ n: number }>("http://sse.test/events"),
    )
    expect(got).toEqual([{ n: 1 }, { n: 2 }])
  })

  it("sends a GET without a JSON content type, merging caller headers", async () => {
    respond = () => new Response(streamOf())
    const controller = new AbortController()
    await collect(
      sseJsonStream("http://sse.test/events", {
        signal: controller.signal,
        headers: { "X-Trace": "t1" },
      }),
    )
    const { init } = calls[0]
    expect(init.method).toBeUndefined()
    expect(init.signal).toBe(controller.signal)
    const sent = init.headers as Record<string, string>
    expect(sent["X-Trace"]).toBe("t1")
    expect(sent["Content-Type"]).toBeUndefined()
  })

  it("throws the server's detail as an ApiError before yielding", async () => {
    respond = () =>
      new Response(JSON.stringify({ detail: "Sync job not found" }), {
        status: 404,
      })
    const run = collect(sseJsonStream("http://sse.test/events"))
    await expect(run).rejects.toBeInstanceOf(ApiError)
    await expect(run).rejects.toMatchObject({
      status: 404,
      message: "Sync job not found",
    })
  })

  it("ends with a rejection when the caller aborts mid-stream", async () => {
    const controller = new AbortController()
    respond = (init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode('data: {"n":1}\n'))
            init.signal?.addEventListener("abort", () =>
              c.error(init.signal?.reason),
            )
          },
        }),
      )
    const gen = sseJsonStream<{ n: number }>("http://sse.test/events", {
      signal: controller.signal,
    })
    expect((await gen.next()).value).toEqual({ n: 1 })
    const next = gen.next()
    controller.abort()
    await expect(next).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("sseTextStream", () => {
  it("yields the named field and skips payloads without it", async () => {
    respond = () =>
      new Response(
        streamOf(
          'data: {"text":"Good "}\n',
          'data: {"other":1}\ndata: null\ndata: {"text":""}\n',
          'data: nope\ndata: {"text":"news"}\ndata: [DONE]\n',
        ),
      )
    const got = await collect(
      sseTextStream("http://sse.test/ai", { q: 1 }, "text"),
    )
    expect(got).toEqual(["Good ", "news"])
  })

  it("POSTs the body as JSON", async () => {
    respond = () => new Response(streamOf())
    await collect(sseTextStream("http://sse.test/ai", { q: 1 }, "text"))
    const { init } = calls[0]
    expect(init.method).toBe("POST")
    expect(init.body).toBe('{"q":1}')
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    )
  })

  it("throws the server's detail as an ApiError", async () => {
    respond = () =>
      new Response(JSON.stringify({ detail: "No AI key" }), { status: 400 })
    await expect(
      collect(sseTextStream("http://sse.test/ai", {}, "text")),
    ).rejects.toMatchObject({ status: 400, message: "No AI key" })
  })
})
