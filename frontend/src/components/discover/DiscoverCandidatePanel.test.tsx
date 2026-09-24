/**
 * The pieces the Discover candidate panel is assembled from. Each takes props
 * only; the sheet and its two queries stay in `DiscoverCandidatePanel`.
 *
 * What is pinned is the distinction the panel exists to keep: a Channel nobody
 * has measured, a pruned reference and a failed lookup are three different
 * absences, and none of them may read as a bad number.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type {
  DiscoveryCandidate,
  DiscoveryProbe,
} from "@/lib/posts/discover-candidates"
import type { Post } from "@/types"
import { ReferenceSection } from "./DiscoverCandidatePanel"
import {
  ChannelStatistics,
  FollowControl,
  RecentPosts,
  referenceView,
  SeenBy,
  SignalCounts,
} from "./DiscoverPanelSections"

afterEach(cleanup)

const probe = {
  handle: "cand",
  subscribers: 12000,
  lastPostAt: null,
  sampleCount: 0,
  postsPerWeek: null,
  medianViews: null,
  forwardShare: null,
  language: null,
  mediaMix: null,
  mediaDensity: null,
} as unknown as DiscoveryProbe

const candidate = {
  name: "cand",
  counts: { forward: 2, mention: 1, link: 0 },
  total: 3,
  seenIn: [{ channelName: "source", total: 3 }],
  seenInCount: 1,
  lastSeen: 0,
  isFollowed: false,
  probe: null,
  reference: { channelName: "source", postId: 9, timestamp: 0 },
} as unknown as DiscoveryCandidate

describe("referenceView", () => {
  const view = (over: Partial<Parameters<typeof referenceView>[0]>) =>
    referenceView({
      hasReference: true,
      loading: false,
      failed: false,
      found: true,
      text: "body",
      ...over,
    })

  test("tells the three absences apart", () => {
    expect(view({ hasReference: false })).toBe("none")
    expect(view({ loading: true })).toBe("loading")
    expect(view({})).toBe("text")
    // Retention pruned it: the lookup succeeded and found nothing.
    expect(view({ found: false, text: undefined })).toBe("pruned")
    // The lookup failed, so it is not known to be pruned.
    expect(view({ failed: true, found: false, text: undefined })).toBe(
      "unavailable",
    )
    // The post survives but has no text of its own.
    expect(view({ text: "" })).toBe("unavailable")
  })
})

describe("ReferenceSection", () => {
  const reference = candidate.reference
  test("quotes the post and links to it", () => {
    render(
      <ReferenceSection
        reference={reference}
        loading={false}
        failed={false}
        post={{ text: "hello there" } as Post}
      />,
    )
    expect(
      screen.getByTestId("discover-panel-reference-text").textContent,
    ).toBe("hello there")
    expect(
      (screen.getByTestId("discover-panel-reference-link") as HTMLAnchorElement)
        .href,
    ).toContain("/source/9")
  })

  test("a pruned post says so; no reference says that instead", () => {
    render(
      <ReferenceSection
        reference={reference}
        loading={false}
        failed={false}
        post={null}
      />,
    )
    expect(
      screen.getByTestId("discover-panel-reference-missing").textContent,
    ).toContain("no longer in your corpus")
    cleanup()
    render(
      <ReferenceSection
        reference={null}
        loading={false}
        failed={false}
        post={null}
      />,
    )
    expect(screen.getByText("No reference recorded.")).toBeTruthy()
  })
})

describe("FollowControl", () => {
  test("follows on click, and reads Following once followed", () => {
    const onFollow = mock()
    render(
      <FollowControl
        name="cand"
        isFollowed={false}
        disabled={false}
        following={false}
        onFollow={onFollow}
      />,
    )
    fireEvent.click(screen.getByTestId("discover-panel-follow-cand"))
    expect(onFollow).toHaveBeenCalledTimes(1)
    cleanup()
    render(
      <FollowControl
        name="cand"
        isFollowed
        disabled={false}
        following={false}
        onFollow={onFollow}
      />,
    )
    expect(screen.getByTestId("discover-panel-following")).toBeTruthy()
  })
})

describe("ChannelStatistics", () => {
  test("an unprobed handle says it is unmeasured and offers a first check", () => {
    const onRecheck = mock()
    render(
      <ChannelStatistics
        candidate={candidate}
        recheckDisabled={false}
        onRecheck={onRecheck}
      />,
    )
    expect(screen.getByTestId("discover-panel-not-probed")).toBeTruthy()
    const button = screen.getByTestId("discover-panel-recheck")
    expect(button.textContent).toContain("Check this handle")
    fireEvent.click(button)
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })

  test("a probed handle shows dashes for what was not measured, not zeros", () => {
    render(
      <ChannelStatistics
        candidate={{ ...candidate, probe }}
        recheckDisabled
        onRecheck={() => {}}
      />,
    )
    expect(screen.queryByTestId("discover-panel-not-probed")).toBeNull()
    expect(screen.getByText("12K")).toBeTruthy()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    const button = screen.getByTestId(
      "discover-panel-recheck",
    ) as HTMLButtonElement
    expect(button.textContent).toContain("Recheck")
    expect(button.disabled).toBe(true)
  })

  test("an empty language code reads as unmeasured, not as a blank", () => {
    // `languageName("")` falls back to the code itself, which is "".
    render(
      <ChannelStatistics
        candidate={{ ...candidate, probe: { ...probe, language: "" } }}
        recheckDisabled={false}
        onRecheck={() => {}}
      />,
    )
    const value = screen.getByText("Language").nextElementSibling
    expect(value?.textContent).toBe("—")
  })
})

describe("signals and sources", () => {
  test("counts each signal, the total, and who saw it", () => {
    render(
      <>
        <SignalCounts candidate={candidate} />
        <SeenBy candidate={candidate} />
      </>,
    )
    expect(screen.getByText("Seen by (1)")).toBeTruthy()
    expect(screen.getByText("@source")).toBeTruthy()
    expect(screen.getByText("Total:").parentElement?.textContent).toContain("3")
  })
})

describe("RecentPosts", () => {
  test("loading, empty, and a list whose unmeasured views stay blank", () => {
    render(<RecentPosts handle="cand" loading posts={[]} />)
    expect(screen.getByText("Loading posts…")).toBeTruthy()
    cleanup()
    render(<RecentPosts handle="cand" loading={false} posts={[]} />)
    expect(screen.getByTestId("discover-panel-posts-empty")).toBeTruthy()
    cleanup()
    render(
      <RecentPosts
        handle="cand"
        loading={false}
        posts={[
          { postId: 1, timestamp: 0, views: 1500, text: "one" },
          { postId: 2, timestamp: 0, views: null, text: "" },
        ]}
      />,
    )
    expect(screen.getByText("1.5K views")).toBeTruthy()
    expect(
      screen.getByTestId("discover-panel-post-2").textContent,
    ).not.toContain("views")
    expect(screen.getByText("(no text)")).toBeTruthy()
  })
})
