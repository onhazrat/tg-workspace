/**
 * An Artifact's record on its page and in History (CW-02): "not checked",
 * the Left out line on a Complete window, and History's pill and its tone.
 * The Incomplete banner with "now" and Regenerate is the Playwright spec's.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"

import type { Completeness, FrozenScope } from "@/client"
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
    expect(screen.getByText(/Window not checked/)).toBeTruthy()
  })

  test("names what complete only left out, and nothing on a plain Complete window", () => {
    const { container, rerender } = render(
      <ArtifactWindowBanner
        scope={scope(record({ leftOut: ["x", "y", "z", "w"] }))}
        kind="tag"
      />,
    )
    expect(screen.getByTestId("window-left-out").textContent).toBe(
      "Complete window: 4 Incomplete Channels were left out (@x, @y, @z +1).",
    )
    rerender(
      <ArtifactWindowBanner
        scope={scope(record({ choice: "complete" }))}
        kind="tag"
      />,
    )
    expect(container.textContent).toBe("")
  })

  test("shows nothing without a Scope", () => {
    const { container } = render(
      <ArtifactWindowBanner scope={null} kind="chat" />,
    )
    expect(container.textContent).toBe("")
  })
})

describe("History's pill", () => {
  const mark = (fixable: boolean, incompleteCount = 2) => ({
    unprovenPosts: 6,
    unprovenFloor: false,
    fixable,
    incompleteCount,
  })

  test("says the Unproven Posts, amber when a sync could have helped", () => {
    render(<CompletenessPill mark={mark(true)} />)
    const pill = screen.getByTestId("completeness-pill")
    expect(pill.textContent).toBe("~6 Posts unproven")
    expect(pill.dataset.tone).toBe("amber")
  })

  test("is slate when no sync could have", () => {
    render(<CompletenessPill mark={mark(false)} />)
    expect(screen.getByTestId("completeness-pill").dataset.tone).toBe("slate")
  })

  test("is absent on a Complete or unchecked Artifact", () => {
    const { container } = render(
      <>
        <CompletenessPill mark={mark(true, 0)} />
        <CompletenessPill mark={null} />
      </>,
    )
    expect(container.textContent).toBe("")
  })
})
