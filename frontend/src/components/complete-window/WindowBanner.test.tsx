/**
 * The live check's banner (CW-01): the one line, Complete or not, dimmed
 * while it is for another selection, and Details with its toggling legend,
 * Visualize and Hide rows.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { Verdict, WindowCheck } from "@/lib/complete-window/window-check"
import { WindowBanner } from "./WindowBanner"

afterEach(cleanup)

const HOUR = 3_600_000
const E = Date.UTC(2026, 9, 30, 9, 7)

function verdict(name: string, over: Partial<Verdict> = {}): Verdict {
  return {
    name,
    reasons: [],
    reason: null,
    lastSync: E - HOUR,
    headReadAt: E - HOUR,
    error: null,
    stretches: [],
    missingIds: 0,
    syncable: true,
    behind: false,
    pacePerHour: 1,
    heldPosts: 10,
    unprovenPosts: 0,
    ...over,
  }
}

const check = (channels: Verdict[], unproven = 0): WindowCheck => ({
  frozenAt: E,
  start: E - 24 * HOUR,
  end: E,
  channels,
  heldPosts: 100,
  unprovenPosts: unproven,
  unprovenFloor: false,
})

const lag = verdict("lag", {
  reasons: ["end"],
  reason: "end",
  behind: true,
  stretches: [{ kind: "end", from: E - 2 * HOUR, to: E }],
  unprovenPosts: 2,
})
const frozen = verdict("cold", {
  reasons: ["failed", "end", "frozen"],
  reason: "failed",
  error: "proxy down",
  syncable: false,
  stretches: [{ kind: "end", from: E - 9 * HOUR, to: E }],
  unprovenPosts: 9,
})

describe("WindowBanner", () => {
  test("says Complete when nothing is missing", () => {
    render(<WindowBanner check={check([verdict("a"), verdict("b")])} />)
    expect(screen.getByTestId("window-banner").textContent).toMatch(
      /^Complete window: all 2 Channels proven through \d\d:\d\d [AP]M$/,
    )
  })

  test("says what is unproven in one line, with its action", () => {
    render(
      <WindowBanner
        check={check([verdict("ok"), lag, frozen], 11)}
        action={<button type="button">Sync 1</button>}
      />,
    )
    expect(screen.getByTestId("window-banner").textContent).toContain(
      "~11 Posts (10%) · 1 frozen · last 2 h on 1",
    )
    expect(screen.getByRole("button", { name: "Sync 1" })).toBeTruthy()
  })

  test("dims with Updating… while the line is for another selection", () => {
    render(<WindowBanner check={check([lag], 2)} updating />)
    expect(screen.getByText("Updating…")).toBeTruthy()
  })

  test("Details opens on what needs a look; the legend toggles rows", () => {
    render(<WindowBanner check={check([verdict("ok"), lag, frozen], 11)} />)
    fireEvent.click(screen.getByRole("button", { name: "Details" }))
    const rows = () =>
      screen.getAllByTestId("window-row").map((r) => r.textContent)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toContain("@cold")
    expect(screen.getByText("Sync failed").getAttribute("title")).toBe(
      "proxy down",
    )
    fireEvent.click(screen.getByRole("button", { name: /End gap, behind/ }))
    expect(rows()).toHaveLength(2)
    fireEvent.doubleClick(
      screen.getByRole("button", { name: /End gap, behind/ }),
    )
    expect(rows()).toEqual([expect.stringContaining("@lag")])
  })

  test("Visualize draws the timeline; Hide rows hides the rows", () => {
    render(<WindowBanner check={check([lag, frozen], 11)} />)
    fireEvent.click(screen.getByRole("button", { name: "Details" }))
    fireEvent.click(screen.getByRole("button", { name: "Visualize" }))
    expect(screen.getByTestId("window-timeline")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Hide rows" }))
    expect(screen.queryAllByTestId("window-row")).toHaveLength(0)
  })
})
