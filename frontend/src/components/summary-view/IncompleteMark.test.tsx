/**
 * Where an Incomplete Summary's text stops (SFR-03): a visible mark with Retry,
 * or the running retry in its place.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { IncompleteMark } from "./IncompleteMark"

afterEach(cleanup)

describe("IncompleteMark", () => {
  test("says the text stops here and offers a retry", () => {
    const onRetry = mock()
    render(<IncompleteMark onRetry={onRetry} running={null} />)
    expect(screen.getByTestId("incomplete-mark").textContent).toContain(
      "The text stops here",
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalled()
  })

  test("shows the running retry instead of the button", () => {
    render(<IncompleteMark onRetry={mock()} running={<p>running</p>} />)
    expect(screen.getByText("running")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
  })
})
