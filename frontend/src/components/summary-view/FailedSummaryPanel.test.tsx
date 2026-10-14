/**
 * The failure page of a Failed Summary (SFR-01), from props. What is pinned:
 * the latest error leads with its attempt, model and Key; earlier ones wait in
 * a closed fold; the chip counts failures; and "Use another AI" exists only
 * when there is a prompt to hand over.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { SummaryAttemptResponse } from "@/client"
import type { Summary } from "@/types"
import { FailedSummaryPanel } from "./FailedSummaryPanel"

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
) {
  const onPaste = mock()
  render(
    <FailedSummaryPanel
      summary={summary}
      promptText={prompt ?? undefined}
      attempts={attempts}
      zone={{ timeZone: "UTC", locale: "en-US" }}
      keyLabel={(id) => (id === "k1" ? "Work key" : undefined)}
      onPaste={onPaste}
    />,
  )
  return { onPaste }
}

describe("FailedSummaryPanel", () => {
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

  test("Use another AI copies the prompt and opens the paste", () => {
    const { onPaste } = renderPanel([attempt(1)])
    expect(screen.getByText("Use another AI")).toBeTruthy()
    expect(screen.getByLabelText("Copy prompt")).toBeTruthy()
    fireEvent.click(screen.getByText("Paste response"))
    expect(onPaste).toHaveBeenCalled()
  })

  test("no prompt yet: nothing to copy, no Use another AI", () => {
    renderPanel([attempt(1, { kind: "limit", keyId: null })], null)
    expect(screen.queryByText("Use another AI")).toBeNull()
    expect(screen.queryByLabelText("Copy prompt")).toBeNull()
    expect(screen.getByRole("alert").textContent).toContain("no AI Key charged")
  })

  test("before the Attempts load it still says it failed", () => {
    renderPanel([])
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
