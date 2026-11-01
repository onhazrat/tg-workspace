/**
 * Where a Cut short Summary's text stops (SFR-03): a visible mark with Retry,
 * or the running retry in its place.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { SummaryAttemptResponse } from "@/client"
import { CutShortMark, CutShortRetry } from "./CutShortMark"

afterEach(cleanup)

describe("CutShortMark", () => {
  test("says the text stops here and offers a retry", () => {
    const onRetry = mock()
    render(<CutShortMark onRetry={onRetry} running={null} />)
    expect(screen.getByTestId("cut-short-mark").textContent).toContain(
      "The text stops here",
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalled()
  })

  test("shows the running retry instead of the button", () => {
    render(<CutShortMark onRetry={mock()} running={<p>running</p>} />)
    expect(screen.getByText("running")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })
})

describe("CutShortRetry", () => {
  const running: SummaryAttemptResponse = {
    id: "a2",
    summaryId: "s1",
    attempt: 2,
    outcome: "running",
    kind: null,
    error: null,
    model: "gemini-x",
    keyId: "k1",
    partialText: null,
    partialDismissedAt: null,
    automatic: false,
    scheduled: false,
    startedAt: 1,
    endedAt: null,
  }

  test("no retry running: the mark's own Retry", () => {
    const onRetry = mock()
    render(
      <CutShortRetry
        attempt={undefined}
        text=""
        keyLabel={() => undefined}
        onRetry={onRetry}
        onStop={mock()}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalled()
  })

  test("a running retry streams in its place, and Stop names it", () => {
    const onStop = mock()
    render(
      <CutShortRetry
        attempt={running}
        text="So far"
        keyLabel={(id) => (id === "k1" ? "Work key" : undefined)}
        onRetry={mock()}
        onStop={onStop}
      />,
    )
    const card = screen.getByTestId("running-attempt").textContent ?? ""
    expect(card).toContain("So far")
    expect(card).toContain("Work key")
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(onStop).toHaveBeenCalledWith("a2")
  })
})
