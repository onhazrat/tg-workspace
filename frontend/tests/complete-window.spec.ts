import type { Page } from "@playwright/test"
import type { ChannelVerdict } from "../src/client"
import { verdict as base } from "../src/lib/complete-window/verdict-fixtures"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

/**
 * The live check on the Action and Posts tabs (CW-01, ADR-043): the one line,
 * its Sync, Details with its legend toggles and isolate, Visualize, and phone
 * width. Over a mocked check and sync job, because the journey is about what
 * the tabs say for a given verdict; the verdicts themselves are pinned by
 * `test_window_check.py`. Two real Channels are selected so the Sync button
 * finds them: the first only Behind, the second frozen.
 */

const HOUR = 3_600_000
type Body = { channelNames: string[]; window: unknown }

const verdict = (name: string, over: Partial<ChannelVerdict> = {}) =>
  base(name, {
    lastSync: Date.now() - HOUR,
    headReadAt: Date.now() - HOUR,
    heldPosts: 50,
    ...over,
  })

function incomplete(names: string[], end: number) {
  const [lag, cold] = names
  const endGap = (hours: number) => [
    { kind: "end" as const, from: end - hours * HOUR, to: end },
  ]
  return [
    verdict(lag, {
      reasons: ["end"],
      reason: "end",
      behind: true,
      stretches: endGap(2),
      unprovenPosts: 2,
    }),
    verdict(cold, {
      reasons: ["failed", "end", "frozen"],
      reason: "failed",
      error: "proxy down",
      syncable: false,
      stretches: endGap(9),
      unprovenPosts: 9,
    }),
  ]
}

/** The check answers Incomplete until `state.synced`, then Complete. */
async function mockCheck(page: Page) {
  const state = { synced: false, bodies: [] as Body[], hold: false }
  await page.route("**/api/v1/data/posts/window-check", async (route) => {
    const body = route.request().postDataJSON() as Body
    state.bodies.push(body)
    if (state.hold) await new Promise((done) => setTimeout(done, 3_000))
    const end = Date.now()
    const names = body.channelNames
    await route.fulfill({
      json: {
        frozenAt: end,
        start: end - 24 * HOUR,
        end,
        channels: state.synced
          ? names.map((n) => verdict(n))
          : incomplete(names, end),
        heldPosts: 100,
        unprovenPosts: state.synced ? 0 : 11,
        unprovenFloor: false,
      },
    })
  })
  return state
}

