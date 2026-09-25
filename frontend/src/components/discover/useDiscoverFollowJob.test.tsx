import { describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"

import type { FollowJobStatus } from "@/api"
import type { DiscoveryCandidate } from "@/lib/posts/discover-candidates"
import { useDiscoverFollowJob } from "./useDiscoverFollowJob"

const candidates = [
  { name: "alpha", isFollowed: false },
  { name: "beta", isFollowed: false },
] as DiscoveryCandidate[]

const done = (results: { name: string; status: string }[]): FollowJobStatus =>
  ({ completed: results.length, total: results.length, results }) as never

/** The follow call is injected, so each test decides how the job answers. */
function harness(
  follow: (names: string[]) => Promise<FollowJobStatus | null>,
  isOffline = false,
) {
  const sent: string[][] = []
  const client = new QueryClient()
  const { result } = renderHook(
    () =>
      useDiscoverFollowJob({
        candidates,
        isOffline,
        followDiscoverChannels: (payload) => {
          const names = payload.map((row) => row.name)
          sent.push(names)
          return follow(names)
        },
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  )
  return { result, sent }
}

describe("useDiscoverFollowJob executeFollow", () => {
  test("follows, records each verdict and keeps only failures selected", async () => {
    const { result } = harness(async () =>
      done([
        { name: "alpha", status: "added" },
        { name: "beta", status: "error" },
      ]),
    )
    act(() => result.current.setSelectedForFollow(new Set(["alpha", "beta"])))
    await act(() => result.current.executeFollow(["alpha", "beta"]))

    expect([...result.current.selectedForFollow]).toEqual(["beta"])
    expect(result.current.resultStatusByName.get("alpha")).toBe("added")
    expect(result.current.followProgress?.completed).toBe(2)
    expect(result.current.isFollowJobRunning).toBe(false)
  })

  test("sends nothing while offline", async () => {
    const { result, sent } = harness(async () => null, true)
    await act(() => result.current.executeFollow(["alpha"]))
    expect(sent).toEqual([])
  })

  test("never starts a second job for a name already in flight", async () => {
    let release: (status: FollowJobStatus | null) => void = () => {}
    // Only the first job hangs; the second answers at once.
    const { result, sent } = harness((names) =>
      names.includes("alpha")
        ? new Promise((resolve) => {
            release = resolve
          })
        : Promise.resolve(null),
    )
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.executeFollow(["alpha"])
    })
    expect(result.current.activeFollowNames).toEqual(["alpha"])
    await act(() => result.current.executeFollow(["alpha", "beta"]))
    expect(sent).toEqual([["alpha"], ["beta"]])

    await act(async () => {
      release(null)
      await first
    })
    // A job that returns no status still unlocks its rows.
    expect(result.current.activeFollowNames).toEqual([])
  })
})
