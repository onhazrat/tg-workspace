import { describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { queryKeys } from "./queryKeys"
import { type LogLister, useLogsQuery } from "./useLogs"

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
let rows: { timestamp: number }[] = []

/**
 * Injected through `LogsQueryOptions.fetcher`, not a `fetch` stub.
 * `globalThis.fetch` is shared by every test file in the process, so swapping
 * it here raced with other files' in-flight requests.
 */
function harness() {
  fetches = 0
  rows = [{ timestamp: 1 }]
  const lister = (async () => {
    fetches++
    return rows
  }) as unknown as LogLister
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return { client, lister }
}

describe("useLogsQuery", () => {
  it("refetches on invalidation when enabled", async () => {
    const { client, lister } = harness()
    renderHook(() => useLogsQuery("publish", true, { lister }), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(fetches).toBe(1))

    await client.invalidateQueries({ queryKey: queryKeys.logs.publish })

    // This is what makes `lib/logs/write.ts`'s invalidation enough on its own.
    await waitFor(() => expect(fetches).toBe(2))
  })

  it("does NOT refetch on invalidation when disabled", async () => {
    const { client, lister } = harness()
    renderHook(() => useLogsQuery("publish", false, { lister }), {
      wrapper: wrapper(client),
    })
    await client.invalidateQueries({ queryKey: queryKeys.logs.publish })
    await new Promise((r) => setTimeout(r, 30))

    // The trap G2.1 removed: a disabled query is marked stale and left alone,
    // so a panel wired this way silently stops updating after a write.
    expect(fetches).toBe(0)
  })

  it("sorts newest first", async () => {
    const { client, lister } = harness()
    rows = [{ timestamp: 1 }, { timestamp: 9 }, { timestamp: 5 }]
    {
      const { result } = renderHook(
        () => useLogsQuery("sync", true, { lister }),
        {
          wrapper: wrapper(client),
        },
      )

      await waitFor(() => expect(result.current.data).toBeDefined())
      expect(result.current.data?.map((l) => l.timestamp)).toEqual([9, 5, 1])
    }
  })
})
