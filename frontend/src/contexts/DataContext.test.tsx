/**
 * First context test in the repo — the proof for T1 of
 * `docs/architecture-simplification-plan.md`.
 *
 * Nothing here was previously expressible. The only way to exercise a component
 * was `renderToStaticMarkup` (one static pass, no effects, no state updates), so
 * 0 of 9 contexts had a test. What this file covers — an effect reconciling
 * selection state against a react-query result, plus its localStorage
 * persistence — needs a DOM, real effects, and re-renders.
 *
 * The behaviour is worth pinning independently of the tooling. `DataContext`
 * silently auto-selects channels that appear and drops ones that vanish, via
 * nested `setState` updaters. Workstreams A3 and G2 both rewrite this code, and
 * a regression would surface as "my channel selection is wrong sometimes"
 * rather than as a crash.
 *
 * **No `mock.module` here, deliberately.** Bun's module mocks are process-wide,
 * not file-scoped: an earlier draft mocked `@/lib/repository` and silently broke
 * `repository.test.ts` when the whole suite ran in one process. Instead the
 * query cache is seeded directly. Only three of DataContext's queries can fetch
 * at all — the five log queries and `dbStats` are `enabled: false` — and seeded
 * entries are fresh for `SUMMARIZER_STALE_TIME` (30s), so no `queryFn` runs and
 * the repository is never reached.
 */
import { beforeEach, describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { DataProvider, useData } from "@/contexts/DataContext"
import { queryKeys } from "@/hooks/queryKeys"
import type { Channel } from "@/types"

function channel(name: string): Channel {
  return {
    id: name,
    name,
    tags: [],
    lastUpdated: 0,
    followedAt: 0,
  } as unknown as Channel
}

/** A client pre-seeded so every enabled query is already fresh. */
function seededClient(names: string[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Two entries since the split: the grid paints from `channels` alone, and
  // `channelStats` arrives on its own request.
  client.setQueryData(queryKeys.channels, names.map(channel))
  client.setQueryData(queryKeys.channelStats, {})
  client.setQueryData(queryKeys.summaries, [])
  client.setQueryData(queryKeys.bots, { credentials: [], destinations: [] })
  return client
}

function mountWithChannels(names: string[], bios?: Record<string, string>) {
  const client = seededClient(names)
  if (bios) client.setQueryData(queryKeys.channelBios, bios)
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <DataProvider>{children}</DataProvider>
      </QueryClientProvider>
    )
  }
  return renderHook(() => useData(), { wrapper })
}

beforeEach(() => {
  localStorage.clear()
})

describe("DataContext channel selection", () => {
  it("auto-selects every channel present on first load", async () => {
    const { result } = mountWithChannels(["alpha", "beta"])

    await waitFor(() => {
      expect(result.current.selectedChannels.size).toBe(2)
    })
    expect(Array.from(result.current.selectedChannels).sort()).toEqual([
      "alpha",
      "beta",
    ])
  })

  it("does not re-select a channel the user turned off", async () => {
    const { result } = mountWithChannels(["alpha", "beta"])
    await waitFor(() => expect(result.current.selectedChannels.size).toBe(2))

    act(() => {
      result.current.setSelectedChannels(new Set(["alpha"]))
    })

    // The reconciling effect only adds names absent from `prevChannelNames`,
    // and beta is already known — so it must stay off.
    await waitFor(() => {
      expect(Array.from(result.current.selectedChannels)).toEqual(["alpha"])
    })
  })

  it("drops channels that no longer exist server-side", async () => {
    const { result } = mountWithChannels(["alpha", "beta"])
    await waitFor(() => expect(result.current.selectedChannels.size).toBe(2))

    act(() => {
      result.current.setChannels([channel("alpha")])
    })

    await waitFor(() => {
      expect(Array.from(result.current.selectedChannels)).toEqual(["alpha"])
    })
  })

  it("auto-selects a channel that appears later without disturbing the rest", async () => {
    const { result } = mountWithChannels(["alpha"])
    await waitFor(() => expect(result.current.selectedChannels.size).toBe(1))

    act(() => {
      result.current.setChannels([channel("alpha"), channel("gamma")])
    })

    await waitFor(() => {
      expect(Array.from(result.current.selectedChannels).sort()).toEqual([
        "alpha",
        "gamma",
      ])
    })
  })

  it("persists the selection to localStorage", async () => {
    const { result } = mountWithChannels(["alpha", "beta"])
    await waitFor(() => expect(result.current.selectedChannels.size).toBe(2))

    await waitFor(() => {
      const saved = localStorage.getItem("selectedChannels")
      expect(saved).not.toBeNull()
      expect(JSON.parse(saved as string).sort()).toEqual(["alpha", "beta"])
    })
  })

  it("restores a persisted selection instead of re-selecting everything", async () => {
    localStorage.setItem("selectedChannels", JSON.stringify(["beta"]))
    localStorage.setItem("prevChannelNames", JSON.stringify(["alpha", "beta"]))

    const { result } = mountWithChannels(["alpha", "beta"])

    // Both names are already known, so neither counts as newly arrived.
    await waitFor(() => {
      expect(Array.from(result.current.selectedChannels)).toEqual(["beta"])
    })
  })
})

describe("useData", () => {
  it("throws outside a DataProvider", () => {
    expect(() => renderHook(() => useData())).toThrow(
      /must be used within a DataProvider/,
    )
  })
})

describe("DataContext bio merge", () => {
  /**
   * Bios are fetched separately from the channel list — 40% of its bytes — and
   * merged back onto the channel objects here. Every consumer reads
   * `channel.bio`: the card, and `format-channels-for-prompt` for the selected
   * channels. If the merge stops happening, prompts quietly lose their bios,
   * which is the failure this asserts against.
   */
  it("puts bios back on the channels that have one", async () => {
    const { result } = mountWithChannels(["alpha", "beta"], {
      alpha: "the alpha channel",
    })

    await waitFor(() => expect(result.current.channels).toHaveLength(2))
    const byName = Object.fromEntries(
      result.current.channels.map((c) => [c.name, c.bio]),
    )
    expect(byName.alpha).toBe("the alpha channel")
    expect(byName.beta).toBeUndefined()
  })

  it("renders the channels before bios arrive rather than waiting", async () => {
    // The point of the split: an unresolved bios query must not hold the grid.
    const { result } = mountWithChannels(["alpha"])

    await waitFor(() => expect(result.current.channels).toHaveLength(1))
    expect(result.current.channels[0].name).toBe("alpha")
  })
})
