/**
 * The zoomable trend (RQS-07), drawn by Plotly in happy-dom. A zoom is made
 * the way Plotly reports one: a relayout on its graph.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import Plotly from "plotly.js-dist-min"
import { useState } from "react"
import type { RequestTrendResponse } from "@/client"
import type { Hidden } from "@/lib/requests/zoom"
import ZoomTrend, { relayoutRange } from "./ZoomTrend"

afterEach(cleanup)

const at = (iso: string) => Date.parse(`${iso}Z`)
const fine = (start: string, end: string, useful: number, kind = "auto") => ({
  start,
  end,
  kind,
  charged: true,
  useful,
  idle: kind === "probe" ? 1 : 0,
  wasted: 0,
})

const TREND: RequestTrendResponse = {
  start: "2026-10-20T00:00:00",
  end: "2026-10-22T00:00:00",
  hourlyDays: 30,
  buckets: [
    fine("2026-10-20T10:00:00", "2026-10-20T10:05:00", 2),
    fine("2026-10-20T10:05:00", "2026-10-20T10:10:00", 3),
    fine("2026-10-21T10:00:00", "2026-10-21T10:05:00", 4),
    // Probes: one Useful, one Idle.
    fine("2026-10-21T10:00:00", "2026-10-21T10:05:00", 1, "probe"),
  ],
}

type Graph = HTMLElement & {
  data: {
    name: string
    x: string[]
    y: number[]
    visible?: boolean | "legendonly"
    customdata?: number[]
  }[]
  layout: Plotly.Layout & Record<string, unknown>
  emit: (event: string, data: unknown) => void
}

/** The trend, holding the hidden kinds and outcomes as the tab does. */
function Harness({
  trend,
  onRange,
}: {
  trend: RequestTrendResponse
  onRange: () => void
}) {
  const [hidden, setHidden] = useState<Hidden>({
    hiddenKinds: new Set(),
    hiddenOutcomes: new Set(),
  })
  return (
    <ZoomTrend
      trend={trend}
      range={{ start: at("2026-10-20T00:00"), end: at("2026-10-22T00:00") }}
      {...hidden}
      onHidden={(update) => setHidden((h) => ({ ...h, ...update(h) }))}
      onRange={onRange}
    />
  )
}

async function drawn(onRange = mock(), trend = TREND) {
  render(<Harness trend={trend} onRange={onRange} />)
  const section = screen.getByTestId("requests-zoom-trend")
  await waitFor(() => {
    if (!section.querySelector(".js-plotly-plot .main-svg"))
      throw new Error("not drawn yet")
  })
  return {
    section,
    graph: section.querySelector(".js-plotly-plot") as Graph,
    onRange,
  }
}

/** A zoom, as Plotly reports a drag or the range slider. */
const zoomTo = (graph: Graph, from: string, to: string) =>
  act(() =>
    Plotly.relayout(graph, {
      "xaxis.range": [from, to],
    } as Partial<Plotly.Layout>),
  )

