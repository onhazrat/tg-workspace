import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { LogType } from "@/api/data"
import { queryKeys, SUMMARIZER_STALE_TIME } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import { scopedStorage } from "@/lib/storage/scoped"
import type { NetworkLog } from "@/types"
import {
  type LogPoster,
  saveEmbeddingLog,
  saveLLMLog,
  saveNetworkLog,
  savePublishLog,
  saveSyncLog,
} from "./write"

/**
 * The two behaviours A3 changed about writing a log.
 *
 * 1. **Freshness is now explicit.** `repository.apiWrite` bumped a sync-meta
 *    etag and the next read compared etags and refetched. With that layer gone,
 *    nothing marks the cached list stale unless the write does it — and
 *    `staleTime` does not help, because it decides when a refetch is *allowed*,
 *    not when one is *needed*. Drop the invalidation and a written entry stays
 *    invisible for `SUMMARIZER_STALE_TIME`.
 *
 * 2. **A failed write no longer throws.** Deliberate: with the IndexedDB
 *    fallback gone there is nothing to recover to, and rethrowing would let a
 *    failed *log* break the operation it was recording. Several callers never
 *    awaited these in the first place.
 *
 * The writer is injected rather than spied on — see `LogPoster` in `write.ts`
 * for why a spy on `api` cannot work here.
 */

const log = (id: string): NetworkLog =>
  ({
    id,
    timestamp: 1,
    status: "success",
    url: "https://t.me/s/x",
  }) as NetworkLog

let calls: Array<[LogType, unknown[]]> = []

const ok: LogPoster = async (type, logs) => {
  calls.push([type, logs])
}

const fails: LogPoster = async (type, logs) => {
  calls.push([type, logs])
  throw new Error("500 from the server")
}

/** Seed the cache as a *fresh* entry, the way a completed query leaves it. */
function seedFresh(key: readonly unknown[]) {
  queryClient.setQueryData(key, [])
}

function isStale(key: readonly unknown[]): boolean {
  return queryClient.getQueryCache().find({ queryKey: key })?.isStale() ?? true
}

beforeEach(() => {
  calls = []
  queryClient.clear()
})

afterEach(() => {
  queryClient.clear()
})

describe("saveNetworkLog", () => {
  it("posts the entry as a single-element batch", async () => {
    await saveNetworkLog(log("n1"), ok)

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe("network")
    expect(calls[0][1]).toEqual([log("n1")])
  })

  it("marks the matching list stale, so the next read refetches", async () => {
    seedFresh(queryKeys.logs.network)
    expect(isStale(queryKeys.logs.network)).toBe(false)

    await saveNetworkLog(log("n1"), ok)

    expect(isStale(queryKeys.logs.network)).toBe(true)
  })

  it("does not disturb the other four panels", async () => {
    seedFresh(queryKeys.logs.network)
    seedFresh(queryKeys.logs.publish)

    await saveNetworkLog(log("n1"), ok)

    expect(isStale(queryKeys.logs.publish)).toBe(false)
  })

  it("swallows a failed write instead of breaking the caller", async () => {
    // No `.rejects` — the point is that this resolves.
    await saveNetworkLog(log("n1"), fails)

    expect(calls).toHaveLength(1)
  })

  it("leaves the cache alone when the write failed", async () => {
    seedFresh(queryKeys.logs.network)

    await saveNetworkLog(log("n1"), fails)

    expect(isStale(queryKeys.logs.network)).toBe(false)
  })
})

describe("each kind routes to its own key", () => {
  const cases: Array<
    [string, (l: never, p: LogPoster) => Promise<void>, LogType]
  > = [
    ["savePublishLog", savePublishLog as never, "publish"],
    ["saveSyncLog", saveSyncLog as never, "sync"],
    ["saveLLMLog", saveLLMLog as never, "llm"],
    ["saveEmbeddingLog", saveEmbeddingLog as never, "embedding"],
    ["saveNetworkLog", saveNetworkLog as never, "network"],
  ]

  for (const [name, save, type] of cases) {
    it(`${name} posts as "${type}" and invalidates only that panel`, async () => {
      for (const key of Object.values(queryKeys.logs)) seedFresh(key)

      await save({ id: "x", timestamp: 1 } as never, ok)

      expect(calls[0][0]).toBe(type)
      expect(isStale(queryKeys.logs[type])).toBe(true)
      for (const other of Object.keys(queryKeys.logs) as LogType[]) {
        if (other === type) continue
        expect(isStale(queryKeys.logs[other])).toBe(false)
      }
    })
  }
})

