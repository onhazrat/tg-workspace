import { describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { queryKeys } from "./queryKeys"
import { useLogsQuery } from "./useLogs"

/**
 * The property G2.1 rests on: **an enabled query refetches when its key is
 * invalidated; a disabled one does not.**
 *
 * That asymmetry is why the app used to carry seventeen imperative
 * `loadXLogs()` calls. `DataContext` created the log queries with
 * `enabled: false`, so the invalidation in `lib/logs/write.ts` could only mark
 * them stale — every writer had to call back and refetch by hand. With the
 * panels owning enabled queries, the invalidation is sufficient and all
 * seventeen are gone.
 *
 * If anyone re-disables these, the second test here starts passing for the
 * wrong reason and the first fails — which is the signal that the reloads have
 * to come back.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

let fetches = 0
let rows: { id: string; timestamp: number }[] = []

/**
 * Stub the global `fetch` rather than `mock.module("@/api", …)`: Bun's module
 * mocks are process-wide and `lib/repository.posts.test.ts` already mocks that
 * module. This also exercises the real `api.listLogs` path.
 */
function harness() {
  fetches = 0
  rows = [{ id: "a", timestamp: 1 }]
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    fetches++
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as unknown as typeof fetch
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return { client, restore: () => (globalThis.fetch = original) }
}

describe("useLogsQuery", () => {
  it("refetches on invalidation when enabled", async () => {
    const { client, restore } = harness()
    try {
      renderHook(() => useLogsQuery("publish", true), {
        wrapper: wrapper(client),
      })
      await waitFor(() => expect(fetches).toBe(1))

      await client.invalidateQueries({ queryKey: queryKeys.logs.publish })

      // This is what makes `lib/logs/write.ts`'s invalidation enough on its own.
      await waitFor(() => expect(fetches).toBe(2))
    } finally {
      restore()
    }
  })

  it("does NOT refetch on invalidation when disabled", async () => {
    const { client, restore } = harness()
    try {
      renderHook(() => useLogsQuery("publish", false), {
        wrapper: wrapper(client),
      })
      await client.invalidateQueries({ queryKey: queryKeys.logs.publish })
      await new Promise((r) => setTimeout(r, 30))

      // The trap G2.1 removed: a disabled query is marked stale and left alone,
      // so a panel wired this way silently stops updating after a write.
      expect(fetches).toBe(0)
    } finally {
      restore()
    }
  })

  it("sorts newest first", async () => {
    const { client, restore } = harness()
    rows = [
      { id: "old", timestamp: 1 },
      { id: "new", timestamp: 9 },
      { id: "mid", timestamp: 5 },
    ]
    try {
      const { result } = renderHook(() => useLogsQuery("sync", true), {
        wrapper: wrapper(client),
      })

      await waitFor(() => expect(result.current.data).toBeDefined())
      expect(result.current.data?.map((l) => l.timestamp)).toEqual([9, 5, 1])
    } finally {
      restore()
    }
  })
})
