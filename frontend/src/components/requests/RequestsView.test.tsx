/**
 * The Requests tab's view (RQS-03), props only, held in a harness that keeps
 * the tab-wide filter the way `RequestsTab` does.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { useState } from "react"
import type { RequestBreakdownResponse } from "@/client"
import {
  initialRequestsFilter,
  type RequestsFilter,
  updated,
} from "@/lib/requests/breakdown"
import { RequestsView } from "./RequestsView"

afterEach(cleanup)

const part = (kind: string, useful: number, idle: number, wasted: number) => ({
  kind,
  requests: useful + idle + wasted,
  useful,
  idle,
  wasted,
  charged: kind === "probe" ? 0 : useful + idle + wasted,
  newPosts: 0,
  repeatedPosts: 0,
  syncs: 0,
  failedSyncs: 0,
})

const BREAKDOWN: RequestBreakdownResponse = {
  start: "2026-10-01T00:00:00",
  end: "2026-10-02T00:00:00",
  byKind: [part("auto", 60, 30, 10), part("probe", 100, 200, 600)],
  byChannel: [
    { ...part("auto", 60, 30, 10), channel: "news" },
    { ...part("bulk", 0, 0, 0), channel: "news" },
    { ...part("bulk", 5, 0, 0), channel: "tech" },
    { ...part("probe", 100, 200, 600), channel: null },
  ],
  byAccount: [
    { ...part("auto", 40, 20, 0), accountId: "a", email: "ann@example.com" },
    { ...part("auto", 20, 10, 10), accountId: "b", email: "bob@example.com" },
  ],
}

const RANGE = {
  start: Date.parse("2026-10-01T06:30:00Z"),
  end: Date.parse("2026-10-02T00:00:00Z"),
}

function Harness(
  props: Partial<Parameters<typeof RequestsView>[0]> & {
    seen?: RequestsFilter[]
  },
) {
  const [filter, setFilter] = useState(initialRequestsFilter)
  return (
    <RequestsView
      filter={filter}
      onFilter={(update) => {
        const next = updated(filter, update)
        props.seen?.push(next)
        setFilter(next)
      }}
      range={RANGE}
      unfiltered={BREAKDOWN}
      breakdown={BREAKDOWN}
      onOpenRow={() => {}}
      {...props}
    />
  )
}

const kindRow = (label: string) =>
  screen
    .getByRole("checkbox", { name: `Show ${label}` })
    .closest("tr") as HTMLElement
const cells = (tr: HTMLElement) =>
  [...tr.querySelectorAll("td")].map((td) => td.textContent)
const chip = (name: string) =>
  within(screen.getByRole("region", { name: "By kind of work" })).getByRole(
    "button",
    { name },
  )
const channelHeaders = () =>
  within(screen.getByRole("region", { name: "Channels by Requests" }))
    .getAllByRole("columnheader")
    .map((th) => th.textContent)

describe("RequestsView", () => {
  test("the footer gives the total and the range in UTC, to the minute when cut", () => {
    render(<Harness />)
    expect(screen.getByTestId("requests-total").textContent).toBe(
      "1,000 Requests",
    )
    expect(screen.getByTestId("requests-range").textContent).toBe(
      "from 2026-10-01 06:30 to 2026-10-02 00:00 (UTC)",
    )
  })

  test("the choice counts All, Charged and Uncharged, and picking one is kept", () => {
    const seen: RequestsFilter[] = []
    render(<Harness seen={seen} />)
    const charged = screen.getByTestId("requests-charged-charged")
    expect(charged.textContent).toBe("Charged100")
    expect(screen.getByTestId("requests-charged-uncharged").textContent).toBe(
      "Uncharged900",
    )
    fireEvent.click(charged)
    expect(seen.at(-1)?.charged).toBe("charged")
  })

  test("the stat strip splits the Requests by outcome", () => {
    render(<Harness />)
    expect(screen.getByTestId("requests-stat-wasted").textContent).toBe(
      "Wasted61061% of all",
    )
  })

  test("a kind's Show box hides it from every share, and marks it uncharged", () => {
    render(<Harness />)
    expect(cells(kindRow("Directory probe"))).toContain("90%")
    expect(kindRow("Directory probe").textContent).toContain("uncharged")
    expect(kindRow("Auto sync").textContent).not.toContain("uncharged")
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show Directory probe" }),
    )
    expect(cells(kindRow("Auto sync"))).toContain("100%")
    expect(cells(kindRow("Directory probe"))).toContain("–")
    expect(
      screen.queryByText("Directory probes", { selector: "span" }),
    ).toBeNull()
  })

  test("an outcome chip hides it on the whole tab, and the last one stays", () => {
    render(<Harness />)
    fireEvent.click(chip("Idle"))
    expect(cells(kindRow("Auto sync"))).toEqual([
      "",
      "Auto sync",
      "70",
      "9.1%",
      "",
      "–",
      "14%",
    ])
    expect(channelHeaders()).not.toContain("Idle")
    fireEvent.click(chip("Wasted"))
    const useful = chip("Useful")
    expect(useful.hasAttribute("disabled")).toBe(true)
  })

  test("the Accounts facet counts each one's charged Requests, and picking two compares them", () => {
    const seen: RequestsFilter[] = []
    render(<Harness seen={seen} />)
    expect(screen.queryByTestId("requests-uncharged-hidden")).toBeNull()
    fireEvent.click(screen.getByTestId("requests-accounts"))
    expect(screen.getByTestId("requests-accounts-count-b").textContent).toBe(
      "40",
    )
    fireEvent.click(screen.getByTestId("requests-accounts-funnel-a"))
    expect(seen.at(-1)?.accounts).toEqual(["a"])
    expect(screen.getByTestId("requests-uncharged-hidden").textContent).toBe(
      "Uncharged hidden, because no Account pays for it",
    )
    // One Account narrows the tab; there is nothing to compare it with.
    expect(screen.queryByRole("region", { name: /Comparing/ })).toBeNull()
    fireEvent.click(screen.getByTestId("requests-accounts-funnel-b"))
    expect(seen.at(-1)?.accounts).toEqual(["a", "b"])
    expect(
      screen.getByRole("region", { name: "Comparing 2 Accounts" }),
    ).toBeTruthy()
  })

  test("clicking a kind narrows the Channel table to that work, and again undoes it", () => {
    render(<Harness />)
    const channels = () =>
      within(screen.getByRole("region", { name: "Channels by Requests" }))
        .getAllByTestId("requests-channel-row")
        .map((tr) => tr.querySelectorAll("td")[2].textContent)
    expect(channels()).toEqual(["Directory probes", "@news", "@tech"])
    fireEvent.click(kindRow("Auto sync"))
    expect(channels()).toEqual(["@news"])
    expect(kindRow("Auto sync").dataset.picked).toBe("true")
    fireEvent.click(kindRow("Auto sync"))
    expect(channels()).toHaveLength(3)
  })

  test("a Channel left out leaves the tab; the footer counts it and Pick all brings it back", () => {
    const seen: RequestsFilter[] = []
    render(<Harness seen={seen} />)
    expect(screen.queryByTestId("requests-left-out")).toBeNull()
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick @news" }))
    expect([...(seen.at(-1)?.leftOut ?? [])]).toEqual(["news"])
    expect(screen.getByTestId("requests-left-out").textContent).toBe(
      "1 Channel left out Pick all",
    )
    fireEvent.click(screen.getByRole("button", { name: "Pick all" }))
    expect(seen.at(-1)?.leftOut.size).toBe(0)
    expect(screen.queryByTestId("requests-left-out")).toBeNull()
  })

  test("the Channel table lists the rows before the Channels left out leave", () => {
    const narrowed = {
      ...BREAKDOWN,
      byChannel: BREAKDOWN.byChannel.filter((c) => c.channel !== "tech"),
    }
    render(<Harness breakdown={narrowed} listed={BREAKDOWN} />)
    expect(screen.getByRole("checkbox", { name: "Pick @tech" })).toBeTruthy()
  })

  test("a failed read says so", () => {
    render(<Harness breakdown={undefined} error={new Error("boom")} />)
    expect(screen.getByRole("alert").textContent).toContain("boom")
  })
})
