/**
 * The failure page of a Failed Summary (SFR-01), from props. What is pinned:
 * the latest error leads with its attempt, model and Key; earlier ones wait in
 * a closed fold; the chip counts failures; and "Use another AI" exists only
 * when there is a prompt to hand over.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { ReactNode } from "react"

import type { SummaryAttemptResponse } from "@/client"
import type { Summary } from "@/types"
import { AttemptsFold, FailedSummaryPanel } from "./FailedSummaryPanel"

afterEach(cleanup)

const summary: Summary = {
  id: "s1",
  text: "",
  language: "English",
  model: "gemini-x",
  postCount: 12,
  timestamp: 0,
  status: "failed",
}

const attempt = (
  n: number,
  over: Partial<SummaryAttemptResponse> = {},
): SummaryAttemptResponse => ({
  id: `a${n}`,
  summaryId: "s1",
  attempt: n,
  outcome: "failed",
  kind: "quota",
  error: `error ${n}`,
  model: "gemini-x",
  keyId: "k1",
  partialText: null,
  partialDismissedAt: null,
  automatic: false,
  scheduled: false,
  startedAt: 1,
  endedAt: 2,
  ...over,
})

function renderPanel(
  attempts: SummaryAttemptResponse[],
  prompt: string | null = "the prompt",
  runningText = "",
  runWith?: ReactNode,
) {
  const onPaste = mock()
  const onRetry = mock()
  const onStop = mock()
  const onChangeSelection = mock()
  const onCancel = mock()
  const onKeep = mock()
  render(
    <FailedSummaryPanel
      summary={summary}
      promptText={prompt ?? undefined}
      attempts={attempts}
      zone={{ timeZone: "UTC", locale: "en-US" }}
      keyLabel={(id) => (id === "k1" ? "Work key" : undefined)}
      onPaste={onPaste}
      runningText={runningText}
      onRetry={onRetry}
      onStop={onStop}
      onCancel={onCancel}
      onKeep={onKeep}
      onDismiss={mock()}
      onRestore={mock()}
      onChangeSelection={onChangeSelection}
      runWith={runWith}
    />,
  )
  return { onPaste, onRetry, onStop, onChangeSelection, onCancel, onKeep }
}

describe("FailedSummaryPanel", () => {
  test("a queued automatic retry counts down with Cancel instead of Retry", () => {
    const { onCancel } = renderPanel([
      attempt(1, { kind: "transient", partialText: "Half of it" }),
      attempt(2, {
        outcome: "running",
        kind: null,
        error: null,
        automatic: true,
        startedAt: Date.now() + 10_000,
        endedAt: null,
      }),
    ])
    expect(screen.getByTestId("retry-countdown")).toBeTruthy()
    expect(screen.queryByTestId("try-again")).toBeNull()
    expect(screen.queryByTestId("running-attempt")).toBeNull()
    expect(screen.getByTestId("partial-responses")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalledWith("a2")
  })

  test("one failure: the report header, a Failed chip, the error and its Key", () => {
    renderPanel([attempt(1)])
    expect(screen.getByText("Analysis Report")).toBeTruthy()
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain("error 1")
    expect(screen.getByRole("alert").textContent).toContain("Attempt 1")
    expect(screen.getByRole("alert").textContent).toContain("Work key")
    expect(screen.queryByText(/Earlier attempts/)).toBeNull()
  })

  test("several failures: Failed ×n, the newest leads, the rest are folded", () => {
    renderPanel([
      attempt(1),
      attempt(2, { outcome: "succeeded", kind: null, error: null }),
      attempt(3, { error: "error 3", keyId: null, automatic: true }),
    ])
    expect(screen.getByText("Failed ×2")).toBeTruthy()
    const alert = screen.getByRole("alert").textContent ?? ""
    expect(alert).toContain("error 3")
    expect(alert).toContain("Attempt 3")
    expect(alert).toContain("automatic")
    expect(screen.queryByText("error 1")).toBeNull()
    fireEvent.click(screen.getByText("Earlier attempts (1)"))
    expect(screen.getByText("error 1")).toBeTruthy()
  })

  test("Try again names the last Attempt's run, or hands it to the chips", () => {
    renderPanel([attempt(1)])
    expect(screen.getByTestId("try-again").textContent).toContain("Work key")
    cleanup()
    renderPanel([attempt(1)], "p", "", <span>THE CHIPS</span>)
    const card = screen.getByTestId("try-again").textContent ?? ""
    expect(card).toContain("THE CHIPS")
    expect(card).not.toContain("Work key")
  })

  test("Use another AI copies the prompt and opens the paste", () => {
    const { onPaste } = renderPanel([attempt(1)])
    expect(screen.getByText("Use another AI")).toBeTruthy()
    expect(screen.getByLabelText("Copy prompt")).toBeTruthy()
    fireEvent.click(screen.getByText("Paste response"))
    expect(onPaste).toHaveBeenCalled()
  })

  test("no prompt yet: nothing to copy, no Use another AI", () => {
    renderPanel([attempt(1, { kind: "transient", keyId: null })], null)
    expect(screen.queryByText("Use another AI")).toBeNull()
    expect(screen.queryByLabelText("Copy prompt")).toBeNull()
  })

  test("before the Attempts load it still says it failed", () => {
    renderPanel([])
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("Try again retries on the last Attempt's model and Key", () => {
    const { onRetry } = renderPanel([attempt(1)])
    const card = screen.getByTestId("try-again")
    expect(card.textContent).toContain("Attempt 2")
    expect(card.textContent).toContain("Work key")
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }))
    expect(onRetry).toHaveBeenCalled()
  })

  test("a token-limit refusal leads with Change selection and charged no Key", () => {
    const { onChangeSelection } = renderPanel(
      [attempt(1, { kind: "limit", keyId: null })],
      null,
    )
    expect(screen.queryByTestId("try-again")).toBeNull()
    expect(screen.queryByText("Use another AI")).toBeNull()
    expect(screen.getByTestId("change-selection-card").textContent).toContain(
      "No AI Key was charged",
    )
    fireEvent.click(screen.getByRole("button", { name: "Change selection" }))
    expect(onChangeSelection).toHaveBeenCalled()
  })

  test("a running Attempt streams its text with Stop, and no Retry", () => {
    const { onStop } = renderPanel(
      [attempt(1), attempt(2, { outcome: "running", kind: null, error: null })],
      "the prompt",
      "Half of the answer",
    )
    const card = screen.getByTestId("running-attempt")
    expect(card.textContent).toContain("Half of the answer")
    expect(card.textContent).toContain("Attempt 2")
    expect(screen.queryByTestId("try-again")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(onStop).toHaveBeenCalledWith("a2")
  })

  test("a first Attempt still running says Generating, not Failed", () => {
    renderPanel([attempt(1, { outcome: "running", kind: null, error: null })])
    expect(screen.getByText("Generating")).toBeTruthy()
    expect(screen.queryByText("Failed")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("AttemptsFold", () => {
  test("hidden for a Summary that worked first time", () => {
    const { container } = render(
      <AttemptsFold
        attempts={[attempt(1, { outcome: "succeeded", kind: null })]}
        keyLabel={() => undefined}
      />,
    )
    expect(container.textContent).toBe("")
  })

  test("closed until opened, newest first", () => {
    render(
      <AttemptsFold
        attempts={[
          attempt(1),
          attempt(2, { outcome: "succeeded", kind: null, error: null }),
        ]}
        keyLabel={() => undefined}
      />,
    )
    expect(screen.queryByText("error 1")).toBeNull()
    fireEvent.click(screen.getByText("Attempts (2)"))
    const items = screen.getAllByRole("listitem")
    expect(items[0].textContent).toContain("Attempt 2")
    expect(items[0].textContent).toContain("succeeded")
    expect(items[1].textContent).toContain("error 1")
  })
})
