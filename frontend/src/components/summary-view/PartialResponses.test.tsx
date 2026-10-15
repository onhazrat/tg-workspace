/**
 * The Partial responses of a Failed Summary (SFR-03), from props. What is
 * pinned: newest first with attempt, model and length; a short preview that
 * Show all opens; Keep is the primary action on the newest only; a dismissed
 * one waits in a closed "Dismissed (n)" fold with Restore.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { SummaryAttemptResponse } from "@/client"
import { PartialResponses } from "./PartialResponses"

afterEach(cleanup)

const attempt = (
  n: number,
  over: Partial<SummaryAttemptResponse> = {},
): SummaryAttemptResponse => ({
  id: `a${n}`,
  summaryId: "s1",
  attempt: n,
  outcome: "failed",
  kind: "transient",
  error: "cut off",
  model: "gemini-x",
  keyId: null,
  partialText: `Draft ${n} text`,
  partialDismissedAt: null,
  automatic: false,
  scheduled: false,
  startedAt: 1,
  endedAt: 2,
  ...over,
})

function renderList(attempts: SummaryAttemptResponse[]) {
  const handlers = { onKeep: mock(), onDismiss: mock(), onRestore: mock() }
  render(
    <PartialResponses
      attempts={attempts}
      keyLabel={() => undefined}
      {...handlers}
    />,
  )
  return handlers
}

describe("PartialResponses", () => {
  test("shows nothing when no Attempt left any text", () => {
    renderList([attempt(1, { partialText: null })])
    expect(screen.queryByTestId("partial-responses")).toBeNull()
  })

  test("lists them newest first, keeping the newest as the primary action", () => {
    const { onKeep } = renderList([
      attempt(1),
      attempt(2, { outcome: "stopped" }),
    ])
    const items = screen.getAllByTestId("partial-response")
    expect(items[0]?.textContent).toContain("Attempt 2")
    expect(items[1]?.textContent).toContain("Attempt 1")
    expect(items[0]?.textContent).toContain("12 characters")
    const keeps = screen.getAllByRole("button", { name: "Keep this draft" })
    expect(keeps[0]?.dataset.primary).toBe("true")
    expect(keeps[1]?.dataset.primary).toBe("false")
    fireEvent.click(keeps[1] as HTMLElement)
    expect(onKeep).toHaveBeenCalledWith("a1")
  })

  test("previews a long draft and shows all of it on request", () => {
    const long = `${"word ".repeat(100)}END`
    renderList([attempt(1, { partialText: long })])
    expect(screen.queryByText(/END/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show all" }))
    expect(screen.getByText(/END/)).toBeTruthy()
  })

  test("dismisses into a closed fold that can restore it", () => {
    const { onDismiss, onRestore } = renderList([
      attempt(1, { partialDismissedAt: 5 }),
      attempt(2),
    ])
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(onDismiss).toHaveBeenCalledWith("a2")
    expect(screen.getAllByTestId("partial-response")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Dismissed (1)" }))
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    expect(onRestore).toHaveBeenCalledWith("a1")
  })
})
