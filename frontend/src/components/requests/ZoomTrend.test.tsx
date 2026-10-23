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
} from "@testing-library/react"
import Plotly from "plotly.js-dist-min"
import type { RequestTrendResponse } from "@/client"
import ZoomTrend, { relayoutRange } from "./ZoomTrend"

afterEach(cleanup)

const at = (iso: string) => Date.parse(`${iso}Z`)
const fine = (start: string, end: string, useful: number) => ({
  start,
  end,
  kind: "auto",
  charged: true,
  useful,
  idle: 0,
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
  ],
}

type Graph = HTMLElement & { data: { x: string[]; y: number[] }[] }

async function drawn(onRange = mock()) {
  render(
    <ZoomTrend
      trend={TREND}
      range={{ start: at("2026-10-20T00:00"), end: at("2026-10-22T00:00") }}
      hiddenKinds={new Set()}
      hiddenOutcomes={new Set()}
      onRange={onRange}
    />,
  )
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
