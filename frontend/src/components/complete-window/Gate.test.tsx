/**
 * The gate's Sync button (CW-02): it counts down to pressing itself, an edit
 * stops the count for good, and with nothing to sync it neither counts nor
 * presses. The gate's journey is the Playwright spec's.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"

import { SyncButton } from "./Gate"

afterEach(cleanup)

const label = () => screen.getByRole("button").textContent

describe("the gate's Sync button", () => {
  test("counts down while the review is untouched", () => {
    render(<SyncButton count={3} onSync={() => {}} stopped={false} />)
    expect(label()).toBe("Sync 3 · 30s")
  })

  test("an edit stops the count", () => {
    render(<SyncButton count={3} onSync={() => {}} stopped />)
    expect(label()).toBe("Sync 3")
  })

  test("with nothing to sync it is disabled and never counts", () => {
    render(<SyncButton count={0} onSync={() => {}} stopped={false} />)
    expect(label()).toBe("Sync 0")
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
