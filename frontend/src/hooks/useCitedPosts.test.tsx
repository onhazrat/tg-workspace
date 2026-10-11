/**
 * A Summary's Cited Posts through the batch Post lookup (SUMTAB-04): one
 * request for every Citation, the snapshot behind it, the frozen Scope's refs
 * deciding what is out of Scope, and no request for a Summary citing nothing.
 */
import { describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import type { Post, Summary } from "@/types"
import { useCitedPosts } from "./useCitedPosts"

const post = (channelName: string, id: number, text: string): Post => ({
  id,
  channelName,
  text,
  date: "2026-10-07T09:00:00Z",
  timestamp: 0,
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const summary: Summary = {
  id: "s1",
  text: "Rates [news #7] and [news #8], again [news #7].",
  language: "English",
  timestamp: 0,
  citedPosts: { "news-8": post("news", 8, "kept") },
  scope: {
    start: 0,
    end: 1,
    posts: [{ channelName: "news", postId: 7 }],
  },
}

describe("useCitedPosts", () => {
  test("looks every Citation up once, live first, snapshot behind it, Scope from the refs", async () => {
    const lookup = mock(async () => [post("news", 7, "now")])
    const { result } = renderHook(() => useCitedPosts(summary, lookup), {
      wrapper,
    })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith([
      { channelName: "news", postId: 7 },
      { channelName: "news", postId: 8 },
    ])
    expect(result.current.resolve("news", 7)).toMatchObject({
      source: "live",
      outsideScope: false,
    })
    expect(result.current.resolve("news", 8)).toMatchObject({
      source: "snapshot",
      outsideScope: true,
    })
  })

  test("a Summary citing nothing makes no request and is not loading", () => {
    const lookup = mock(async () => [])
    const { result } = renderHook(
      () => useCitedPosts({ ...summary, text: "no citations" }, lookup),
      { wrapper },
    )
    expect(result.current.loading).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })
})
