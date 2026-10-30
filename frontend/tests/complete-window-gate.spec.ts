import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

/**
 * The gate and the Artifact's record (CW-02, ADR-043), driven through
 * Generate report, which spends no AI Key. The check and the sync job are
 * mocked, because the journey is about what the gate does for a given
 * verdict; the record the server freezes is pinned by
 * `test_artifact_completeness.py`. Three real Channels are selected: `lag`
 * only Behind, `cold` frozen, `whole` Complete.
 */

const HOUR = 3_600_000
type Body = { channelNames: string[]; frozenAt?: number }
type Report = {
  channelNames: string[]
  gate?: {
    choice: string
    skipped: string[]
    timedOut: string[]
    leftOut: string[]
  }
}

function verdict(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    reasons: [],
    reason: null,
    lastSync: Date.now() - HOUR,
    headReadAt: Date.now() - HOUR,
    error: null,
    stretches: [],
    missingIds: 0,
    syncable: true,
    behind: false,
    pacePerHour: 1,
    heldPosts: 50,
    unprovenPosts: 0,
    ...over,
  }
}

const endGap = (end: number, hours: number) => [
  { kind: "end", from: end - hours * HOUR, to: end },
]

/**
 * The check: `lag` Behind until `state.synced`, `cold` frozen until
 * `state.thawed` (then a lag of its own), the rest Complete. Its window ends
 * a minute before the answer, so a sync started now reads its head after E.
 */
async function mockCheck(page: Page, world: { lag: string; cold: string }) {
  const state = { synced: false, thawed: false, bodies: [] as Body[] }
  await page.route("**/api/v1/data/posts/window-check", async (route) => {
    const body = route.request().postDataJSON() as Body
    state.bodies.push(body)
    const end = Date.now() - 60_000
    const channels = body.channelNames.map((name) => {
      if (name === world.lag && !state.synced)
        return verdict(name, {
          reasons: ["end"],
          reason: "end",
          behind: true,
          stretches: endGap(end, 2),
          unprovenPosts: 2,
        })
      if (name === world.cold)
        return verdict(name, {
          reasons: state.thawed ? ["end"] : ["end", "frozen"],
          reason: "end",
          syncable: state.thawed,
          stretches: endGap(end, 9),
          unprovenPosts: 9,
        })
      return verdict(name)
    })
    const unproven = channels.reduce((n, c) => n + c.unprovenPosts, 0)
    await route.fulfill({
      json: {
        frozenAt: end + 60_000,
        start: end - 24 * HOUR,
        end,
        channels,
        heldPosts: 100,
        unprovenPosts: unproven,
        unprovenFloor: false,
      },
    })
  })
  return state
}

