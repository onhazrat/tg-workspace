import type { Page, Route } from "@playwright/test"

import { expect, test } from "./fixtures.ts"

/**
 * The Operator's Requests tab (RQS-03) over a mocked Breakdown: seam 2 of the
 * request-stats spec. The logged-in superuser holds `quota:read_any`.
 */

const part = (
  kind: string,
  useful: number,
  idle: number,
  wasted: number,
  charged: boolean,
) => ({
  kind,
  requests: useful + idle + wasted,
  useful,
  idle,
  wasted,
  charged: charged ? useful + idle + wasted : 0,
  newPosts: 0,
  repeatedPosts: 0,
})

/** 30 Channels synced, plus Directory probes: one row more than a page. */
const CHANNELS = Array.from({ length: 30 }, (_, i) => ({
  ...part("auto", 40 - i, 5, i === 0 ? 5 : 0, true),
  channel: `chan${String(i).padStart(2, "0")}`,
}))
const PROBES = { ...part("probe", 100, 200, 500, false), channel: null }
/** The 30 Channels together: useful 40 down to 11, idle 5 each, wasted 5 once. */
const AUTO = part("auto", 765, 150, 5, true)

const breakdown = (charged: string | null) => ({
  start: "2026-10-01T00:00:00",
  end: "2026-10-02T00:00:00",
  byKind: charged === "charged" ? [AUTO] : [AUTO, PROBES],
  byChannel: charged === "charged" ? CHANNELS : [PROBES, ...CHANNELS],
})

const DAY_MS = 86_400_000
/** UTC midnight `n` days ago, as the server writes it: naive, no zone. */
const daysAgo = (n: number) =>
  new Date(Math.floor(Date.now() / DAY_MS - n) * DAY_MS)
    .toISOString()
    .slice(0, 19)
const plus = (naive: string, ms: number) =>
  new Date(Date.parse(`${naive}Z`) + ms).toISOString().slice(0, 19)
const bucket = (start: string, span: number, kind: string, useful: number) => ({
  start,
  end: plus(start, span),
  kind,
  charged: kind !== "probe",
  useful,
  idle: 1,
  wasted: 0,
})
/**
 * Three days of Requests, all Charged but the probes: three days ago only a
 * daily total, two days ago two hours, yesterday 5 minutes of probes.
 */
const BUCKETS = [
  bucket(daysAgo(3), DAY_MS, "auto", 40),
  bucket(plus(daysAgo(2), 3_600_000 * 6), 3_600_000, "auto", 20),
  bucket(plus(daysAgo(2), 3_600_000 * 9), 3_600_000, "auto", 30),
  bucket(plus(daysAgo(1), 3_600_000 * 12), 300_000, "probe", 10),
]

/** Every Trend read, newest last; it answers the buckets inside the range. */
async function mockTrend(page: Page): Promise<URL[]> {
  const seen: URL[] = []
  await page.route("**/api/v1/requests/trend?**", (route: Route) => {
    const url = new URL(route.request().url())
    seen.push(url)
    const [lo, hi] = ["start", "end"].map((k) =>
      Date.parse(String(url.searchParams.get(k))),
    )
    const buckets = BUCKETS.filter(
      (b) => Date.parse(`${b.end}Z`) > lo && Date.parse(`${b.start}Z`) < hi,
    )
    return route.fulfill({
      json: { start: "", end: "", hourlyDays: 30, buckets },
    })
  })
  return seen
}

/** Every Breakdown read, newest last. The Trend is mocked beside it. */
async function mockBreakdown(page: Page): Promise<URL[]> {
  await mockTrend(page)
  const seen: URL[] = []
  await page.route("**/api/v1/requests/breakdown?**", (route: Route) => {
    const url = new URL(route.request().url())
    seen.push(url)
    return route.fulfill({ json: breakdown(url.searchParams.get("charged")) })
  })
  return seen
}

const total = (page: Page) => page.getByTestId("requests-total")
const kinds = (page: Page) =>
  page.getByRole("region", { name: "By kind of work" })
const channels = (page: Page) =>
  page.getByRole("region", { name: "Channels by Requests" })
