/**
 * The daily bars' words (RQS-06). Recharts draws nothing in happy-dom, so the
 * bars and the click on a day are the Playwright journey's.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cleanup, render, screen } from "@testing-library/react"
import type { RequestTrendResponse } from "@/client"
import {
  type ChargedFilter,
  initialRequestsFilter,
} from "@/lib/requests/breakdown"
import { DailyBars } from "./DailyBars"

afterEach(cleanup)

const TREND: RequestTrendResponse = {
  start: "2026-09-01T00:00:00",
  end: "2026-09-03T00:00:00",
  hourlyDays: 45,
  buckets: [
    {
      start: "2026-09-01T00:00:00",
      end: "2026-09-02T00:00:00",
      kind: "auto",
      charged: true,
      useful: 4,
      idle: 2,
      wasted: 1,
      ledgerOnly: 0,
    },
  ],
}

const at = (iso: string) => Date.parse(`${iso}Z`)

function draw(range: { start: number; end: number }, charged: ChargedFilter) {
  render(
    <DailyBars
      trend={TREND}
      range={range}
      filter={{ ...initialRequestsFilter(), charged }}
      onDay={() => {}}
    />,
  )
}

describe("DailyBars", () => {
  test("a range of days is drawn by the day, Charged and Uncharged", () => {
    draw({ start: at("2026-09-01T00:00"), end: at("2026-09-03T00:00") }, "all")
    expect(screen.getByTestId("requests-daily-title").textContent).toBe(
      "Requests per day (UTC). Click a day to narrow everything to it.",
    )
    expect(screen.getByText("Charged")).toBeTruthy()
    expect(screen.getByText("Uncharged")).toBeTruthy()
    expect(screen.queryByTestId("requests-daily-only")).toBeNull()
  })

  test("Charged alone shows only its layer", () => {
    draw(
      { start: at("2026-09-01T00:00"), end: at("2026-09-03T00:00") },
      "charged",
    )
    expect(screen.getByText("Charged")).toBeTruthy()
    expect(screen.queryByText("Uncharged")).toBeNull()
  })

  test("a day past the hourly totals says it has its daily total only", () => {
    draw({ start: at("2026-09-01T00:00"), end: at("2026-09-02T00:00") }, "all")
    expect(screen.getByTestId("requests-daily-title").textContent).toBe(
      "Requests per hour on 2026-09-01 (UTC)",
    )
    expect(screen.getByTestId("requests-daily-only").textContent).toBe(
      "Hourly totals are kept for 45 days, so 2026-09-01 has its daily total only.",
    )
  })
})
