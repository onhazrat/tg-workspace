import { beforeEach, describe, expect, test } from "bun:test"
import { resetInFlight, singleFlight } from "@/lib/singleFlight"

describe("singleFlight", () => {
  beforeEach(() => {
    resetInFlight()
  })

  test("two concurrent calls with the same key produce one underlying fetch", async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      await Promise.resolve()
      return "value"
    }

    const [a, b] = await Promise.all([
      singleFlight("posts:ch:0:100", fetcher),
      singleFlight("posts:ch:0:100", fetcher),
    ])

    expect(calls).toBe(1)
    expect(a).toBe("value")
    expect(b).toBe("value")
  })

  test("many concurrent callers still produce one fetch", async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      await Promise.resolve()
      return calls
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, () => singleFlight("same", fetcher)),
    )

    expect(calls).toBe(1)
    expect(results).toEqual(Array(10).fill(1))
  })

  test("different keys are not de-duplicated", async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      return calls
    }

    await Promise.all([
      singleFlight("posts:a", fetcher),
      singleFlight("posts:b", fetcher),
    ])

    expect(calls).toBe(2)
  })

  test("a later call after settling fetches again — this de-dups, it does not cache", async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      return calls
    }

    expect(await singleFlight("k", fetcher)).toBe(1)
    expect(await singleFlight("k", fetcher)).toBe(2)
    expect(calls).toBe(2)
  })

  test("a rejection is shared by concurrent callers and does not poison the key", async () => {
    let calls = 0
    const failing = async () => {
      calls++
      throw new Error("boom")
    }

    const results = await Promise.allSettled([
      singleFlight("k", failing),
      singleFlight("k", failing),
    ])

    expect(calls).toBe(1)
    expect(results.every((r) => r.status === "rejected")).toBe(true)

    // The failed entry must be cleared, or the key would be permanently stuck.
    await singleFlight("k", async () => "recovered").then((v) =>
      expect(v).toBe("recovered"),
    )
    expect(calls).toBe(1)
  })
})