const channelRows = (page: Page) => page.getByTestId("requests-channel-row")
const minute = (iso: string | null) => Date.parse(String(iso)) % 60_000

test("the Operator opens Requests from the + menu and reads the range's totals", async ({
  page,
}) => {
  const seen = await mockBreakdown(page)
  await page.goto("/?tab=channels")
  await page.getByTestId("workspace-tab-add").click()
  await page.getByRole("menuitem", { name: "Requests" }).click()
  await expect(page).toHaveURL(/tab=requests/)

  // 30 Channels' 920 auto Requests and 800 probes.
  await expect(total(page)).toHaveText("1,720 Requests")
  await expect(page.getByTestId("requests-stat-wasted")).toContainText("505")
  await expect(page.getByTestId("requests-charged-charged")).toContainText(
    "920",
  )
  await expect(page.getByTestId("requests-charged-uncharged")).toContainText(
    "800",
  )
  await expect(kinds(page).getByRole("row")).toHaveCount(3)
  await expect(
    kinds(page).getByRole("row", { name: /Directory probe/ }),
  ).toContainText("uncharged")

  // The range is cut to the minute and read back in UTC.
  const first = seen.at(-1) as URL
  expect(minute(first.searchParams.get("start"))).toBe(0)
  expect(minute(first.searchParams.get("end"))).toBe(0)

  await page
    .getByRole("button", { name: "Requested", exact: true })
    .and(page.locator("[aria-haspopup=dialog]"))
    .click()
  // The last hour and a half: its length first, then up to now.
  for (const [field, value] of [
    ["Duration", "1h 30m"],
    ["End gap", "0m"],
  ]) {
    await page.getByLabel(field, { exact: true }).fill(value)
    await page.getByLabel(field, { exact: true }).press("Enter")
  }
  await page.keyboard.press("Escape")
  await expect
    .poll(() => {
      const url = seen.at(-1) as URL
      return (
        Date.parse(String(url.searchParams.get("end"))) -
        Date.parse(String(url.searchParams.get("start")))
      )
    })
    .toBe(90 * 60_000)
  const last = seen.at(-1) as URL
  const utc = (key: string) =>
    String(last.searchParams.get(key)).slice(0, 16).replace("T", " ")
  await expect(page.getByTestId("requests-range")).toHaveText(
    `from ${utc("start")} to ${utc("end")} (UTC)`,
  )
})

test("Charged narrows every number on the tab", async ({ page }) => {
  const seen = await mockBreakdown(page)
  await page.goto("/?tab=requests")
  await expect(total(page)).toHaveText("1,720 Requests")
  await page.getByTestId("requests-charged-charged").click()
  await expect(total(page)).toHaveText("920 Requests")
  expect(seen.at(-1)?.searchParams.get("charged")).toBe("charged")
  await expect(kinds(page).getByRole("row")).toHaveCount(2)
  await expect(
    channels(page).getByRole("row", { name: /Directory probes/ }),
  ).toHaveCount(0)
})

test("hidden kinds and outcomes reach both tables", async ({ page }) => {
  await mockBreakdown(page)
  await page.goto("/?tab=requests")
  const probeRow = channels(page).getByRole("row", { name: /Directory probes/ })
  await expect(probeRow).toHaveCount(1)

  await page.getByRole("checkbox", { name: "Show Directory probe" }).uncheck()
  await expect(probeRow).toHaveCount(0)
  await expect(
    kinds(page).getByRole("row", { name: /Auto sync/ }),
  ).toContainText("100%")

  const chip = (name: string) =>
    kinds(page).getByRole("button", { name, exact: true })
  await chip("Wasted").click()
  await expect(
    channels(page).getByRole("columnheader", { name: "Wasted %" }),
  ).toHaveCount(0)
  await chip("Idle").click()
  await expect(chip("Useful")).toBeDisabled()
  await expect(
    channels(page).getByRole("columnheader", { name: "Idle", exact: true }),
  ).toHaveCount(0)
})

const dailyBars = (page: Page) =>
  page.getByTestId("requests-daily-bars").locator(".recharts-bar-rectangle")
/** The chart reads the day under the pointer, so the pointer goes there first. */
async function clickDay(page: Page, n: number) {
  await dailyBars(page).nth(n).hover()
  await dailyBars(page).nth(n).click()
}

