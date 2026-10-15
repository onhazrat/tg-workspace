import { describe, expect, it, mock } from "bun:test"
import { ApiError } from "@/api/base"
import type { PostScopeQuery } from "@/api/data"
import { PASTED_SUMMARY_MODEL } from "@/constants"
import type { Post, Summary } from "@/types"
import {
  attemptOutcome,
  checkPastedSummary,
  countRegeneratedPosts,
  failureReport,
  followAttempt,
  pastedSummaryRecord,
  regeneratedRange,
  resolveCitedPosts,
} from "./summary-run"

/**
 * The rules `AIContext`'s Summary actions used to hold inline, where no test
 * could reach them.
 */

const pending: Summary = {
  id: "s1",
  text: "",
  language: "English",
  model: "gemini-x",
  postCount: 3,
  timestamp: 0,
  status: "pending",
}

const post = { channelName: "chan", id: 1 } as Post

describe("resolveCitedPosts", () => {
  it("cites from the posts the run held, without a lookup", async () => {
    const cited = await resolveCitedPosts("see [chan #1]", [post], async () => {
      throw new Error("a held pool must not be looked up")
    })
    expect(cited).toEqual({ "chan-1": post })
  })

  it("looks up only the cited posts when the run held none", async () => {
    const asked: unknown[] = []
    const cited = await resolveCitedPosts(
      "see [chan #1] and [gone #9]",
      undefined,
      async (refs) => {
        asked.push(...refs)
        return [post]
      },
    )
    expect(asked).toEqual([
      { channelName: "chan", postId: 1 },
      { channelName: "gone", postId: 9 },
    ])
    expect(cited).toEqual({ "chan-1": post })
  })
})

describe("attemptOutcome", () => {
  async function* frames(...items: unknown[]) {
    for (const item of items) {
      if (item instanceof Error) throw item
      yield item as { text: string }
    }
  }

  it("is how the watched Attempt ended", async () => {
    const outcome = await attemptOutcome(
      frames({ text: "a" }, { outcome: "failed", error: "busy" }),
    )
    expect(outcome).toBe("failed")
  })

  it("is null when the watch broke before the end", async () => {
    const outcome = await attemptOutcome(
      frames({ text: "a" }, new Error("network gone")),
    )
    expect(outcome).toBeNull()
  })
})

describe("followAttempt", () => {
  async function* frames(...items: unknown[]) {
    for (const item of items) {
      if (item instanceof Error) throw item
      yield item as { text: string }
    }
  }

  it("hands over each piece of text and ignores the end frame", async () => {
    const seen: string[] = []
    const ended = await followAttempt(
      frames(
        { text: "a" },
        { text: "b" },
        { outcome: "succeeded", error: null },
      ),
      (t) => seen.push(t),
      new AbortController().signal,
    )
    expect(seen).toEqual(["a", "b"])
    expect(ended).toBe(true)
  })

  it("a dropped connection still ends the watch", async () => {
    const quiet = mock()
    const original = console.error
    console.error = quiet
    const ended = await followAttempt(
      frames({ text: "a" }, new Error("network")),
      () => {},
      new AbortController().signal,
    )
    console.error = original
    expect(ended).toBe(true)
    expect(quiet).toHaveBeenCalled()
  })

  it("a page that stopped watching does not read the Summary again", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(
      await followAttempt(frames({ text: "a" }), () => {}, controller.signal),
    ).toBe(false)
  })
})

describe("failureReport", () => {
  it("carries the status an API refusal answered with", () => {
    expect(
      failureReport(new ApiError(413, "Too many tokens"), "gemini-x"),
    ).toEqual({ error: "Too many tokens", status: 413, model: "gemini-x" })
  })

  it("has no status when nothing answered", () => {
    expect(failureReport(new TypeError("Failed to fetch"), "m")).toEqual({
      error: "Failed to fetch",
      status: null,
      model: "m",
    })
    expect(failureReport("odd", "m").error).toBe("The summary failed.")
  })
})

describe("checkPastedSummary", () => {
  it("refuses a row that is not awaiting a response", () => {
    const error = "This history item is not awaiting an external AI response."
    expect(checkPastedSummary(undefined, "x")).toEqual({ ok: false, error })
    expect(checkPastedSummary({ ...pending, status: undefined }, "x")).toEqual({
      ok: false,
      error,
    })
  })

  it("takes a paste on a Failed Summary as on a Pending one", () => {
    const failed = { ...pending, status: "failed" as const }
    expect(checkPastedSummary(failed, " body ")).toEqual({
      ok: true,
      pending: failed,
      text: "body",
    })
  })

  it("refuses a blank paste and trims a real one", () => {
    expect(checkPastedSummary(pending, "  \n")).toEqual({
      ok: false,
      error: "Summary text cannot be empty.",
    })
    expect(checkPastedSummary(pending, "  body \n")).toEqual({
      ok: true,
      pending,
      text: "body",
    })
  })
})

describe("pastedSummaryRecord", () => {
  it("completes the row as pasted and clears pending", () => {
    const record = pastedSummaryRecord(pending, "body", undefined, {
      "chan-1": post,
    })
    expect(record).toMatchObject({
      id: "s1",
      text: "body",
      model: "gemini-x",
      source: "pasted",
      citedPosts: { "chan-1": post },
    })
    expect(record.status).toBeNull()
  })

  it("prefers a typed model, then the row's, then the pasted label", () => {
    expect(pastedSummaryRecord(pending, "b", " gpt ", {}).model).toBe("gpt")
    expect(pastedSummaryRecord(pending, "b", "  ", {}).model).toBe("gemini-x")
    expect(
      pastedSummaryRecord({ ...pending, model: "" }, "b", undefined, {}).model,
    ).toBe(PASTED_SUMMARY_MODEL)
  })
})

describe("regeneratedRange", () => {
  it("reads the frozen window", () => {
    expect(
      regeneratedRange({ ...pending, scope: { start: 1, end: 2 } }),
    ).toEqual({ start: 1, end: 2 })
  })

  it("refuses a successor that came back with no scope", () => {
    expect(() => regeneratedRange(pending)).toThrow(
      "The regenerated summary came back with no scope.",
    )
  })
})

describe("countRegeneratedPosts", () => {
  const minute = 60_000
  const range = { start: 10 * minute + 5, end: 20 * minute }

  it("answers zero without asking when no minute has passed", async () => {
    const count = await countRegeneratedPosts(
      ["a"],
      range,
      10 * minute,
      async () => {
        throw new Error("the server refuses start === end")
      },
    )
    expect(count).toBe(0)
  })

  it("sums the server's counts over the window otherwise", async () => {
    const asked: PostScopeQuery[] = []
    const count = await countRegeneratedPosts(
      ["a", "b"],
      range,
      11 * minute,
      async (q) => {
        asked.push(q)
        return { a: 2, b: 5 }
      },
    )
    expect(count).toBe(7)
    expect(asked).toEqual([
      { channelNames: ["a", "b"], startDate: range.start, endDate: range.end },
    ])
  })
})
