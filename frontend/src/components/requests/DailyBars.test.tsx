/**
 * The daily bars (RQS-06), drawn by Plotly in happy-dom. A click on a day is
 * made the way Plotly reports one: a `plotly_click` on its graph.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { RequestTrendResponse } from "@/client"
import {
  initialRequestsFilter,
  type RequestsFilter,
} from "@/lib/requests/breakdown"
import DailyBars from "./DailyBars"

afterEach(cleanup)

const bucket = (start: string, end: string, charged: boolean, n: number) => ({
  start,
  end,
  kind: charged ? "auto" : "probe",
  charged,
  useful: n,
  idle: 0,
  wasted: 0,
  ledgerOnly: 0,
})

const TREND: RequestTrendResponse = {
  start: "2026-09-01T00:00:00",
  end: "2026-09-04T00:00:00",
  hourlyDays: 45,
  buckets: [
    {
      ...bucket("2026-09-01T00:00:00", "2026-09-02T00:00:00", true, 0),
      ledgerOnly: 9,
    },
    bucket("2026-09-02T00:00:00", "2026-09-03T00:00:00", true, 4),
    bucket("2026-09-02T06:00:00", "2026-09-02T07:00:00", false, 2),
  ],
}

const at = (iso: string) => Date.parse(`${iso}Z`)
const DAYS = { start: at("2026-09-01T00:00"), end: at("2026-09-04T00:00") }

type Graph = HTMLElement & {
  data: {
    name: string
    x: string[]
    y: number[]
    marker: { pattern?: object }
  }[]
  emit: (event: string, data: unknown) => void
}

async function draw(
  range: { start: number; end: number },
  filter: Partial<RequestsFilter> = {},
  onDay = mock(),
) {
  render(
    <DailyBars
      trend={TREND}
      range={range}
      filter={{ ...initialRequestsFilter(), ...filter }}
      onDay={onDay}
    />,
  )
  const section = screen.getByTestId("requests-daily-bars")
  await waitFor(() => {
    if (!section.querySelector(".js-plotly-plot .main-svg"))
      throw new Error("not drawn yet")
  })
  return { graph: section.querySelector(".js-plotly-plot") as Graph, onDay }
}

describe("DailyBars", () => {
  test("a range of days is stacked by the day: Charged, Uncharged, and the ledger's days hatched", async () => {
    const { graph } = await draw(DAYS)
    expect(screen.getByTestId("requests-daily-title").textContent).toBe(
      "Requests per day (UTC). Click a day to narrow everything to it.",
    )
    // Each layer draws only the days it has.
    expect(graph.data.map((t) => [t.name, t.x, t.y])).toEqual([
      ["Charged", ["2026-09-02"], [4]],
      ["Uncharged", ["2026-09-02"], [2]],
      ["Before recording", ["2026-09-01"], [9]],
    ])
    expect(graph.data[2].marker.pattern).toBeTruthy()
    expect(screen.getByText("Before recording")).toBeTruthy()
  })

  test("a click on a day narrows to it", async () => {
    const { graph, onDay } = await draw(DAYS)
    graph.emit("plotly_click", { points: [{ x: "2026-09-02" }] })
    expect(onDay).toHaveBeenCalledWith(at("2026-09-02T00:00"))
  })

  test("Charged alone shows only its layer, and a hidden kind adds nothing", async () => {
    const { graph } = await draw(DAYS, {
      charged: "charged",
      hiddenKinds: new Set(["auto"]),
    })
    expect(graph.data.map((t) => t.name)).toEqual(["Charged"])
    expect(graph.data[0].y).toEqual([])
    expect(screen.queryByText("Uncharged")).toBeNull()
  })

  test("one day is drawn by the hour, and a click there narrows nothing", async () => {
    const day = { start: at("2026-09-02T00:00"), end: at("2026-09-03T00:00") }
    // Its daily total hidden with its kind, so only the probes' hour is left.
    const { graph, onDay } = await draw(day, { hiddenKinds: new Set(["auto"]) })
    expect(screen.getByTestId("requests-daily-title").textContent).toBe(
      "Requests per hour on 2026-09-02 (UTC)",
    )
    expect([graph.data[1].x, graph.data[1].y]).toEqual([["06:00"], [2]])
    graph.emit("plotly_click", { points: [{ x: "06:00" }] })
    expect(onDay).not.toHaveBeenCalled()
  })

  test("a day past the hourly totals says it has its daily total only", () => {
    render(
      <DailyBars
        trend={TREND}
        range={{ start: at("2026-09-01T00:00"), end: at("2026-09-02T00:00") }}
        filter={initialRequestsFilter()}
        onDay={() => {}}
      />,
    )
    expect(screen.getByTestId("requests-daily-only").textContent).toBe(
      "Hourly totals are kept for 45 days, so 2026-09-01 has its daily total only.",
    )
  })
})
