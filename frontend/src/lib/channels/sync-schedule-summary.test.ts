import { describe, expect, it } from "bun:test"
import { syncScheduleDetail } from "./sync-schedule-summary"

const HOUR = 60 * 60 * 1000

// The card face's relative schedule lines are tested through the face, in
// `components/channel-card/ChannelCardLastSync.test.tsx`.
describe("syncScheduleDetail", () => {
  it("keeps absolute timestamps for the hint, which has room", () => {
    const at = Date.now() + 3 * HOUR
    const detail = syncScheduleDetail({
      regularSyncEnabled: true,
      nextRegularSyncAt: at,
      dynamicSyncEnabled: false,
    })
    expect(detail).toBe(
      `Regular ${new Date(at).toLocaleString()} · Dynamic off`,
    )
  })

  it("distinguishes off from not scheduled", () => {
    expect(
      syncScheduleDetail({
        regularSyncEnabled: false,
        dynamicSyncEnabled: true,
        nextDynamicSyncAt: null,
      }),
    ).toBe("Regular off · Dynamic not scheduled")
  })
})
