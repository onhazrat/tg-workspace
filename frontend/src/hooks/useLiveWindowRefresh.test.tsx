/**
 * The other half of the Live timer (AW-04): a tick becomes a refresh.
 *
 * `ScopeContext` moves the window; this is what tells the Posts views to go and
 * look again. Two things about it are worth a test, because both were wrong in
 * an earlier draft: it must not fire on mount, and it must fire on *every*
 * subsequent tick rather than only the first.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, cleanup, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"

import { ScopeProvider } from "@/contexts/ScopeContext"
import { useLiveWindowRefresh } from "@/hooks/usePostsView"
import { MINUTE_MS } from "@/lib/analysis-window"

const NOW = Date.UTC(2026, 8, 11, 14, 30)

/** 120 ms short of the next boundary, so the tick arrives in test time. */
function nearBoundaryClock() {
  let now = NOW + MINUTE_MS - 120
  return {
    read: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))

function mount(clock: () => number, refresh: () => void) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ScopeProvider clock={clock}>{children}</ScopeProvider>
  )
  return renderHook(() => useLiveWindowRefresh(refresh), { wrapper })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe("a Live tick refreshes the Posts views", () => {
  test("mounting refreshes nothing", () => {
    const refresh = mock(() => {})
    mount(nearBoundaryClock().read, refresh)

    // The feed fetches itself when it mounts. Refreshing here would make every
    // visit to the tab cost two requests for the same rows.
    expect(refresh).not.toHaveBeenCalled()
  })

  test("a tick refreshes, and so does the one after it", async () => {
    const refresh = mock(() => {})
    const clock = nearBoundaryClock()
    mount(clock.read, refresh)

    // A whole minute on, so the clock is 120 ms short of a boundary again and
    // the tick after this one also lands inside the test.
    act(() => clock.advance(MINUTE_MS))

    // Two separate waits, because `act` holds every update inside it until it
    // resolves: a single long one would collapse ten ticks into one render and
    // the assertion below would pass on an effect that only ever fires once.
    await act(() => settle(250))
    expect(refresh).toHaveBeenCalledTimes(1)

    await act(() => settle(250))
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