/** A sync job whose stream ends once `release` is called. */
async function mockSync(page: Page) {
  const jobId = `e2e-cwg-${Date.now()}`
  const starts: { channelIds?: string[] }[] = []
  let release = () => {}
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/jobs/sync", async (route) => {
    starts.push(route.request().postDataJSON())
    await route.fulfill({ json: { jobId } })
  })
  await page.route(`**/api/v1/jobs/sync/${jobId}/events`, async (route) => {
    await done
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        jobId,
        status: "completed",
        source: "e2e",
        channels: [],
        createdAt: Date.now(),
        finishedAt: Date.now(),
      })}\n\n`,
    })
  })
  return { starts, release: () => release() }
}

/** Every report the gate let through, as the server was sent it. */
async function recordReports(page: Page) {
  const sent: Report[] = []
  await page.route("**/api/v1/data/discover/reports", async (route) => {
    if (route.request().method() === "POST")
      sent.push(route.request().postDataJSON())
    await route.continue()
  })
  return sent
}

async function world(page: Page) {
  await gotoWorkspace(page, "channels")
  const stamp = Date.now()
  const [lag, cold, whole] = ["lag", "cold", "whole"].map(
    (n) => `cwg${n}${stamp}`,
  )
  for (const name of [lag, cold, whole])
    await seedTestChannel(page, name, [], { lastUpdated: Date.now() })
  await clearChannelSelection(page)
  await selectChannelsKeyboard(page, [lag, cold, whole])
  const check = await mockCheck(page, { lag, cold })
  const sync = await mockSync(page)
  const reports = await recordReports(page)
  await page.locator("#tour-tab-action").click()
  return { lag, cold, whole, check, sync, reports }
}

const gate = (page: Page) => page.getByTestId("gate")
const generate = (page: Page) =>
  page.getByTestId("action-generate-report").click()
const syncButton = (page: Page) =>
  gate(page).getByRole("button", { name: /^Sync \d/ })

test("the review, and Enter syncs and continues", async ({ page }) => {
  const w = await world(page)
  await generate(page)

  await expect(gate(page)).toContainText(
    "1 Channel needs attention, 1 just behind",
  )
  await expect(gate(page)).toContainText(
    /Before generate report: the window ends .+, with ~11 Posts \(10%\) unproven\./,
  )
  await expect(gate(page)).toContainText("Just behind · 1, up to 2 h")
  await expect(gate(page)).toContainText("No sync can fix these · 1")
  await expect(syncButton(page)).toHaveText(/Sync 1 · \d+s/)

  await page.keyboard.press("Enter")
  await expect.poll(() => w.sync.starts.length).toBe(1)
  expect(w.sync.starts[0].channelIds).toHaveLength(1)
  await expect(
    gate(page).getByRole("button", { name: "Continue now" }),
  ).toBeVisible()
  w.check.synced = true
  w.sync.release()

  await expect(
    page.getByText(
      "Synced 1: 1 now complete. Generate report runs on an Incomplete window: 1 frozen.",
    ),
  ).toBeVisible()
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate).toMatchObject({ choice: "synced", timedOut: [] })
  // The gate checked again at the moment it froze, not at the request.
  const again = w.check.bodies.filter((b) => b.frozenAt)
  expect(again.map((b) => b.channelNames.length)).toEqual([3])
  await expect(page).toHaveURL(/tab=discover/)
})

test("untouched, the gate syncs by itself after 30 s", async ({ page }) => {
  test.setTimeout(90_000)
  const w = await world(page)
  await generate(page)
  await expect(syncButton(page)).toHaveText(/Sync 1 · \d+s/)
  await expect.poll(() => w.sync.starts.length, { timeout: 40_000 }).toBe(1)
})

test("an edit stops the countdown; Leave out, then continue without syncing", async ({
  page,
}) => {
  const w = await world(page)
  await generate(page)
  await expect(syncButton(page)).toHaveText(/· \d+s/)

  await gate(page).getByRole("button", { name: "Leave out" }).click()
  await expect(
    page.getByText(`Left @${w.cold} out of the selection.`),
  ).toBeVisible()
  await expect(gate(page)).not.toContainText("No sync can fix these")
  await expect(syncButton(page)).toHaveText("Sync 1")
  await page.waitForTimeout(2_000)
  await expect(syncButton(page)).toHaveText("Sync 1")

  await gate(page)
    .getByRole("button", { name: "Continue without syncing" })
    .click()
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].channelNames.sort()).toEqual([w.lag, w.whole].sort())
  expect(w.reports[0].gate).toMatchObject({
    choice: "skipped",
    skipped: [w.lag],
    leftOut: [w.cold],
  })
  expect(w.sync.starts).toHaveLength(0)
})

test("continue with the complete Channels only, and Undo", async ({ page }) => {
  const w = await world(page)
  await generate(page)
  await gate(page)
    .getByRole("button", { name: "Continue with 1 complete only" })
    .click()

  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].channelNames).toEqual([w.whole])
  expect(w.reports[0].gate?.choice).toBe("complete_only")
  expect([...(w.reports[0].gate?.leftOut ?? [])].sort()).toEqual(
    [w.lag, w.cold].sort(),
  )

  await page
    .getByText("Selection narrowed to the 1 complete Channels.")
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Undo" })
    .click()
  // The gate, opened again, checks all three.
  await page.locator("#tour-tab-action").click()
  await generate(page)
  await expect.poll(() => w.check.bodies.at(-1)?.channelNames.length).toBe(3)
})

test("Unfreeze moves its row among those a sync can fix", async ({ page }) => {
  const w = await world(page)
  await generate(page)
  await expect(syncButton(page)).toHaveText(/^Sync 1/)
  w.check.thawed = true

  await gate(page).getByRole("button", { name: "Unfreeze" }).click()
  await expect(
    page.getByText(new RegExp(`Unfroze @${w.cold}: it is in .+ now`)),
  ).toBeVisible()
  await expect(gate(page)).toContainText("A sync can fix these · 1")
  await expect(gate(page)).not.toContainText("No sync can fix these")
  await expect(syncButton(page)).toHaveText("Sync 2")
})

test("with nothing a sync can fix, the gate asks nothing", async ({ page }) => {
  const w = await world(page)
  w.check.synced = true
  await generate(page)

  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate?.choice).toBe("nothing_to_sync")
  await expect(syncButton(page)).toHaveCount(0)
})

test("the gate joins a sync the banner started, its rows labelled", async ({
  page,
}) => {
  const w = await world(page)
  await page
    .getByTestId("window-banner")
    .getByRole("button", { name: "Sync 1" })
    .click()
  await expect.poll(() => w.sync.starts.length).toBe(1)

  await generate(page)
  const row = gate(page).getByTestId("gate-row").filter({ hasText: w.lag })
  await expect(row).toContainText(/syncing, started \d+ min ago/)
  await syncButton(page).click()
  await page.waitForTimeout(1_000)
  expect(w.sync.starts).toHaveLength(1)

  w.check.synced = true
  w.sync.release()
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate?.choice).toBe("synced")
})

/** A report made through the gate without syncing, so its record is Incomplete. */
async function skippedReport(page: Page) {
  const w = await world(page)
  await generate(page)
  await gate(page)
    .getByRole("button", { name: "Continue without syncing" })
    .click()
  await expect(page).toHaveURL(/tab=discover/)
  return w
}

test("the report's page shows its window now, and Regenerate runs the gate", async ({
  page,
}) => {
  await skippedReport(page)
  const banner = page.getByTestId("window-banner")
  await expect(banner).toContainText("Unproven through")
  await expect(page.getByTestId("window-now")).toContainText(
    "now 1 frozen · last 2 h on 1",
  )

  await banner.getByRole("button", { name: "Regenerate" }).click()
  await expect(page).toHaveURL(/tab=action/)
  await expect(gate(page)).toContainText(
    "1 Channel needs attention, 1 just behind",
  )
})

test("History's pill opens its breakdown on hover", async ({ page }) => {
  await skippedReport(page)
  await page.locator("#tour-tab-history").click()
  const pill = page.getByTestId("completeness-pill").first()
  await expect(pill).toContainText("unproven")
  await expect(pill).toHaveAttribute("data-tone", "amber")
  await pill.hover()
  await expect(page.getByTestId("completeness-breakdown")).toContainText(
    "a sync could have fixed some of them.",
  )
})

test.describe("on a phone", () => {
  test.use({ hasTouch: true })

  test("History's pill opens by tap, on screen, nothing scrolling sideways", async ({
    page,
  }) => {
    await skippedReport(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.locator("#tour-tab-history").click()
    const pill = page.getByTestId("completeness-pill").first()
    await pill.tap()
    const breakdown = page.getByTestId("completeness-breakdown")
    await expect(breakdown).toBeInViewport()
    const [scrollWidth, clientWidth] = await page
      .locator("html")
      .evaluate((el) => [el.scrollWidth, el.clientWidth])
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  })
})