test("the daily bars draw the range's days, and a click narrows the tab to one", async ({
  page,
}) => {
  await mockBreakdown(page)
  const trend = await mockTrend(page)
  await page.goto("/?tab=requests")
  // A bar a day with Requests: the daily total, two hours, the probes.
  await expect(dailyBars(page)).toHaveCount(3)
  await expect(page.getByTestId("requests-daily-title")).toHaveText(
    "Requests per day (UTC). Click a day to narrow everything to it.",
  )

  // A hidden kind leaves the bars too.
  await page.getByRole("checkbox", { name: "Show Directory probe" }).uncheck()
  await expect(dailyBars(page)).toHaveCount(2)

  const day = daysAgo(2).slice(0, 10)
  await clickDay(page, 1)
  await expect(page.getByTestId("requests-range")).toHaveText(`on ${day} (UTC)`)
  await expect(page.getByTestId("requests-daily-title")).toHaveText(
    `Requests per hour on ${day} (UTC)`,
  )
  const last = trend.at(-1) as URL
  expect(last.searchParams.get("start")).toBe(`${day}T00:00:00.000Z`)
  // Its two hours, 06:00 and 09:00.
  await expect(dailyBars(page)).toHaveCount(2)
})

test("a day past the hourly totals has only its daily total", async ({
  page,
}) => {
  await mockBreakdown(page)
  await page.goto("/?tab=requests")
  await clickDay(page, 0)
  await expect(page.getByTestId("requests-daily-only")).toHaveText(
    `Hourly totals are kept for 30 days, so ${daysAgo(3).slice(0, 10)} has its daily total only.`,
  )
})

test("the Channel table searches, sorts and pages", async ({ page }) => {
  await mockBreakdown(page)
  await page.goto("/?tab=requests")
  await expect(channelRows(page)).toHaveCount(25)
  await channels(page).getByRole("button", { name: "Show 6 more" }).click()
  await expect(channelRows(page)).toHaveCount(31)

  await channels(page)
    .getByRole("button", { name: "Wasted", exact: true })
    .click()
  await expect(channelRows(page).nth(0)).toContainText("Directory probes")
  await expect(channelRows(page).nth(1)).toContainText("@chan00")

  await channels(page).getByLabel("Search Channels").fill("@chan2")
  await expect(channelRows(page)).toHaveCount(10)
})

test("the Settings Usage panel links to the tab", async ({ page }) => {
  await mockBreakdown(page)
  await page.goto("/admin")
  await page
    .locator("#setting-operator-deployment-usage")
    .getByRole("button", { name: "Open the Requests tab" })
    .click()
  await expect(page).toHaveURL(/tab=requests/)
  await expect(total(page)).toHaveText("1,720 Requests")
})

test("a phone-sized viewport has no sideways scroll", async ({ page }) => {
  await mockBreakdown(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/?tab=requests")
  await expect(channelRows(page)).toHaveCount(25)
  // What sticks out past the tab's edge, named so a failure says where.
  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    const tab = document.querySelector("[data-testid=requests-tab]") as Element
    const edge = tab.getBoundingClientRect().right
    return [
      root.scrollWidth - root.clientWidth,
      tab.scrollWidth - tab.clientWidth,
      ...[...tab.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > edge + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName}: ${el.textContent?.slice(0, 40)}`),
    ]
  })
  expect(overflow).toEqual([0, 0])
})

test.describe("an Account without the Operator's Permission", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/settings/registry", async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({ response, json: { ...body, permissions: [] } })
    })
  })

  test("is not offered the tab, and reached by URL it says so", async ({
    page,
  }) => {
    const seen = await mockBreakdown(page)
    await page.goto("/?tab=channels")
    await page.getByTestId("workspace-tab-add").click()
    await expect(page.getByRole("menuitem", { name: "Tools" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Requests" })).toHaveCount(
      0,
    )
    await page.keyboard.press("Escape")

    await page.goto("/?tab=requests")
    await expect(page.getByTestId("requests-refused")).toBeVisible()
    expect(seen).toEqual([])
  })
})
