/**
 * The Request usage card's body. What is pinned: loading and failure say so
 * rather than drawing an empty table, an empty day names the day the server
 * answered for, and rows are sorted by total with a missing count read as zero.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"

import { QuotaUsageBody } from "./QuotaUsage"

afterEach(cleanup)

const body = (props: Partial<Parameters<typeof QuotaUsageBody>[0]>) =>
  render(
    <QuotaUsageBody
      isPending={false}
      isError={false}
      data={undefined}
      day="2026-09-01"
      {...props}
    />,
  )

describe("QuotaUsageBody", () => {
  test("loading draws skeletons and a failure says it could not load", () => {
    const { container } = body({ isPending: true })
    expect(container.querySelector("table")).toBeNull()
    expect(container.textContent).toBe("")
    cleanup()

    body({ isError: true })
    expect(screen.getByText("Usage could not be loaded.")).toBeTruthy()
  })

  test("an empty day names the server's day, else the requested one", () => {
    body({ data: { day: "2026-08-31" } })
    expect(
      screen.getByText("No Requests were made on 2026-08-31."),
    ).toBeTruthy()
    cleanup()

    body({ data: undefined })
    expect(
      screen.getByText("No Requests were made on 2026-09-01."),
    ).toBeTruthy()
  })

  test("rows sort by total and a missing count reads as zero", () => {
    body({
      data: {
        day: "2026-09-01",
        entries: [
          { userId: "a", email: "a@x", autoSync: 1, total: 1 },
          {
            userId: "b",
            email: "b@x",
            manualBulk: 4,
            manualSingle: 5,
            total: 9,
          },
          { userId: "c", email: "c@x" },
        ],
      },
    })
    const rows = [...document.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    )
    expect(rows).toEqual([
      ["b@x", "0", "4", "5", "9"],
      ["a@x", "1", "0", "0", "1"],
      ["c@x", "0", "0", "0", "0"],
    ])
  })
})
