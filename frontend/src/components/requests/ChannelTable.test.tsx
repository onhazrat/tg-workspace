/** Channels by Requests (RQS-03): search, sorting, paging, hidden outcomes. */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ChannelRow, Outcome } from "@/lib/requests/breakdown"
import { ChannelTable } from "./ChannelTable"

afterEach(cleanup)

const row = (
  name: string,
  useful: number,
  idle: number,
  wasted: number,
  aggregate = false,
): ChannelRow => ({
  key: name,
  name,
  label: aggregate ? name : `@${name}`,
  aggregate,
  mainKind: aggregate ? "probe" : "auto",
  total: useful + idle + wasted,
  useful,
  idle,
  wasted,
})

const names = () =>
  screen
    .queryAllByTestId("requests-channel-row")
    .map((tr) => tr.querySelectorAll("td")[1].textContent)

const headers = () =>
  screen.getAllByRole("columnheader").map((th) => th.textContent)

describe("ChannelTable", () => {
  const rows = [
    row("Directory probes", 500, 100, 400, true),
    row("news", 10, 2, 9),
    row("tech", 1, 0, 0),
  ]

  test("ranks every row, the aggregate ones among the Channels", () => {
    render(<ChannelTable rows={rows} hiddenOutcomes={new Set()} />)
    expect(names()).toEqual(["Directory probes", "@news", "@tech"])
  })

  test("search narrows the rows, and says when nothing matches", () => {
    render(<ChannelTable rows={rows} hiddenOutcomes={new Set()} />)
    fireEvent.change(screen.getByLabelText("Search Channels"), {
      target: { value: "@te" },
    })
    expect(names()).toEqual(["@tech"])
    fireEvent.change(screen.getByLabelText("Search Channels"), {
      target: { value: "nothing" },
    })
    expect(screen.getByText("No Channel matches.")).toBeTruthy()
  })

  test("a header click sorts by it, and a second click turns it round", () => {
    render(<ChannelTable rows={rows} hiddenOutcomes={new Set()} />)
    fireEvent.click(screen.getByRole("button", { name: "Wasted %" }))
    expect(names()).toEqual(["@news", "Directory probes", "@tech"])
    fireEvent.click(screen.getByRole("button", { name: /Wasted %/ }))
    expect(names()).toEqual(["@tech", "Directory probes", "@news"])
    fireEvent.click(screen.getByRole("button", { name: "Channel" }))
    expect(names()).toEqual(["Directory probes", "@news", "@tech"])
  })

  test("a hidden outcome's columns go, and its sort falls back to Requests", () => {
    const { rerender } = render(
      <ChannelTable rows={rows} hiddenOutcomes={new Set()} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Idle" }))
    fireEvent.click(screen.getByRole("button", { name: "Idle ↓" }))
    expect(names()[0]).toBe("@tech")
    rerender(
      <ChannelTable rows={rows} hiddenOutcomes={new Set<Outcome>(["idle"])} />,
    )
    expect(headers()).not.toContain("Idle")
    expect(headers()).not.toContain("Idle %")
    expect(headers()).toContain("Wasted %")
    expect(names()[0]).toBe("Directory probes")
  })

  test("shows 25 rows, then 50 more at a time", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      row(`c${i}`, 100 - i, 0, 0),
    )
    render(<ChannelTable rows={many} hiddenOutcomes={new Set()} />)
    expect(names()).toHaveLength(25)
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }))
    expect(names()).toHaveLength(75)
    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }))
    expect(names()).toHaveLength(80)
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull()
  })

  test("an empty range says so", () => {
    render(<ChannelTable rows={[]} hiddenOutcomes={new Set()} />)
    expect(screen.getByText("No Requests in this range.")).toBeTruthy()
  })
})