describe("ZoomTrend", () => {
  test("re-buckets to the zoom, and the visible range becomes the tab's", async () => {
    const { graph, onRange } = await drawn()
    // Two days in view: 15-minute buckets, one per day with Requests.
    expect(graph.data[0].x).toEqual([
      "2026-10-20T10:00:00.000",
      "2026-10-21T10:00:00.000",
      "2026-10-21T10:15:00.000",
    ])
    expect(screen.queryByTestId("requests-use-visible")).toBeNull()
    await zoomTo(graph, "2026-10-20 09:00", "2026-10-20 11:59:30")
    // Three hours in view: each 5-minute bucket, as steps closed at the end.
    expect(graph.data[0].x).toEqual([
      "2026-10-20T10:00:00.000",
      "2026-10-20T10:05:00.000",
      "2026-10-21T10:00:00.000",
      "2026-10-21T10:05:00.000",
    ])
    fireEvent.click(screen.getByTestId("requests-use-visible"))
    expect(onRange).toHaveBeenCalledWith(
      at("2026-10-20T09:00"),
      at("2026-10-20T12:00"),
    )
  })

  test("full screen keeps the zoom, and Escape leaves it", async () => {
    const { section, graph } = await drawn()
    await zoomTo(graph, "2026-10-20 09:00", "2026-10-20 12:00")
    fireEvent.click(screen.getByLabelText("Trend full screen"))
    expect(section.className).toContain("fixed")
    expect(screen.getByTestId("requests-use-visible")).toBeTruthy()
    expect(section.querySelector(".js-plotly-plot")).toBe(graph)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(section.className).not.toContain("fixed")
    expect(screen.getByLabelText("Trend full screen")).toBeTruthy()
    expect(screen.getByTestId("requests-use-visible")).toBeTruthy()
  })

  const names = (graph: Graph) => graph.data.map((d) => d.name)
  const choose = (dim: string, split: string) =>
    fireEvent.click(
      within(
        screen.getByRole("group", { name: `${dim}s stacked or separate` }),
      ).getByRole("button", { name: split }),
    )

  test("the switches stack or separate kinds and outcomes, shaded when both", async () => {
    const { graph } = await drawn()
    // Both stacked: a series per kind and outcome, the legend listing kinds.
    expect(names(graph)).toEqual([
      "Auto sync",
      "Directory probe",
      "Directory probe",
    ])
    expect(graph.layout.showlegend).toBe(true)
    expect(screen.getByTestId("requests-shade-idle")).toBeTruthy()

    choose("kind", "Separate")
    await waitFor(() =>
      expect(names(graph)).toEqual(["Useful", "Useful", "Idle"]),
    )
    expect(graph.layout.yaxis2).toBeTruthy()
    const rowNames = (graph.layout.annotations ?? []).map((a) => a.text)
    expect(rowNames).toContain("Auto sync")
    expect(rowNames).toContain("Directory probe")

    fireEvent.click(screen.getByTestId("requests-split-outcome"))
    await waitFor(() =>
      expect(names(graph)).toEqual(["Auto sync", "Directory probe"]),
    )
    expect(graph.layout.showlegend).toBe(false)
    expect(screen.queryByTestId("requests-shade-idle")).toBeNull()

    fireEvent.click(screen.getByTestId("requests-split-outcome"))
    choose("outcome", "Separate")
    await waitFor(() =>
      expect(names(graph)).toEqual([
        "Auto sync · Useful",
        "Directory probe · Useful",
        "Directory probe · Idle",
      ]),
    )

    fireEvent.click(screen.getByTestId("requests-split-kind"))
    fireEvent.click(screen.getByTestId("requests-split-outcome"))
    await waitFor(() => expect(names(graph)).toEqual(["All Requests"]))
  })

  test("a legend click hides a kind, a double click shows it alone, a chip an outcome", async () => {
    const { graph } = await drawn()
    const legend = (event: string, curveNumber: number) =>
      act(() => graph.emit(event, { curveNumber, data: graph.data }))
    const visible = () => graph.data.map((d) => d.visible)

    await legend("plotly_legendclick", 1)
    await waitFor(() =>
      expect(visible()).toEqual([true, "legendonly", "legendonly"]),
    )
    // A double click fires two clicks first: they cancel out.
    await legend("plotly_legendclick", 1)
    await legend("plotly_legendclick", 1)
    await legend("plotly_legenddoubleclick", 1)
    await waitFor(() => expect(visible()).toEqual(["legendonly", true, true]))
    await legend("plotly_legenddoubleclick", 1)
    await waitFor(() => expect(visible()).toEqual([true, true, true]))

    // The trend's own chips: Idle leaves the chart, kinds still stacked.
    fireEvent.click(
      within(screen.getByTestId("requests-trend-chips")).getByRole("button", {
        name: "Idle",
      }),
    )
    await waitFor(() =>
      expect(names(graph)).toEqual(["Auto sync", "Directory probe"]),
    )
  })

  test("a burst caps its row's scale, with a notch giving its real rate", async () => {
    // Two hours of 5-minute buckets of 1, but 50 at 10:00.
    const buckets = Array.from({ length: 24 }, (_, i) => {
      const start = new Date(at("2026-10-20T09:00") + i * 300_000)
      return fine(
        start.toISOString().slice(0, 19),
        new Date(start.getTime() + 300_000).toISOString().slice(0, 19),
        i === 12 ? 50 : 1,
      )
    })
    const { graph } = await drawn(mock(), { ...TREND, buckets })
    // 15-minute buckets in view: 12 an hour, and 208 an hour at 10:00.
    const notch = graph.data.find((d) => d.name === "Above the scale")
    expect(notch?.x).toEqual(["2026-10-20T10:00:00.000"])
    expect(notch?.customdata).toEqual([208])
    const range = (graph.layout.yaxis as { range: number[] }).range
    expect(range[1]).toBeCloseTo(13.8)
    expect(notch?.y[0]).toBeCloseTo(13.8)
  })
})

describe("relayoutRange", () => {
  test("reads a zoom in either form, a reset, or nothing", () => {
    const range: [number, number] = [
      at("2026-10-20T09:00"),
      at("2026-10-20T12:00"),
    ]
    expect(
      relayoutRange({
        "xaxis.range": ["2026-10-20 09:00", "2026-10-20 12:00"],
      }),
    ).toEqual(range)
    expect(
      relayoutRange({
        "xaxis.range[0]": "2026-10-20 09:00",
        "xaxis.range[1]": "2026-10-20 12:00",
      }),
    ).toEqual(range)
    expect(relayoutRange({ "xaxis.autorange": true })).toBeNull()
    expect(relayoutRange({ dragmode: "pan" })).toBeUndefined()
  })
})
