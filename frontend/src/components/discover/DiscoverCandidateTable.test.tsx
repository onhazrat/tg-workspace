/**
 * The Discover candidate table, rendered with props only.
 *
 * What is pinned is what each row said before the row became `CandidateRow`:
 * which checkbox is selectable, how a shift-click grows a range from its
 * anchor, the name line's two bidi isolates, a follow result showing only while
 * its job runs, and which actions a followed, dismissed or probed row offers.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import type {
  DiscoveryCandidate,
  DiscoveryProbe,
} from "@/lib/posts/discover-candidates"
import {
  CandidateActions,
  CandidateMetaLine,
  candidateMeta,
  DiscoverCandidateTable,
  RowFollowStatus,
  rangeAnchorIndex,
} from "./DiscoverCandidateTable"

afterEach(cleanup)

const probe = {
  handle: "a",
  status: "ok",
  kind: "channel",
  displayName: "Probe name",
  subscribers: 12500,
  lastPostAt: null,
  sampleCount: 3,
  postsPerWeek: null,
  medianViews: 1200,
  forwardShare: null,
  language: null,
  mediaMix: null,
  mediaDensity: null,
} as unknown as DiscoveryProbe

const row = (
  name: string,
  over: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate => ({
  name,
  counts: { forward: 2, mention: 0, link: 1 },
  total: 3,
  seenIn: [
    {
      channelName: "src1",
      counts: { forward: 2, mention: 0, link: 0 },
      total: 2,
    },
    {
      channelName: "src2",
      counts: { forward: 0, mention: 0, link: 1 },
      total: 1,
    },
  ],
  seenInCount: 2,
  lastSeen: 0,
  isFollowed: false,
  probe: null,
  reference: { channelName: "src1", postId: 1, timestamp: 0 },
  ...over,
})

describe("rangeAnchorIndex", () => {
  const rows = [row("a"), row("b"), row("c")]
  test("a range needs shift, a live anchor and another row", () => {
    expect(rangeAnchorIndex(rows, "a", 2, true)).toBe(0)
    expect(rangeAnchorIndex(rows, "a", 2, false)).toBeNull()
    expect(rangeAnchorIndex(rows, null, 2, true)).toBeNull()
    // The anchor was filtered off screen.
    expect(rangeAnchorIndex(rows, "gone", 2, true)).toBeNull()
    // Shift-clicking the anchor itself is a plain toggle.
    expect(rangeAnchorIndex(rows, "c", 2, true)).toBeNull()
  })
})

describe("candidateMeta", () => {
  test("prefers the report's name, then the probe's", () => {
    expect(candidateMeta(row("a", { displayName: "Own", probe }))).toEqual({
      metaName: "Own",
      subscribers: "12.5K",
    })
    expect(candidateMeta(row("a", { probe })).metaName).toBe("Probe name")
    expect(candidateMeta(row("a"))).toEqual({ metaName: "", subscribers: "" })
  })

  test("zero subscribers is a count, a null is not", () => {
    const zero = { ...probe, subscribers: 0 }
    expect(candidateMeta(row("a", { probe: zero })).subscribers).toBe("0")
    const none = { ...probe, subscribers: null }
    expect(candidateMeta(row("a", { probe: none })).subscribers).toBe("")
  })
})

describe("CandidateMetaLine", () => {
  const html = (metaName: string, subscribers: string) => {
    const { container } = render(
      <CandidateMetaLine metaName={metaName} subscribers={subscribers} />,
    )
    const out = container.innerHTML
    cleanup()
    return out
  }

  test("name and count are separate isolates joined by a dot", () => {
    const out = html("نام", "12K")
    expect(out).toContain('<span dir="auto">نام</span> · <span dir="auto">')
    expect(out).toContain("12K subscribers")
  })

  test("either half renders alone, and neither renders nothing", () => {
    expect(html("", "12K")).not.toContain("·")
    expect(html("", "12K")).toContain("12K subscribers")
    expect(html("Name", "")).not.toContain("·")
    expect(html("Name", "")).toContain("Name")
    expect(html("", "")).toBe("")
  })
})

describe("RowFollowStatus", () => {
  const text = (status: string | undefined, running: boolean) => {
    const { container } = render(
      <RowFollowStatus status={status} isFollowJobRunning={running} />,
    )
    const out = container.textContent
    cleanup()
    return out
  }

  test("shows a settled result only while the job runs", () => {
    expect(text("created", true)).toBe("created")
    expect(text("created", false)).toBe("")
    expect(text("pending", true)).toBe("")
    expect(text(undefined, true)).toBe("")
  })
})

describe("CandidateActions", () => {
  const handlers = () => ({
    onFollow: mock(),
    onInspect: mock(),
    onSetIgnored: mock(),
    onRecheck: mock(),
  })
  const renderActions = (
    candidate: DiscoveryCandidate,
    over: Partial<{
      isOffline: boolean
      isFollowPending: boolean
      isSyncing: boolean
      isRecheckPending: boolean
    }> = {},
  ) => {
    const h = handlers()
    render(
      <CandidateActions
        row={candidate}
        isOffline={false}
        isFollowPending={false}
        isSyncing={false}
        isRecheckPending={false}
        {...h}
        {...over}
      />,
    )
    return h
  }

  test("an unfollowed row follows, inspects and dismisses", () => {
    const candidate = row("a")
    const h = renderActions(candidate)
    fireEvent.click(screen.getByTestId("discover-follow-a"))
    expect(h.onFollow).toHaveBeenCalledWith("a")
    fireEvent.click(screen.getByTestId("discover-inspect-a"))
    expect(h.onInspect).toHaveBeenCalledWith(candidate)
    const ignore = screen.getByTestId("discover-ignore-a")
    expect(ignore.textContent).toContain("Dismiss")
    expect(ignore.title).toBe("Hide this channel from future reports")
    fireEvent.click(ignore)
    expect(h.onSetIgnored).toHaveBeenCalledWith("a", true)
    // No verdict, nothing to recheck.
    expect(screen.queryByTestId("discover-recheck-a")).toBeNull()
  })

  test("Follow is disabled offline, and busy while its follow runs", () => {
    const follow = () =>
      screen.getByTestId("discover-follow-a") as HTMLButtonElement
    renderActions(row("a"))
    expect(follow().getAttribute("aria-busy")).toBeNull()
    cleanup()
    renderActions(row("a"), { isOffline: true })
    expect(follow().disabled).toBe(true)
    cleanup()
    renderActions(row("a"), { isFollowPending: true })
    expect(follow().getAttribute("aria-busy")).toBe("true")
    expect(follow().disabled).toBe(true)
  })

  test("a followed row reads Following, or Syncing while it syncs", () => {
    renderActions(row("a", { isFollowed: true }))
    expect(screen.queryByTestId("discover-follow-a")).toBeNull()
    expect(screen.getByText("Following")).toBeTruthy()
    cleanup()
    renderActions(row("a", { isFollowed: true }), { isSyncing: true })
    expect(screen.getByText("Syncing…")).toBeTruthy()
  })

  test("a dismissed row restores", () => {
    const h = renderActions(row("a", { isIgnored: true }))
    const ignore = screen.getByTestId("discover-ignore-a")
    expect(ignore.textContent).toContain("Restore")
    expect(ignore.title).toBe("Show this channel in reports again")
    fireEvent.click(ignore)
    expect(h.onSetIgnored).toHaveBeenCalledWith("a", false)
  })

  test("a probed row rechecks, unless offline or already rechecking", () => {
    const h = renderActions(row("a", { probe }))
    const recheck = () =>
      screen.getByTestId("discover-recheck-a") as HTMLButtonElement
    expect(recheck().disabled).toBe(false)
    fireEvent.click(recheck())
    expect(h.onRecheck).toHaveBeenCalledWith("a")
    cleanup()
    renderActions(row("a", { probe }), { isOffline: true })
    expect(recheck().disabled).toBe(true)
    cleanup()
    renderActions(row("a", { probe }), { isRecheckPending: true })
    expect(recheck().disabled).toBe(true)
  })
})

describe("DiscoverCandidateTable", () => {
  type Over = Partial<React.ComponentProps<typeof DiscoverCandidateTable>>
  function Harness({
    candidates,
    initial = [],
    ...over
  }: Over & { candidates: DiscoveryCandidate[]; initial?: string[] }) {
    const [selected, setSelected] = useState(() => new Set(initial))
    return (
      <DiscoverCandidateTable
        candidates={candidates}
        selectedForFollow={selected}
        setSelectedForFollow={setSelected}
        unfollowedCount={candidates.filter((c) => !c.isFollowed).length}
        isOffline={false}
        isFollowJobRunning={false}
        activeFollowNames={[]}
        syncingNames={new Set()}
        resultStatusByName={new Map()}
        onFollow={() => {}}
        onInspect={() => {}}
        onSetIgnored={() => {}}
        onRecheck={() => {}}
        isRecheckPending={false}
        weights={{ forward: 3, mention: 2, link: 1 }}
        showScore={false}
        {...over}
      />
    )
  }
  const box = (name: string) =>
    screen.getByTestId(`discover-select-${name}`) as HTMLInputElement
  const checked = (names: string[]) => names.filter((n) => box(n).checked)

  test("a shift-click selects the range from the last plain click", () => {
    const rows = ["a", "b", "c", "d"].map((n) => row(n))
    render(<Harness candidates={rows} />)
    fireEvent.click(box("b"))
    fireEvent.click(box("d"), { shiftKey: true })
    expect(checked(["a", "b", "c", "d"])).toEqual(["b", "c", "d"])
    // The anchor stays on b. Shift-clicking a selected row clears b through it.
    fireEvent.click(box("c"), { shiftKey: true })
    expect(checked(["a", "b", "c", "d"])).toEqual(["d"])
  })

  test("a plain click toggles one row and moves the anchor", () => {
    const rows = ["a", "b", "c"].map((n) => row(n))
    render(<Harness candidates={rows} />)
    fireEvent.click(box("a"))
    fireEvent.click(box("a"))
    expect(checked(["a", "b", "c"])).toEqual([])
    fireEvent.click(box("c"))
    fireEvent.click(box("a"), { shiftKey: true })
    // The clicked row decides the direction: a was unselected, so the range selects.
    expect(checked(["a", "b", "c"])).toEqual(["a", "b", "c"])
  })

  test("select-all toggles every unfollowed row", () => {
    const rows = [row("a"), row("b", { isFollowed: true })]
    render(<Harness candidates={rows} />)
    const all = screen.getByTestId("discover-select-all") as HTMLInputElement
    expect(all.checked).toBe(false)
    fireEvent.click(all)
    expect(all.checked).toBe(true)
    expect(box("a").checked).toBe(true)
    // A followed row reads as selected-already and cannot be toggled.
    expect(box("b").disabled).toBe(true)
    expect(box("b").getAttribute("aria-label")).toBe("@b already followed")
    expect(box("a").getAttribute("aria-label")).toBe("Select @a to follow")
  })

  test("the header box is indeterminate on a partial selection", () => {
    const rows = [row("a"), row("b")]
    render(<Harness candidates={rows} initial={["a"]} />)
    const all = screen.getByTestId("discover-select-all") as HTMLInputElement
    expect(all.indeterminate).toBe(true)
  })

  test("offline, or a row mid-follow, locks its checkbox", () => {
    render(<Harness candidates={[row("a")]} isOffline />)
    expect(box("a").disabled).toBe(true)
    expect(
      (screen.getByTestId("discover-select-all") as HTMLInputElement).disabled,
    ).toBe(true)
    cleanup()
    render(<Harness candidates={[row("a")]} activeFollowNames={["a"]} />)
    expect(box("a").disabled).toBe(true)
  })

  test("the score column shows only while sorting by it", () => {
    render(<Harness candidates={[row("a")]} />)
    expect(screen.queryByTestId("discover-score-a")).toBeNull()
    cleanup()
    render(<Harness candidates={[row("a")]} showScore />)
    expect(screen.getByTestId("discover-score-a").textContent).toBe("7")
    expect(screen.getByText("Score").getAttribute("title")).toBe(
      "Weighted: 3×Fwd + 2×Men + 1×Link",
    )
  })

  test("a row renders its counts, sources and statistics", () => {
    const followed = row("a", {
      probe: { ...probe, status: "unavailable", kind: "bot" },
    })
    render(
      <Harness
        candidates={[followed]}
        isFollowJobRunning
        resultStatusByName={new Map([["a", "created"]])}
      />,
    )
    expect(screen.getByTestId("discover-count-forward-a").textContent).toBe("2")
    expect(screen.getByTestId("discover-count-mention-a").textContent).toBe("–")
    expect(screen.getByTestId("discover-count-total-a").textContent).toBe("3")
    expect(screen.getByTestId("discover-probe-kind-a").textContent).toBe("Bot")
    const seenBy = screen.getByTestId("discover-seen-in-link-src2")
    expect(seenBy.parentElement?.textContent).toBe(", @src2 (1)")
    expect(screen.getByTestId("discover-last-post-a").textContent).toBe("–")
    expect(screen.getByTestId("discover-posts-per-week-a").textContent).toBe(
      "3 posts",
    )
    expect(screen.getByTestId("discover-median-views-a").textContent).toBe(
      "1.2K",
    )
    expect(screen.getByText("created")).toBeTruthy()
    expect(screen.getByText("Probe name")).toBeTruthy()
  })

  test("a known last post renders as a time", () => {
    const recent = row("a", { probe: { ...probe, lastPostAt: Date.now() } })
    render(<Harness candidates={[recent]} />)
    expect(screen.getByTestId("discover-last-post-a").textContent).not.toBe("–")
  })
})
