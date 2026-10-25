/**
 * Channels by Requests (RQS-03): search, sorting, paging, hidden outcomes;
 * and its filters, yield and pick boxes (RQS-04).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import type { ChannelRow, Outcome } from "@/lib/requests/breakdown"
import { emptyChannelFilter } from "@/lib/requests/channel-filter"
import { ChannelTable } from "./ChannelTable"

afterEach(cleanup)

const row = (
  name: string,
  useful: number,
  idle: number,
  wasted: number,
  aggregate = false,
  { syncs = 0, failed = 0, posts = 0 } = {},
): ChannelRow => {
  const mainKind = aggregate ? "probe" : "auto"
  const tally = {
    total: useful + idle + wasted,
    useful,
    idle,
    wasted,
    ledgerOnly: 0,
    syncs,
    failed,
    posts,
  }
  return {
    ...tally,
    id: aggregate ? `kind:${mainKind}` : name,
    key: aggregate ? mainKind : name,
    name,
    label: aggregate ? name : `@${name}`,
    aggregate,
    mainKind,
    kinds: new Set([mainKind]),
    perKind: new Map([[mainKind, tally]]),
  }
}

/** The table with its filter and pick boxes kept, as `RequestsView` keeps them. */
function Table({
  rows,
  hiddenOutcomes = new Set(),
  onLeftOut = () => {},
  onOpen = () => {},
}: {
  rows: ChannelRow[]
  hiddenOutcomes?: ReadonlySet<Outcome>
  onLeftOut?: (leftOut: Set<string>) => void
  onOpen?: (row: ChannelRow) => void
}) {
  const [filter, setFilter] = useState(emptyChannelFilter)
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set())
  return (
    <ChannelTable
      rows={rows}
      hiddenOutcomes={hiddenOutcomes}
      hiddenKinds={new Set()}
      filter={filter}
      onFilter={setFilter}
      leftOut={leftOut}
      onLeftOut={(next) => {
        onLeftOut(next)
        setLeftOut(next)
      }}
      onOpen={onOpen}
    />
  )
}

const names = () =>
  screen
    .queryAllByTestId("requests-channel-row")
    .map((tr) => tr.querySelectorAll("td")[2].textContent)

const headers = () =>
  screen.getAllByRole("columnheader").map((th) => th.textContent)

describe("ChannelTable", () => {
  const rows = [
    row("Directory probes", 500, 100, 400, true),
    row("news", 10, 2, 9),
    row("tech", 1, 0, 0),
  ]

  test("ranks every row, the aggregate ones among the Channels", () => {
    render(<Table rows={rows} />)
    expect(names()).toEqual(["Directory probes", "@news", "@tech"])
  })

  test("search narrows the rows, and says when nothing matches", () => {
    render(<Table rows={rows} />)
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
    render(<Table rows={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Wasted %" }))
    expect(names()).toEqual(["@news", "Directory probes", "@tech"])
    fireEvent.click(screen.getByRole("button", { name: /Wasted %/ }))
    expect(names()).toEqual(["@tech", "Directory probes", "@news"])
    fireEvent.click(screen.getByRole("button", { name: "Channel" }))
    expect(names()).toEqual(["Directory probes", "@news", "@tech"])
  })

  test("a hidden outcome's columns go, and its sort falls back to Requests", () => {
    const { rerender } = render(<Table rows={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Idle" }))
    fireEvent.click(screen.getByRole("button", { name: "Idle ↓" }))
    expect(names()[0]).toBe("@tech")
    rerender(<Table rows={rows} hiddenOutcomes={new Set<Outcome>(["idle"])} />)
    expect(headers()).not.toContain("Idle")
    expect(headers()).not.toContain("Idle %")
    expect(headers()).toContain("Wasted %")
    expect(names()[0]).toBe("Directory probes")
  })

  test("shows 25 rows, then 50 more at a time", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      row(`c${i}`, 100 - i, 0, 0),
    )
    render(<Table rows={many} />)
    expect(names()).toHaveLength(25)
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }))
    expect(names()).toHaveLength(75)
    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }))
    expect(names()).toHaveLength(80)
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull()
  })

  test("an empty range says so", () => {
    render(<Table rows={[]} />)
    expect(screen.getByText("No Requests in this range.")).toBeTruthy()
  })
})

