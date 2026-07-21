import { describe, expect, test } from "bun:test"
import {
  isTickerRunning,
  notifyTick,
  subscribeToTick,
  tickerListenerCount,
} from "@/lib/shared-ticker"

describe("shared ticker", () => {
  test("many subscribers share one timer", () => {
    const unsubscribes = Array.from({ length: 500 }, () =>
      subscribeToTick(() => {}),
    )

    expect(tickerListenerCount()).toBe(500)
    expect(isTickerRunning()).toBe(true)

    for (const unsubscribe of unsubscribes) unsubscribe()
  })

  test("the timer stops once the last subscriber leaves", () => {
    const a = subscribeToTick(() => {})
    const b = subscribeToTick(() => {})
    expect(isTickerRunning()).toBe(true)

    a()
    expect(isTickerRunning()).toBe(true)

    b()
    expect(isTickerRunning()).toBe(false)
    expect(tickerListenerCount()).toBe(0)
  })

  test("unsubscribing twice is harmless", () => {
    const unsubscribe = subscribeToTick(() => {})
    unsubscribe()
    unsubscribe()
    expect(tickerListenerCount()).toBe(0)
  })

  test("every subscriber is notified on a tick", () => {
    let a = 0
    let b = 0
    const unsubA = subscribeToTick(() => {
      a++
    })
    const unsubB = subscribeToTick(() => {
      b++
    })

    notifyTick()
    expect(a).toBe(1)
    expect(b).toBe(1)

    unsubA()
    notifyTick()
    expect(a).toBe(1)
    expect(b).toBe(2)

    unsubB()
  })

  test("a subscriber that unsubscribes during a tick does not break the fan-out", () => {
    let second = 0
    let unsubSelf: (() => void) | undefined
    unsubSelf = subscribeToTick(() => {
      unsubSelf?.()
    })
    const unsubOther = subscribeToTick(() => {
      second++
    })

    notifyTick()
    expect(second).toBe(1)

    unsubOther()
  })
})
