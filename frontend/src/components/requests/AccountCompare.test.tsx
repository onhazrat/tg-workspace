/** Two or more Accounts side by side (RQS-05), props only. */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen, within } from "@testing-library/react"
import type { AccountRow } from "@/lib/requests/breakdown"
import { AccountCompare } from "./AccountCompare"

afterEach(cleanup)

const account = (
  id: string,
  email: string,
  useful: number,
  idle: number,
  wasted: number,
): AccountRow => ({
  id,
  email,
  useful,
  idle,
  wasted,
  total: useful + idle + wasted,
  byKind: { auto: useful + idle, bulk: wasted },
})

const ROWS = [
  account("b", "bob@example.com", 60, 20, 20),
  account("a", "", 30, 0, 0),
]

const rows = () =>
  within(screen.getByRole("region", { name: "Comparing 2 Accounts" }))
    .getAllByRole("row")
    .slice(1)
const cells = (tr: HTMLElement) =>
  [...tr.querySelectorAll("td")].map((td) => td.textContent)
const headers = () =>
  screen.getAllByRole("columnheader").map((th) => th.textContent)

describe("AccountCompare", () => {
  test("each Account's Requests, share, charged kinds, Idle % and Wasted %", () => {
    render(
      <AccountCompare
        rows={ROWS}
        every={["a", "b"]}
        hiddenKinds={new Set()}
        hiddenOutcomes={new Set()}
      />,
    )
    expect(headers().slice(3, 8)).toEqual([
      "Auto sync",
      "Manual bulk",
      "Manual single",
      "Follow",
      "Other",
    ])
    const [bob, deleted] = rows()
    expect(cells(bob).slice(0, 5)).toEqual([
      "bob@example.com",
      "100",
      "77%",
      "80",
      "20",
    ])
    expect(cells(bob).slice(-3, -1)).toEqual(["20%", "20%"])
    expect(cells(deleted)[0]).toBe("Deleted Account")
    // Each wears its step of the ramp, by its place among every Account.
    const swatch = (tr: HTMLElement) =>
      (tr.querySelector("td span span") as HTMLElement).style.background
    expect(swatch(bob)).toBe("var(--account-2)")
    expect(swatch(deleted)).toBe("var(--account-1)")
  })

  test("a hidden kind loses its column, a hidden outcome its share", () => {
    render(
      <AccountCompare
        rows={ROWS}
        every={["a", "b"]}
        hiddenKinds={new Set(["bulk"])}
        hiddenOutcomes={new Set(["idle"])}
      />,
    )
    expect(headers()).not.toContain("Manual bulk")
    expect(cells(rows()[0]).slice(-3, -1)).toEqual(["–", "20%"])
  })
})