describe("ChannelTable's filters, yield and picking (RQS-04)", () => {
  const rows = [
    row("Directory probes", 500, 100, 400, true),
    row("news", 10, 2, 8, false, { syncs: 10, failed: 3, posts: 60 }),
    row("tech", 1, 0, 0, false, { syncs: 1, posts: 0 }),
  ]
  const yieldOf = (name: string) => {
    const tr = screen
      .getAllByTestId("requests-channel-row")
      .find((r) => r.textContent?.includes(name)) as HTMLElement
    const cells = tr.querySelectorAll("td")
    return cells[cells.length - 2] as HTMLElement
  }

  test("New Posts / Req reads each Channel's yield; an aggregate row shows a dash", () => {
    render(<Table rows={rows} />)
    expect(yieldOf("@news").textContent).toBe("3.0")
    expect(yieldOf("@news").title).toBe("15% of a 20-Post page per Request")
    expect(yieldOf("@tech").textContent).toBe("0")
    expect(yieldOf("Directory probes").textContent).toBe("–")
  })

  test("sorting by yield puts the aggregate rows last either way", () => {
    render(<Table rows={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "New Posts / Req" }))
    expect(names()).toEqual(["@news", "@tech", "Directory probes"])
    fireEvent.click(screen.getByRole("button", { name: /New Posts \/ Req/ }))
    expect(names()).toEqual(["@tech", "@news", "Directory probes"])
  })

  test("Hide uncharged leaves out the aggregate rows, and says how many are left", () => {
    render(<Table rows={rows} />)
    fireEvent.click(screen.getByTestId("requests-switch-uncharged"))
    expect(names()).toEqual(["@news", "@tech"])
    expect(screen.getByText("Uncharged rows")).toBeTruthy()
  })

  test("a measure from the Filters menu bounds the rows", () => {
    render(<Table rows={rows} />)
    fireEvent.click(screen.getByTestId("requests-filters"))
    fireEvent.click(screen.getByTestId("requests-filters-row-failed"))
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "1" },
    })
    fireEvent.click(screen.getByTestId("number-bound-submit"))
    expect(names()).toEqual(["@news"])
  })

  test("a measure's editor offers no No value and refuses a negative field", () => {
    render(<Table rows={rows} />)
    fireEvent.click(screen.getByTestId("requests-filters"))
    fireEvent.click(screen.getByTestId("requests-filters-row-failed"))
    expect(screen.queryByRole("button", { name: "no value" })).toBeNull()
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "-1" },
    })
    expect(
      (screen.getByTestId("number-bound-submit") as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  test("a pick box leaves its row out, faded but listed; the header box picks every listed row", () => {
    const seen: Set<string>[] = []
    render(<Table rows={rows} onLeftOut={(next) => seen.push(next)} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick @news" }))
    expect([...(seen.at(-1) ?? [])]).toEqual(["news"])
    expect(names()).toContain("@news")
    const news = screen.getByRole("checkbox", { name: "Pick @news" })
    expect(news.closest("tr")?.className).toContain("opacity-40")
    const every = screen.getByRole("checkbox", {
      name: "Pick every listed row",
    }) as HTMLInputElement
    expect(every.indeterminate).toBe(true)
    fireEvent.click(every)
    expect(seen.at(-1)?.size).toBe(0)
    fireEvent.click(every)
    expect([...(seen.at(-1) ?? [])].sort()).toEqual([
      "kind:probe",
      "news",
      "tech",
    ])
  })

  test("a row click opens that row's Requests; its pick box does not (RQS-10)", () => {
    const opened: string[] = []
    render(<Table rows={rows} onOpen={(r) => opened.push(r.id)} />)
    const [probes, news] = screen.getAllByTestId("requests-channel-row")
    fireEvent.click(news.querySelectorAll("td")[2])
    fireEvent.click(probes)
    fireEvent.click(screen.getByLabelText("Pick @tech"))
    expect(opened).toEqual(["news", "kind:probe"])
  })
})