/** A sync job whose stream ends once `release` is called. */
async function mockSync(page: Page) {
  const jobId = `e2e-cw-${Date.now()}`
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
        source: "Complete window sync",
        channels: [],
        createdAt: Date.now(),
        finishedAt: Date.now(),
      })}\n\n`,
    })
  })
  return { starts, release: () => release() }
}

async function selectTwo(page: Page): Promise<string[]> {
  await gotoWorkspace(page, "channels")
  const stamp = Date.now()
  const names = [`cwa${stamp}`, `cwb${stamp}`]
  for (const name of names)
    await seedTestChannel(page, name, [], { lastUpdated: Date.now() })
  await clearChannelSelection(page)
  await selectChannelsKeyboard(page, names)
  return names
}

const banner = (page: Page) => page.getByTestId("window-banner")
const rows = (page: Page) => page.getByTestId("window-row")

test("the line, Sync, and the check asked again when the sync ends", async ({
  page,
}) => {
  const state = await mockCheck(page)
  const sync = await mockSync(page)
  const names = await selectTwo(page)
  await page.locator("#tour-tab-action").click()

  await expect(banner(page)).toContainText(
    /Unproven through \d\d:\d\d [AP]M: ~11 Posts \(10%\) · 1 frozen · last 2 h on 1/,
  )
  expect(state.bodies.at(-1)?.channelNames).toEqual(names)

  await banner(page).getByRole("button", { name: "Sync 1" }).click()
  await expect(banner(page)).toContainText("Syncing 1…")
  await expect.poll(() => sync.starts.length).toBe(1)
  state.synced = true
  sync.release()
  await expect(
    page.getByText("Synced 1. Checking the window again."),
  ).toBeVisible()
  await expect(banner(page)).toContainText(
    /Complete window: all 2 Channels proven through \d\d:\d\d [AP]M/,
  )
})

test("Details: legend toggles, double-click isolates, Visualize", async ({
  page,
}) => {
  await mockCheck(page)
  const [lag, cold] = await selectTwo(page)
  await page.locator("#tour-tab-action").click()

  await banner(page).getByRole("button", { name: "Details" }).click()
  // Behind starts off: the list opens on what needs a look.
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText(`@${cold}`)
  await expect(rows(page).first()).toContainText("9 h behind, ~9 posts")
  // The failure's error opens on a click or a tap, not only on hover.
  await rows(page).first().getByTestId("reason-error").click()
  await expect(page.getByText("proxy down")).toBeVisible()
  await page.keyboard.press("Escape")

  const behind = banner(page).getByRole("button", { name: /End gap, behind/ })
  await behind.click()
  await expect(rows(page)).toHaveCount(2)
  await behind.dblclick()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText(`@${lag}`)
  await behind.dblclick()
  await expect(rows(page)).toHaveCount(2)

  await banner(page).getByRole("button", { name: "Visualize" }).click()
  await expect(page.getByTestId("window-timeline")).toContainText(`@${lag}`)
  await banner(page).getByRole("button", { name: "Hide rows" }).click()
  await expect(rows(page)).toHaveCount(0)
})

test("the Posts tab shows the line, dimmed only while an edit is checked", async ({
  page,
}) => {
  const state = await mockCheck(page)
  await selectTwo(page)
  await page.locator("#tour-tab-posts").click()
  await expect(banner(page)).toContainText("~11 Posts (10%)")
  await expect(banner(page)).not.toHaveAttribute("aria-busy", "true")

  state.hold = true
  const asked = state.bodies.length
  await page.getByRole("button", { name: "Analysis window" }).click()
  const duration = page.getByLabel("Duration", { exact: true })
  await duration.fill("3h")
  await duration.press("Enter")
  await page.keyboard.press("Escape")
  await expect(banner(page)).toHaveAttribute("aria-busy", "true")
  await expect(banner(page)).toContainText("Updating…")
  await expect.poll(() => state.bodies.length).toBeGreaterThan(asked)
  await expect(banner(page)).not.toHaveAttribute("aria-busy", "true")
})

test("a Live window's minute rolling asks again without dimming the line", async ({
  page,
}) => {
  // Story 7: only an edit dims it, never the minute.
  await page.clock.install()
  const state = await mockCheck(page)
  await selectTwo(page)
  await page.locator("#tour-tab-posts").click()
  await expect(banner(page)).toContainText("~11 Posts (10%)")
  // Settled first: the selection's own check is not what this is about.
  await expect(banner(page)).not.toHaveAttribute("aria-busy", "true")

  state.hold = true
  const asked = state.bodies.length
  await page.clock.fastForward("01:01")
  await expect.poll(() => state.bodies.length).toBeGreaterThan(asked)
  // Read once while the check is still held, not retried until it lands.
  expect(await banner(page).getAttribute("aria-busy")).toBeNull()
  expect(await banner(page).textContent()).not.toContain("Updating…")
})

test.describe("on a phone", () => {
  test("nothing scrolls sideways with Details and Visualize open", async ({
    page,
  }) => {
    await mockCheck(page)
    await selectTwo(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.locator("#tour-tab-action").click()
    await banner(page).getByRole("button", { name: "Details" }).click()
    await banner(page)
      .getByRole("button", { name: /End gap, behind/ })
      .click()
    await banner(page).getByRole("button", { name: "Visualize" }).click()
    await expect(page.getByTestId("window-timeline")).toBeVisible()
    // The page, and the banner inside a card that clips what overflows it.
    for (const scroller of [page.locator("html"), banner(page)]) {
      const [scrollWidth, clientWidth] = await scroller.evaluate((el) => [
        el.scrollWidth,
        el.clientWidth,
      ])
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
    }
  })
})
