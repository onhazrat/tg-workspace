import { describe, expect, test } from "bun:test"
import type React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { FollowJobStatus } from "@/api"
import { DiscoverBulkBar } from "./DiscoverBulkBar"

const noop = () => {}

const bulkBar = (over: Partial<React.ComponentProps<typeof DiscoverBulkBar>>) =>
  renderToStaticMarkup(
    <DiscoverBulkBar
      selectedCount={3}
      isOffline={false}
      isFollowJobRunning={false}
      followProgress={null}
      onFollowSelected={noop}
      onClearSelection={noop}
      onDismissSelected={noop}
      dismissMode="dismiss"
      isDismissPending={false}
      onRecheckSelected={noop}
      showRecheck={false}
      isRecheckPending={false}
      {...over}
    />,
  )

describe("DiscoverBulkBar", () => {
  test("offers follow and dismiss outside the Ignored view", () => {
    const html = bulkBar({})
    expect(html).toContain("3 selected")
    expect(html).toContain("discover-follow-selected")
    expect(html).toContain("Dismiss selected")
    expect(html).not.toContain("Restore selected")
  })

  test("offers only restore in the Ignored view", () => {
    // Following a dismissed row is contradictory, so Follow is withheld there.
    const html = bulkBar({ dismissMode: "restore" })
    expect(html).not.toContain("discover-follow-selected")
    expect(html).toContain("Restore selected")
  })

  test("offers recheck only where a verdict can be overturned", () => {
    expect(bulkBar({})).not.toContain("discover-recheck-selected")
    expect(bulkBar({ showRecheck: true })).toContain(
      "discover-recheck-selected",
    )
  })

  test("reports progress only while a job runs and has reported", () => {
    const progress = { completed: 2, total: 5 } as FollowJobStatus
    expect(bulkBar({ followProgress: progress })).not.toContain(
      "discover-follow-progress",
    )
    expect(bulkBar({ isFollowJobRunning: true })).not.toContain(
      "discover-follow-progress",
    )
    expect(
      bulkBar({ isFollowJobRunning: true, followProgress: progress }),
    ).toContain("2/5")
  })
})
