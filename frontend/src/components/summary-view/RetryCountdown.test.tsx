/**
 * The automatic retry's countdown (SFR-03): seconds until the worker starts
 * it, and Cancel, which withdraws it. Once it is due the running card shows.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { RetryCountdown } from "./RetryCountdown"

afterEach(cleanup)

describe("RetryCountdown", () => {
  test("counts down to the retry and cancels it", () => {
    const onCancel = mock()
    render(
      <RetryCountdown startsAt={Date.now() + 9_500} onCancel={onCancel}>
        <p>running</p>
      </RetryCountdown>,
    )
    expect(screen.getByTestId("retry-countdown").textContent).toContain(
      "Retrying automatically in 10s",
    )
    expect(screen.queryByText("running")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalled()
  })

  test("is the running Attempt once it is due", () => {
    render(
      <RetryCountdown startsAt={Date.now() - 1} onCancel={mock()}>
        <p>running</p>
      </RetryCountdown>,
    )
    expect(screen.queryByTestId("retry-countdown")).toBeNull()
    expect(screen.getByText("running")).toBeTruthy()
  })
})
