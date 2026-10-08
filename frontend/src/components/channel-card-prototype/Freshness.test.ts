import { describe, expect, test } from "bun:test"
import type { Channel } from "@/types"
import { slots, when } from "./Freshness"

const HOUR = 3_600_000
const base = { id: "1", name: "c" } as Channel

describe("both schedules on a detailed card", () => {
  test("regular defaults on, dynamic defaults off", () => {
    const [regular, dynamic] = slots(base)
    expect([regular.state, dynamic.state]).toEqual(["unscheduled", "off"])
    expect([when(regular), when(dynamic)]).toEqual(["not scheduled", "off"])
  })

  test("a time in the future is upcoming and one in the past is due", () => {
    const [regular, dynamic] = slots({
      ...base,
      nextRegularSyncAt: Date.now() + 3 * HOUR + 60_000,
      dynamicSyncEnabled: true,
      nextDynamicSyncAt: Date.now() - 2 * HOUR - 60_000,
    })
    expect([regular.state, when(regular)]).toEqual(["upcoming", "in 3h"])
    expect([dynamic.state, when(dynamic)]).toEqual(["due", "due, 2h ago"])
  })

  test("a disabled schedule is off even with a time left over", () => {
    const [regular] = slots({
      ...base,
      regularSyncEnabled: false,
      nextRegularSyncAt: Date.now() + HOUR,
    })
    expect([regular.state, regular.at]).toEqual(["off", null])
  })
})
