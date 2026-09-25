/**
 * The pieces `DiscoverView` is assembled from, rendered with props only.
 *
 * What is pinned is what the view decided inline before: when the bulk bar
 * shows and which of its modes it takes, the heading's count and weights, the
 * progress line giving way to the bulk bar, and the order in which loading, no
 * report, an explained empty result and the table win.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { FollowJobStatus } from "@/api"
import type { DiscoverSortKey } from "@/lib/posts/discover-candidates"
import { resolveDiscoveryEmptyState } from "@/lib/posts/discover-empty-state"
import {
  CandidatesHeading,
  DiscoverReportBody,
  discoverBulkState,
  FollowProgressLine,
  followConfirmDescription,
} from "./DiscoverViewSections"

afterEach(cleanup)

describe("discoverBulkState", () => {
  const state = (over: Partial<Parameters<typeof discoverBulkState>[0]>) =>
    discoverBulkState({
      candidateCount: 3,
      selected: new Set(["a", "b"]),
      activeFollowNames: [],
      followState: "all",
      ...over,
    })

  test("hidden with no rows or no selection", () => {
    expect(state({ candidateCount: 0 })).toBeNull()
    expect(state({ selected: new Set() })).toBeNull()
  })

  test("counts the selection and dismisses by default", () => {
    expect(state({})).toEqual({
      selectedCount: 2,
      isFollowJobRunning: false,
      dismissMode: "dismiss",
      showRecheck: false,
    })
  })

  test("reads as running only when a selected name is mid-follow", () => {
    expect(state({ activeFollowNames: ["z"] })?.isFollowJobRunning).toBe(false)
    expect(state({ activeFollowNames: ["b"] })?.isFollowJobRunning).toBe(true)
  })

  test("Ignored restores; Not followable offers a recheck", () => {
    expect(state({ followState: "ignored" })?.dismissMode).toBe("restore")
    expect(state({ followState: "ignored" })?.showRecheck).toBe(false)
    expect(state({ followState: "unavailable" })?.showRecheck).toBe(true)
    expect(state({ followState: "unavailable" })?.dismissMode).toBe("dismiss")
  })
})

test("followConfirmDescription counts the pending names", () => {
  expect(followConfirmDescription(null)).toBe("")
  expect(followConfirmDescription(["a", "b", "c"])).toBe(
    "Follow 3 channels? This will scrape and add each selected source.",
  )
})

describe("CandidatesHeading", () => {
  const renderHeading = (count: number, sortKey: DiscoverSortKey) => {
    const onSortKeyChange = mock()
    const { container } = render(
      <CandidatesHeading
        count={count}
        sortKey={sortKey}
        onSortKeyChange={onSortKeyChange}
        weights={{ forward: 1, mention: 1, link: 1 }}
        onWeightsChange={() => {}}
      />,
    )
    return { onSortKeyChange, text: container.textContent }
  }

  test("an empty report shows the bare heading and no sort controls", () => {
    const { text } = renderHeading(0, "weighted")
    expect(text).toBe("Channel Candidates")
    expect(screen.queryByText("Sort by")).toBeNull()
  })

  test("counts candidates, singular and plural", () => {
    expect(renderHeading(1, "total").text).toContain("(1 candidate)")
    cleanup()
    expect(renderHeading(4, "total").text).toContain("(4 candidates)")
  })

  test("the weights editor shows only for a weighted sort", () => {
    const { onSortKeyChange } = renderHeading(2, "total")
    expect(screen.queryByTestId("discover-weights-editor")).toBeNull()
    fireEvent.click(screen.getByTestId("discover-sort-weighted"))
    expect(onSortKeyChange).toHaveBeenCalledWith("weighted")
    cleanup()
    renderHeading(2, "weighted")
    expect(screen.getByTestId("discover-weights-editor")).toBeTruthy()
    cleanup()
    renderHeading(2, "subscribers")
    expect(screen.queryByTestId("discover-weights-editor")).toBeNull()
  })
})

describe("FollowProgressLine", () => {
  const progress = { completed: 3, total: 10 } as FollowJobStatus
  const line = () => screen.queryByTestId("discover-follow-progress")

  test("shows progress once the selection has cleared", () => {
    render(
      <FollowProgressLine
        isFollowJobRunning
        followProgress={progress}
        selectedCount={0}
      />,
    )
    expect(line()?.textContent).toBe("Following… 3/10")
  })

  test("gives way to the bulk bar, and hides with no job or no progress", () => {
    const cases = [
      { isFollowJobRunning: true, followProgress: progress, selectedCount: 1 },
      { isFollowJobRunning: false, followProgress: progress, selectedCount: 0 },
      { isFollowJobRunning: true, followProgress: null, selectedCount: 0 },
    ]
    for (const props of cases) {
      render(<FollowProgressLine {...props} />)
      expect(line()).toBeNull()
      cleanup()
    }
  })
})

describe("DiscoverReportBody", () => {
  const emptyState = resolveDiscoveryEmptyState("no_matching_candidates")
  const body = (
    over: Partial<React.ComponentProps<typeof DiscoverReportBody>> = {},
  ) =>
    render(
      <DiscoverReportBody
        isLoadingReport={false}
        hasReport
        candidateCount={2}
        emptyState={null}
        onQuickAction={() => {}}
        table={<div data-testid="table" />}
        {...over}
      />,
    )

  test("loading wins over everything", () => {
    body({ isLoadingReport: true, hasReport: false })
    expect(screen.getByText("Loading report…")).toBeTruthy()
    expect(screen.queryByTestId("table")).toBeNull()
  })

  test("an empty result is explained, and its quick actions run", () => {
    const onQuickAction = mock()
    body({ candidateCount: 0, emptyState, onQuickAction })
    expect(screen.getByTestId("discover-empty-state")).toBeTruthy()
    expect(screen.queryByTestId("table")).toBeNull()
    const [first] = emptyState?.quickActions ?? []
    fireEvent.click(screen.getByText(first.label))
    expect(onQuickAction).toHaveBeenCalledWith(first.action)
  })

  test("rows, or no explanation for their absence, show the table", () => {
    body({ emptyState })
    expect(screen.getByTestId("table")).toBeTruthy()
    cleanup()
    body({ candidateCount: 0 })
    expect(screen.getByTestId("table")).toBeTruthy()
  })
})
