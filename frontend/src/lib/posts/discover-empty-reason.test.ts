import { describe, expect, test } from "bun:test"
import type { Post } from "@/types"
import {
  computeDiscoveryCandidates,
  type DiscoverySignalKind,
  deriveDiscoveryEmptyReason,
} from "./discover-candidates"

const ALL_KINDS = new Set<DiscoverySignalKind>(["forward", "mention", "link"])
const FORWARD_ONLY = new Set<DiscoverySignalKind>(["forward"])

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    channelName: "carrier",
    text: "",
    date: "",
    timestamp: 1000,
    ...overrides,
  } as Post
}

describe("deriveDiscoveryEmptyReason", () => {
  test("no signals wins over everything", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: new Set(),
        selectedChannelCount: 0,
        postsInScope: 0,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_signals_enabled")
  })

  test("no channels before no posts", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 0,
        postsInScope: 0,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_channels_selected")
  })

  test("no posts in scope", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 2,
        postsInScope: 0,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_posts_in_scope")
  })

  test("original_only only when forwards are the sole signal + original filter", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: FORWARD_ONLY,
        selectedChannelCount: 1,
        postsInScope: 5,
        candidateCount: 0,
        forwardedFilter: "original",
      }),
    ).toBe("original_only")
  })

  test("no_candidates when posts exist but reference nothing", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 1,
        postsInScope: 5,
        candidateCount: 0,
        forwardedFilter: "all",
      }),
    ).toBe("no_candidates")
  })

  test("undefined when candidates exist", () => {
    expect(
      deriveDiscoveryEmptyReason({
        enabledKinds: ALL_KINDS,
        selectedChannelCount: 1,
        postsInScope: 5,
        candidateCount: 3,
        forwardedFilter: "all",
      }),
    ).toBeUndefined()
  })
})

describe("parity with computeDiscoveryCandidates", () => {
  // The helper must reach the same reason the client function embeds inline,
  // given the same scope facts.
  const cases: {
    name: string
    posts: Post[]
    selectedChannelCount: number
    enabledKinds: Set<DiscoverySignalKind>
    forwardedFilter: "all" | "original"
  }[] = [
    {
      name: "posts with a mention",
      posts: [post({ text: "hey @alpha_news" })],
      selectedChannelCount: 1,
      enabledKinds: ALL_KINDS,
      forwardedFilter: "all",
    },
    {
      name: "posts but no references",
      posts: [post({ text: "nothing here" })],
      selectedChannelCount: 1,
      enabledKinds: ALL_KINDS,
      forwardedFilter: "all",
    },
    {
      name: "forward-only + original filter, no forwards",
      posts: [post({ text: "plain" })],
      selectedChannelCount: 1,
      enabledKinds: FORWARD_ONLY,
      forwardedFilter: "original",
    },
  ]

  for (const c of cases) {
    test(c.name, () => {
      const result = computeDiscoveryCandidates(c.posts, [], {
        forwardedFilter: c.forwardedFilter,
        selectedChannelCount: c.selectedChannelCount,
        enabledKinds: c.enabledKinds,
      })
      const derived = deriveDiscoveryEmptyReason({
        enabledKinds: c.enabledKinds,
        selectedChannelCount: c.selectedChannelCount,
        postsInScope: c.posts.length,
        candidateCount: result.candidates.length,
        forwardedFilter: c.forwardedFilter,
      })
      expect(derived).toBe(result.emptyReason)
    })
  }
})
