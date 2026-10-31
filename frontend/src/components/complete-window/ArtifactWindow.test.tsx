/**
 * An Artifact's record on its page and in History (CW-02): "not checked", the
 * Complete line with or without its Left out, and History's pill, its tone
 * and its breakdown. The Incomplete banner with "now" and Regenerate is the
 * Playwright spec's.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { Completeness, CompletenessMark, FrozenScope } from "@/client"
import { ArtifactWindowBanner, CompletenessPill } from "./ArtifactWindow"

afterEach(cleanup)

const E = Date.UTC(2026, 9, 30, 9, 7)
const record = (over: Partial<Completeness> = {}): Completeness => ({
  choice: "complete_only",
  frozenAt: E,
  start: E - 3_600_000,
  end: E,
  channelCount: 2,
  heldPosts: 9,
  channels: [],
  leftOut: [],
  unprovenPosts: 0,
  unprovenFloor: false,
  fixable: false,
  incompleteCount: 0,
  counts: {},
  ...over,
})
const scope = (completeness: FrozenScope["completeness"]): FrozenScope => ({
  channels: ["a", "b"],
  start: E - 3_600_000,
  end: E,
  completeness,
})

describe("the Artifact's banner", () => {
  test("reads not checked for an Artifact made before the record", () => {
    render(<ArtifactWindowBanner scope={scope(null)} kind="summary" />)
    expect(screen.getByText("Window not checked")).toBeTruthy()
  })

  test("names what complete only left out", () => {
    render(
      <ArtifactWindowBanner
        scope={scope(record({ leftOut: ["x", "y", "z", "w"] }))}
        kind="tag"
      />,
    )
    expect(screen.getByTestId("window-left-out").textContent).toBe(
      "Complete window, with 4 Incomplete Channels left out (@x, @y, @z +1).",
    )
  })

  test("says a Complete window in its one line (story 49)", () => {
    render(
      <ArtifactWindowBanner
        scope={scope(record({ choice: "complete" }))}
        kind="tag"
      />,
    )
    expect(screen.getByTestId("window-banner").textContent).toContain(
      "Complete window: all 0 Channels proven through",
    )
  })

  test("shows nothing without a Scope", () => {
    const { container } = render(
      <ArtifactWindowBanner scope={null} kind="chat" />,
    )
    expect(container.textContent).toBe("")
  })
})

describe("History's pill", () => {
  const mark = (
    fixable: boolean,
    incompleteCount = 2,
    counts: CompletenessMark["counts"] = { skipped: 1, frozen: 1 },
  ): CompletenessMark => ({
    unprovenPosts: 6,
    unprovenFloor: false,
    fixable,
    incompleteCount,
    channelCount: 5,
    counts,
  })
  const pill = () => screen.getByTestId("completeness-pill")

  test("says the Unproven Posts, in amber when a sync could have helped", () => {
    render(<CompletenessPill scope={scope(mark(true))} />)
    expect(pill().textContent).toBe("~6 Posts unproven")
    expect(pill().className).toContain("bg-amber-500/10")
  })

  test("is slate when no sync could have", () => {
    render(<CompletenessPill scope={scope(mark(false))} />)
    expect(pill().className).toContain("bg-app-ink/5")
    expect(pill().className).not.toContain("amber")
  })

  test("opens its breakdown, the count of each reason", () => {
    render(<CompletenessPill scope={scope(mark(true))} />)
    fireEvent.click(pill())
    const breakdown = screen.getByTestId("completeness-breakdown")
    expect(breakdown.textContent).toContain("2 of 5 Channels Incomplete")
    const rows = [...breakdown.querySelectorAll("li")].map(
      (li) => li.textContent,
    )
    expect(rows).toEqual(["Skipped by you1", "Frozen1"])
  })

  test("says not checked, quietly, on an Artifact made before the record", () => {
    render(<CompletenessPill scope={scope(null)} />)
    expect(screen.getByText("Window not checked")).toBeTruthy()
  })

  test("is absent on a Complete Artifact or one without a Scope", () => {
    const { container } = render(
      <>
        <CompletenessPill scope={scope(mark(true, 0))} />
        <CompletenessPill scope={null} />
      </>,
    )
    expect(container.textContent).toBe("")
  })
})
