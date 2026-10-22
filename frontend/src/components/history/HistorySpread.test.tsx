/**
 * The time filter's spread, drawn from the server's answer: its bars count
 * artifacts under Written and window starts under Window, and a bar sets a
 * Fixed bound over the minutes it holds.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ArtifactSpreadResponse } from "@/client"
import { queryKeys } from "@/hooks/queryKeys"
import {
  DEFAULT_HISTORY_PARAMS,
  type HistoryMoment,
} from "@/lib/history/history-params"
import { HistorySpread } from "./HistorySpread"

afterEach(cleanup)

const MINUTE = 60_000
/** 2021-01-01T00:00:00Z. */
const T0 = 1_609_459_200_000
const SPREAD: ArtifactSpreadResponse = {
  total: 64,
  min: T0,
  max: T0 + 32 * MINUTE,
  median: T0 + 16 * MINUTE,
  bins: Array.from({ length: 32 }, (_, i) => ({
    lo: T0 + i * MINUTE,
    hi: T0 + (i + 1) * MINUTE,
    count: 2,
  })),
}

/** The spread already answered, as `useArtifactSpread` keys it. */
function mount(moment: HistoryMoment) {
  const client = new QueryClient()
  const query = moment === "window" ? { moment } : {}
  client.setQueryData(queryKeys.artifacts("spread", query), SPREAD)
  const onPick = mock()
  render(
    <QueryClientProvider client={client}>
      <HistorySpread
        params={{ ...DEFAULT_HISTORY_PARAMS, moment }}
        onPick={onPick}
      />
    </QueryClientProvider>,
  )
  return onPick
}

const bar = (i: number) => screen.getByTestId(`directory-bound-bar-${i}`)

describe("HistorySpread", () => {
  test("its bars count artifacts under Written", () => {
    mount("written")
    expect(bar(0).title).toEndWith(": 2 artifacts")
  })

  test("and window starts under Window", () => {
    mount("window")
    expect(bar(0).title).toEndWith(": 2 window starts")
  })

  test("a bar sets a Fixed bound over the minutes it holds", () => {
    const onPick = mount("written")
    fireEvent.click(bar(3))
    expect(onPick).toHaveBeenCalledWith({
      mode: "fixed",
      start: T0 + 3 * MINUTE,
      end: T0 + 4 * MINUTE,
    })
  })
})
