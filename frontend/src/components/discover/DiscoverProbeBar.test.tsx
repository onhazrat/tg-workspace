import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { DiscoverProbeQueue } from "@/api"
import { DiscoverProbeBar } from "./DiscoverProbeBar"

const queue = (over: Partial<DiscoverProbeQueue> = {}): DiscoverProbeQueue => ({
  queued: 0,
  retrying: 0,
  resolved: 0,
  unavailable: 0,
  enabled: true,
  running: false,
  requestsToday: 0,
  requestsWeek: 0,
  harvestEnabled: false,
  harvestRunning: false,
  ...over,
})

const render = (over: Partial<DiscoverProbeQueue>, canManageJobs: boolean) =>
  renderToStaticMarkup(
    <DiscoverProbeBar
      queue={queue(over)}
      canManageJobs={canManageJobs}
      onSetPaused={() => {}}
      isPausePending={false}
    />,
  )

/** Counts render through `toLocaleString`, so the separator is the runtime's. */
const shown = (n: number) => n.toLocaleString()

/**
 * Two readers, and the bar is a different thing to each (ticket 04).
 *
 * To an ordinary account it reports work in flight, which is all it has ever
 * been. To an Operator it is also a spend meter, and a budget total is most
 * worth reading when nothing is running — so for that reader the bar outlives
 * the drain that used to be its only reason to exist.
 */
describe("DiscoverProbeBar", () => {
  describe("an account that may manage jobs", () => {
    test("shows the spend while the queue is idle", () => {
      const html = render({ requestsToday: 412, requestsWeek: 2610 }, true)
      expect(html).toContain(shown(412))
      expect(html).toContain(shown(2610))
    })

    test("shows the harvest switch and whether a tick is in flight", () => {
      expect(
        render({ harvestEnabled: true, harvestRunning: true }, true),
      ).toContain("Harvest running")
      expect(render({ harvestEnabled: true }, true)).toContain("Harvest idle")
      expect(render({ harvestEnabled: false }, true)).toContain("Harvest off")
    })

    test("offers the pause control on an idle queue", () => {
      // Otherwise pausing the lane and letting it drain leaves no way to resume
      // it, because the control used to need something still queued.
      expect(render({}, true)).toContain("discover-probe-pause")
    })

    test("still reports progress while the queue drains", () => {
      expect(render({ queued: 7 }, true)).toContain("7 left")
    })
  })

  describe("an account that may not", () => {
    test("sees nothing at all while the queue is idle", () => {
      expect(render({ requestsToday: 412, harvestRunning: true }, false)).toBe(
        "",
      )
    })

    test("sees progress while the queue drains, exactly as before", () => {
      expect(render({ queued: 7 }, false)).toContain("7 left")
    })

    test("never sees the spend, even mid-drain", () => {
      const html = render(
        {
          queued: 7,
          requestsToday: 412,
          requestsWeek: 2610,
          harvestEnabled: true,
        },
        false,
      )
      expect(html).not.toContain(shown(412))
      expect(html).not.toContain(shown(2610))
      expect(html).not.toContain("Harvest")
    })

    test("is not shown a pause button the server answers 403 to", () => {
      // Predates the ticket: the toggle behind this control requires
      // `jobs:manage`, and the bar's usual absence is why nobody hit it.
      expect(render({ queued: 7 }, false)).not.toContain("discover-probe-pause")
    })

    test("still sees a retry warning with nothing else outstanding", () => {
      expect(render({ retrying: 3 }, false)).toContain("3 failing")
    })
  })
})