describe("the staleness assumption this all rests on", () => {
  it("a seeded entry is NOT stale on its own within staleTime", () => {
    // If this ever fails, every invalidation assertion above would pass
    // vacuously — everything would read as stale regardless.
    expect(SUMMARIZER_STALE_TIME).toBeGreaterThan(0)
    seedFresh(queryKeys.logs.llm)
    expect(isStale(queryKeys.logs.llm)).toBe(false)
  })
})

describe("an LLM log records which Provider answered (BYOK-03)", () => {
  /**
   * Stamped inside `saveLLMLog` rather than at the three call sites, so the
   * assertions here are about the *only* place that decides it.
   *
   * Mutation evidence: dropping the `...currentProvider()` spread turns both
   * positive cases undefined; reversing the spread order (`{...log,
   * ...currentProvider()}`) turns the caller-wins case red, which is the one
   * that keeps the scheduler's own resolved values from being overwritten if
   * this ever runs server-side.
   */
  const key = (id: string, provider: string, baseUrl: string | null) => ({
    id,
    label: id,
    provider,
    baseUrl,
    hasKey: true,
    lastValidated: null,
  })

  const llm = (id: string) =>
    ({ id, timestamp: 1, status: "success", model: "m" }) as never

  afterEach(() => {
    localStorage.clear()
  })

  it("names the selected Key's provider and address", async () => {
    queryClient.setQueryData(queryKeys.aiKeys, [
      key("k1", "gemini", null),
      key("k2", "openai_compatible", "https://openrouter.example/api/v1"),
    ])
    scopedStorage.setItem("selected_ai_key", "k2")

    await saveLLMLog(llm("l1"), ok)

    const written = calls[0][1][0] as Record<string, unknown>
    expect(written.provider).toBe("openai_compatible")
    expect(written.baseUrl).toBe("https://openrouter.example/api/v1")
  })

  it("records nothing rather than guessing when no Key is cached", async () => {
    queryClient.setQueryData(queryKeys.aiKeys, undefined)
    scopedStorage.setItem("selected_ai_key", "k2")

    await saveLLMLog(llm("l2"), ok)

    const written = calls[0][1][0] as Record<string, unknown>
    expect(written.provider).toBeUndefined()
    expect(written.baseUrl).toBeUndefined()
  })

  it("records nothing when no Key is selected, rather than the newest", async () => {
    // The server resolves `(validated or rows)[0]` when the body names no
    // Key — validated first. `keys[0]` is merely newest-updated, so a
    // fallback here reports a Provider the server did not bill whenever the
    // newest Key is the unvalidated one. Blank beats wrong: this column is
    // read to answer "which Provider is failing me".
    queryClient.setQueryData(queryKeys.aiKeys, [
      key("newest", "openai_compatible", "https://newer.example/v1"),
      key("validated", "gemini", null),
    ])

    await saveLLMLog(llm("l4"), ok)

    const written = calls[0][1][0] as Record<string, unknown>
    expect(written.provider).toBeUndefined()
    expect(written.baseUrl).toBeUndefined()
  })

  it("lets a caller that already knows override it", async () => {
    queryClient.setQueryData(queryKeys.aiKeys, [key("k1", "gemini", null)])
    scopedStorage.setItem("selected_ai_key", "k1")

    await saveLLMLog(
      { ...(llm("l3") as object), provider: "openai_compatible" } as never,
      ok,
    )

    expect((calls[0][1][0] as Record<string, unknown>).provider).toBe(
      "openai_compatible",
    )
  })
})
