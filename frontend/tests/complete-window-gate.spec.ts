import type { Page } from "@playwright/test"
import type { ChannelVerdict } from "../src/client"
import {
  verdict as base,
  windowCheck,
} from "../src/lib/complete-window/verdict-fixtures"
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
 * only Behind, `cold` frozen, `whole` Complete. Time is the page's clock
 * wherever a test waits on it: the countdown, the polls and the deadline.
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
/** A sync in flight, any Account's, as the check answers it. */
type Flight = Pick<ChannelVerdict, "syncingSince" | "syncAgain">

const verdict = (name: string, over: Partial<ChannelVerdict> = {}) =>
  base(name, {
    lastSync: Date.now() - HOUR,
    headReadAt: Date.now() - HOUR,
    heldPosts: 50,
    ...over,
  })

const endGap = (end: number, hours: number) => [
  { kind: "end" as const, from: end - hours * HOUR, to: end },
]

/**
 * The check: `lag` Behind until `state.synced`, `cold` frozen until
 * `state.thawed` (then a lag of its own), the rest Complete; `flying` says
 * which syncs are in flight. Its window ends a minute before the answer.
 */
async function mockCheck(page: Page, world: { lag: string; cold: string }) {
  const state = {
    synced: false,
    thawed: false,
    flying: {} as Record<string, Flight>,
    bodies: [] as Body[],
  }
  await page.route("**/api/v1/data/posts/window-check", async (route) => {
    const body = route.request().postDataJSON() as Body
    state.bodies.push(body)
    const end = Date.now() - 60_000
    const channels = body.channelNames.map((name) => {
      const flight = state.flying[name] ?? {}
      if (name === world.lag && !state.synced)
        return verdict(name, {
          reasons: ["end"],
          reason: "end",
          behind: true,
          stretches: endGap(end, 2),
          unprovenPosts: 2,
          ...flight,
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
    await route.fulfill({
      json: windowCheck(channels, {
        end,
        frozenAt: end + 60_000,
        heldPosts: 100,
      }),
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

/** Every report the gate let through: what was sent, and the Scope it froze. */
async function recordReports(page: Page) {
  const sent: Report[] = []
  const frozen: string[][] = []
  await page.route("**/api/v1/data/discover/reports", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    sent.push(route.request().postDataJSON())
    const response = await route.fetch()
    const json = await response.json()
    frozen.push(json.scope?.channels ?? [])
    await route.fulfill({ response, json })
  })
  return { sent, frozen }
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
  const { sent: reports, frozen } = await recordReports(page)
  await page.locator("#tour-tab-action").click()
  return { lag, cold, whole, check, sync, reports, frozen }
}

const gate = (page: Page) => page.getByTestId("gate")
const generate = (page: Page) =>
  page.getByTestId("action-generate-report").click()
const syncButton = (page: Page) =>
  gate(page).getByRole("button", { name: /^Sync \d/ })
const button = (page: Page, name: string) =>
  gate(page).getByRole("button", { name })

/** Stop the page's clock where it is, so each step below is one exact tick. */
async function pauseClock(page: Page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500))
}

/** The seconds the countdown shows. */
async function secondsLeft(page: Page) {
  const label = (await syncButton(page).textContent()) ?? ""
  return Number(/· (\d+)s/.exec(label)?.[1])
}

test("the review, and Enter syncs and continues", async ({ page }) => {
  const w = await world(page)
  await generate(page)

  await expect(gate(page)).toContainText(
    "1 Channel needs attention, 1 just behind",
  )
  await expect(gate(page)).toContainText(
    /Before generate report, the window ends .+, with ~11 Posts \(10%\) unproven\./,
  )
  await expect(gate(page)).toContainText("Just behind · 1, up to 2 h")
  await expect(gate(page)).toContainText("No sync can fix these · 1")
  await expect(syncButton(page)).toHaveText(/Sync 1 · \d+s/)

  // Enter reaches the Sync button: it holds the focus as the review opens.
  await expect(syncButton(page)).toBeFocused()
  await page.keyboard.press("Enter")
  await expect.poll(() => w.sync.starts.length).toBe(1)
  expect(w.sync.starts[0].channelIds).toHaveLength(1)
  await expect(button(page, "Continue now")).toBeVisible()
  w.check.synced = true
  w.sync.release()

  await expect(page.getByText("Synced 1: 1 now complete")).toBeVisible()
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate).toMatchObject({ choice: "synced", timedOut: [] })
  // The gate checked again at the moment it froze, not at the request.
  const again = w.check.bodies.filter((b) => b.frozenAt)
  expect(again.length).toBeGreaterThan(0)
  expect(again.every((b) => b.channelNames.length === 3)).toBe(true)
  await expect(page).toHaveURL(/tab=discover/)
})

test("the countdown fills the button, and untouched it syncs at 30 s", async ({
  page,
}) => {
  await page.clock.install()
  const w = await world(page)
  await generate(page)
  await expect(syncButton(page)).toHaveText(/Sync 1 · \d+s/)
  await pauseClock(page)

  // Within a tick of the end, not at an exact second: the label renders on
  // its own tick, which a paused clock can catch either side of.
  const left = await secondsLeft(page)
  await page.clock.fastForward((left - 2) * 1_000)
  await expect(syncButton(page)).toHaveText(/^Sync 1 · [1-3]s$/)
  expect(w.sync.starts).toHaveLength(0)
  await page.clock.fastForward(3_000)
  await expect.poll(() => w.sync.starts.length).toBe(1)
  await expect(button(page, "Continue now")).toBeVisible()
})

test("an edit stops the countdown for good", async ({ page }) => {
  await page.clock.install()
  const w = await world(page)
  await generate(page)
  await expect(syncButton(page)).toHaveText(/· \d+s/)

  await button(page, "Leave out").click()
  await expect(syncButton(page)).toHaveText("Sync 1")
  await pauseClock(page)
  await page.clock.fastForward(31_000)
  await expect(syncButton(page)).toHaveText("Sync 1")
  expect(w.sync.starts).toHaveLength(0)
})

// On the real clock: a report sent from a page clock run ahead would end its
// window in the server's future.
test("Leave out, then continue without syncing", async ({ page }) => {
  const w = await world(page)
  await generate(page)
  await button(page, "Leave out").click()
  await expect(
    page.getByText(`Left @${w.cold} out of the selection.`),
  ).toBeVisible()
  await expect(gate(page)).not.toContainText("No sync can fix these")

  await button(page, "Continue without syncing").click()
  await expect.poll(() => w.frozen.length).toBe(1)
  expect(w.frozen[0].sort()).toEqual([w.lag, w.whole].sort())
  expect(w.reports[0].gate).toMatchObject({
    choice: "skipped",
    skipped: [w.lag],
    leftOut: [w.cold],
  })
  expect(w.sync.starts).toHaveLength(0)
})

test("Leave all out takes every row no sync can fix", async ({ page }) => {
  const w = await world(page)
  await generate(page)
  await button(page, "Leave all out").click()
  await expect(
    page.getByText(`Left @${w.cold} out of the selection.`),
  ).toBeVisible()
  await expect(gate(page)).not.toContainText("No sync can fix these")
  await expect(syncButton(page)).toHaveText("Sync 1")

  await button(page, "Continue without syncing").click()
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate?.leftOut).toEqual([w.cold])
})

test("continue with the complete Channels only, and Undo", async ({ page }) => {
  const w = await world(page)
  await generate(page)
  await button(page, "Continue with 1 complete only").click()

  await expect.poll(() => w.frozen.length).toBe(1)
  // The Scope froze without what it left out, whatever the click sent.
  expect(w.frozen[0]).toEqual([w.whole])
  expect(w.reports[0].gate?.choice).toBe("complete_only")
  expect([...(w.reports[0].gate?.leftOut ?? [])].sort()).toEqual(
    [w.lag, w.cold].sort(),
  )

  await page.locator("#tour-tab-channels").click()
  await expect(
    page.getByRole("button", { name: "Clear selection" }),
  ).toContainText("1 selected")
  await page
    .getByText("Selection narrowed to the 1 complete Channels.")
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Undo" })
    .click()
  await expect(
    page.getByRole("button", { name: "Clear selection" }),
  ).toContainText("3 selected")
})

test("Cancel makes no Artifact", async ({ page }) => {
  const w = await world(page)
  await generate(page)
  await expect(syncButton(page)).toBeVisible()
  await button(page, "Cancel").click()
  await expect(gate(page)).toHaveCount(0)

  // The next action through the gate is the first one to make a report.
  w.check.synced = true
  await generate(page)
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate?.choice).toBe("nothing_to_sync")
})

test("Unfreeze moves its row among those a sync can fix", async ({ page }) => {
  const w = await world(page)
  await generate(page)
  await expect(syncButton(page)).toHaveText(/^Sync 1/)
  w.check.thawed = true

  await button(page, "Unfreeze").click()
  await expect(
    page.getByText(new RegExp(`Unfroze @${w.cold}\\. It is in .+ now`)),
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

test("the gate opens on the banner's check, marked refreshing", async ({
  page,
}) => {
  const w = await world(page)
  await expect(page.getByTestId("window-banner")).toContainText("~11 Posts")
  // The check at the click takes a while; the cached one shows meanwhile.
  await page.route("**/api/v1/data/posts/window-check", async (route) => {
    await new Promise((done) => setTimeout(done, 1_500))
    await route.fallback()
  })
  await generate(page)
  await expect(gate(page)).toContainText("refreshing")
  await expect(gate(page)).toContainText("1 Channel needs attention")
  await expect(gate(page)).not.toContainText("refreshing")
  expect(w.reports).toHaveLength(0)
})

test("the gate joins a sync in flight, its rows labelled, and starts none", async ({
  page,
}) => {
  await page.clock.install()
  const w = await world(page)
  await page
    .getByTestId("window-banner")
    .getByRole("button", { name: "Sync 1" })
    .click()
  await expect.poll(() => w.sync.starts.length).toBe(1)
  w.check.flying[w.lag] = { syncingSince: Date.now() - 2 * 60_000 }

  await generate(page)
  const row = gate(page).getByTestId("gate-row").filter({ hasText: w.lag })
  await expect(row).toContainText(/syncing, started \d+ min ago/)
  await syncButton(page).click()
  // It waits on that sync by asking the check, poll after poll.
  await pauseClock(page)
  const asked = w.check.bodies.length
  await page.clock.fastForward(2_000)
  await expect.poll(() => w.check.bodies.length).toBeGreaterThan(asked)

  w.check.flying = {}
  w.check.synced = true
  w.sync.release()
  await page.clock.fastForward(2_000)
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate?.choice).toBe("synced")
  // The report came after the one sync, which the gate never started again.
  expect(w.sync.starts).toHaveLength(1)
})

test("behind a sync that read its head before E, the gate queues another", async ({
  page,
}) => {
  await page.clock.install()
  const w = await world(page)
  w.check.flying[w.lag] = { syncingSince: Date.now() - HOUR, syncAgain: true }
  await generate(page)
  await expect(syncButton(page)).toBeVisible()
  await syncButton(page).click()
  await pauseClock(page)
  await page.clock.fastForward(2_000)
  expect(w.sync.starts).toHaveLength(0)

  // That sync ends: the gate's own starts behind it.
  w.check.flying = {}
  await page.clock.fastForward(2_000)
  await expect.poll(() => w.sync.starts.length).toBe(1)
  w.check.synced = true
  w.sync.release()
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate?.choice).toBe("synced")
})

test("Continue now stops waiting, the unfinished timed out", async ({
  page,
}) => {
  const w = await world(page)
  await generate(page)
  await syncButton(page).click()
  await expect.poll(() => w.sync.starts.length).toBe(1)
  w.check.flying[w.lag] = { syncingSince: Date.now() }

  await button(page, "Continue now").click()
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate).toMatchObject({
    choice: "continued_early",
    timedOut: [w.lag],
  })
})

test("after 5 minutes the gate continues, recording timed out", async ({
  page,
}) => {
  await page.clock.install()
  const w = await world(page)
  await generate(page)
  await syncButton(page).click()
  await expect.poll(() => w.sync.starts.length).toBe(1)
  w.check.flying[w.lag] = { syncingSince: Date.now() }

  await pauseClock(page)
  await page.clock.fastForward("04:59")
  await expect(button(page, "Continue now")).toBeVisible()
  expect(w.reports).toHaveLength(0)
  await page.clock.fastForward("00:02")
  await expect.poll(() => w.reports.length).toBe(1)
  expect(w.reports[0].gate).toMatchObject({
    choice: "timed_out",
    timedOut: [w.lag],
  })
})

/** A report made through the gate without syncing, so its record is Incomplete. */
async function skippedReport(page: Page) {
  const w = await world(page)
  await generate(page)
  await button(page, "Continue without syncing").click()
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

test("History's pill: amber, its breakdown on hover", async ({ page }) => {
  await skippedReport(page)
  await page.locator("#tour-tab-history").click()
  const pill = page.getByTestId("completeness-pill").first()
  await expect(pill).toContainText("unproven")
  // Amber, as it renders: a sync could have fixed some of it.
  const amber = await page.evaluate(() => {
    const probe = document.createElement("span")
    probe.className = "text-amber-800 dark:text-amber-200"
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  await expect(pill).toHaveCSS("color", amber)
  await pill.hover()
  const breakdown = page.getByTestId("completeness-breakdown")
  await expect(breakdown).toContainText("a sync could have fixed some")
  await expect(breakdown).toContainText("Skipped by you")
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
