import type { Locator, Page, Route } from "@playwright/test"

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
  syncs: 0,
  failedSyncs: 0,
})

/**
 * 30 Channels synced, plus Directory probes: one row more than a page. Each
 * synced 10 times, the first three failing once; chanNN brought NN x 10 new
 * Posts, so the later Channels yield more per Request (RQS-04).
 */
const CHANNELS = Array.from({ length: 30 }, (_, i) => ({
  ...part("auto", 40 - i, 5, i === 0 ? 5 : 0, true),
  channel: `chan${String(i).padStart(2, "0")}`,
  syncs: 10,
  failedSyncs: i < 3 ? 1 : 0,
  newPosts: i * 10,
}))
const PROBES = { ...part("probe", 100, 200, 500, false), channel: null }

/** The auto Requests split between two Accounts: 600 and 320 (RQS-05). */
const ACCOUNTS = [
  { ...part("auto", 500, 100, 0, true), accountId: "a", email: "ann@x.org" },
  { ...part("auto", 265, 50, 5, true), accountId: "b", email: "bob@x.org" },
]

/** Each kind's totals, summed from the Channel rows the API answers. */
const byKindOf = (rows: ReturnType<typeof part>[]) => {
  const sums = new Map<string, ReturnType<typeof part>>()
  for (const { kind, ...row } of rows) {
    const sum = sums.get(kind) ?? part(kind, 0, 0, 0, false)
    for (const key of Object.keys(row) as (keyof typeof row)[])
      if (typeof row[key] === "number") (sum[key] as number) += row[key]
    sums.set(kind, sum)
  }
  return [...sums.values()]
}

const breakdown = (url: URL) => {
  const charged = url.searchParams.get("charged")
  const accounts = url.searchParams.getAll("accounts")
  const leftOut = url.searchParams.getAll("leftOut")
  const leftOutKinds = url.searchParams.getAll("leftOutKinds")
  const byAccount = ACCOUNTS.filter(
    (a) => !accounts.length || accounts.includes(a.accountId),
  )
  if (accounts.length)
    return {
      start: "2026-10-01T00:00:00",
      end: "2026-10-02T00:00:00",
      byKind: byAccount.map(({ accountId, email, ...rest }) => rest),
      byChannel: CHANNELS,
      byAccount,
    }
  const byChannel = (
    charged === "charged" ? CHANNELS : [PROBES, ...CHANNELS]
  ).filter((c) =>
    c.channel === null
      ? !leftOutKinds.includes(c.kind)
      : !leftOut.includes(c.channel),
  )
  return {
    start: "2026-10-01T00:00:00",
    end: "2026-10-02T00:00:00",
    byKind: byKindOf(byChannel),
    byChannel,
    byAccount,
  }
}

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

/**
 * When Requests were made (RQS-09): ten days 40 to 31 days ago kept only as
 * daily totals, then one hour on each of the last 30 days. A bar a day: 40.
 */
const SPREAD = [
  ...Array.from({ length: 10 }, (_, i) => ({
    start: daysAgo(40 - i),
    end: daysAgo(39 - i),
    requests: 100 + i,
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    start: plus(daysAgo(30 - i), 3_600_000 * 6),
    end: plus(daysAgo(30 - i), 3_600_000 * 7),
    requests: 10 + i,
  })),
]

/** Every Spread read, newest last. */
async function mockSpread(page: Page): Promise<URL[]> {
  const seen: URL[] = []
  await page.route("**/api/v1/requests/spread**", (route: Route) => {
    seen.push(new URL(route.request().url()))
    return route.fulfill({
      json: { recordDays: 7, hourlyDays: 30, buckets: SPREAD },
    })
  })
  return seen
}

/** Every Breakdown read, newest last. The Trend and Spread are mocked beside it. */
async function mockBreakdown(page: Page): Promise<URL[]> {
  await mockTrend(page)
  await mockSpread(page)
  const seen: URL[] = []
  await page.route("**/api/v1/requests/breakdown?**", (route: Route) => {
    const url = new URL(route.request().url())
    seen.push(url)
    return route.fulfill({ json: breakdown(url) })
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

const openRequested = (page: Page) =>
  page
    .getByRole("button", { name: "Requested", exact: true })
    .and(page.locator("[aria-haspopup=dialog]"))
    .click()
const spreadBars = (scope: Page | Locator) =>
  scope.getByTestId(/^requests-spread-bar-/)

test("the range picker's spread shows when Requests were made, and a drag picks a range", async ({
  page,
}) => {
  const breakdowns = await mockBreakdown(page)
  const spreads = await mockSpread(page)
  await page.goto("/?tab=requests")
  await expect(total(page)).toHaveText("1,720 Requests")
  await openRequested(page)
  // Every day kept, under the tab's filters but not its range.
  await expect(spreadBars(page)).toHaveCount(40)
  await expect(page.getByText("7d · each Request")).toBeVisible()
  await expect(page.getByText("30d · hourly")).toBeVisible()
  expect(spreads.at(-1)?.searchParams.get("charged")).toBe("all")
  expect(spreads.at(-1)?.searchParams.has("start")).toBe(false)

  // A drag across bars 2 to 4: the three days from 38 days ago.
  const box = async (i: number) => {
    const b = await spreadBars(page).nth(i).boundingBox()
    if (!b) throw new Error(`bar ${i} is not drawn`)
    return { x: b.x + b.width / 2, y: b.y + b.height - 2 }
  }
  const [from, to] = [await box(2), await box(4)]
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(() => breakdowns.at(-1)?.searchParams.get("start"))
    .toBe(`${daysAgo(38)}.000Z`)
  expect(breakdowns.at(-1)?.searchParams.get("end")).toBe(`${daysAgo(35)}.000Z`)
  await expect(page.getByTestId("requests-range")).toHaveText(
    `from ${daysAgo(38).slice(0, 10)} to ${daysAgo(36).slice(0, 10)} (UTC)`,
  )
})

test("a zoomed spread scrolls, steps with the arrow keys, and keeps its zoom full screen", async ({
  page,
}) => {
  await mockBreakdown(page)
  await page.goto("/?tab=requests")
  await openRequested(page)
  await expect(spreadBars(page)).toHaveCount(40)
  const scrollbar = page.getByRole("scrollbar")
  await expect(scrollbar).toHaveCount(0)

  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect(scrollbar).toBeVisible()
  expect(await spreadBars(page).count()).toBeLessThan(40)
  const at = async () => Number(await scrollbar.getAttribute("aria-valuenow"))
  const start = await at()

  await scrollbar.focus()
  await page.keyboard.press("ArrowLeft")
  await expect.poll(at).toBeLessThan(start)
  const stepped = await at()
  await spreadBars(page).first().hover()
  await page.mouse.wheel(0, 200)
  await expect.poll(at).toBeGreaterThan(stepped)

  // A zoom that does not start on a midnight draws one bar more or less.
  const zoomed = await spreadBars(page).count()
  await page.getByRole("button", { name: "Spread full screen" }).click()
  const full = page.getByRole("dialog", { name: "When the Requests were made" })
  await expect(full).toBeVisible()
  await expect(spreadBars(full)).toHaveCount(zoomed)
  await expect(full.getByRole("scrollbar")).toBeVisible()
  // Esc leaves full screen alone; the popover stays open, still zoomed.
  await page.keyboard.press("Escape")
  await expect(full).toHaveCount(0)
  await expect(spreadBars(page)).toHaveCount(zoomed)
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

test("Accounts narrow the totals, and two compare side by side", async ({
  page,
}) => {
  const seen = await mockBreakdown(page)
  await page.goto("/?tab=requests")
  await expect(total(page)).toHaveText("1,720 Requests")
  await page.getByTestId("requests-accounts").click()
  await expect(page.getByTestId("requests-accounts-count-a")).toHaveText("600")
  await expect(page.getByTestId("requests-accounts-count-b")).toHaveText("320")

  await page.getByTestId("requests-accounts-funnel-a").click()
  await expect(total(page)).toHaveText("600 Requests")
  expect(seen.at(-1)?.searchParams.getAll("accounts")).toEqual(["a"])
  await expect(page.getByTestId("requests-uncharged-hidden")).toBeVisible()
  const compare = page.getByRole("region", { name: /Comparing/ })
  await expect(compare).toHaveCount(0)

  await page.getByTestId("requests-accounts-funnel-b").click()
  await page.keyboard.press("Escape")
  await expect(total(page)).toHaveText("920 Requests")
  await expect(compare).toHaveAccessibleName("Comparing 2 Accounts")
  await expect(compare.getByRole("row", { name: /ann@x.org/ })).toContainText(
    "65%",
  )
  await expect(compare.getByRole("row", { name: /bob@x.org/ })).toContainText(
    "320",
  )

  // The comparison fits a phone.
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(compare).toBeVisible()
  const sideways = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(sideways).toBe(0)
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

const row = (page: Page, name: string) =>
  channels(page).getByRole("row", { name: new RegExp(name) })

test("the Channel table narrows by kind, uncharged rows and any measure", async ({
  page,
}) => {
  await mockBreakdown(page)
  await page.goto("/?tab=requests")
  await expect(channelRows(page)).toHaveCount(25)

  // A kind's row in By kind of work narrows the table to that work.
  await kinds(page)
    .getByRole("row", { name: /Directory probe/ })
    .click()
  await expect(channelRows(page)).toHaveCount(1)
  await expect(page.getByTestId("requests-filter-chip-probe")).toBeVisible()
  await kinds(page)
    .getByRole("row", { name: /Directory probe/ })
    .click()
  await expect(channelRows(page)).toHaveCount(25)

  await page.getByTestId("requests-switch-uncharged").click()
  await expect(row(page, "Directory probes")).toHaveCount(0)
  await page.getByTestId("requests-switch-uncharged").click()
  await expect(row(page, "Directory probes")).toHaveCount(1)

  // Failed syncs, found by searching the criteria.
  await page.getByTestId("requests-filters").click()
  await page.getByPlaceholder("Search criteria...").fill("auto fail")
  await page.getByTestId("requests-filters-auto-failed").click()
  await page.getByRole("spinbutton", { name: "Value" }).fill("1")
  await page.getByTestId("requests-measure-submit").click()
  await expect(channelRows(page)).toHaveCount(3)
  await expect(page.getByTestId("requests-filter-count")).toContainText("3")
})

test("New Posts per Request ranks the Channels, the aggregate rows last", async ({
  page,
}) => {
  await mockBreakdown(page)
  await page.goto("/?tab=requests")
  // chan20: 200 new Posts in 25 Requests.
  const yieldOf = (name: string) => row(page, name).locator("td").nth(-2)
  await expect(yieldOf("@chan20")).toHaveText("8.0")
  await expect(yieldOf("@chan20")).toHaveAttribute(
    "title",
    "40% of a 20-Post page per Request",
  )
  await expect(yieldOf("Directory probes")).toHaveText("–")

  const header = channels(page).getByRole("button", {
    name: /New Posts \/ Req/,
  })
  await header.click()
  await expect(channelRows(page).first()).toContainText("@chan29")
  await header.click()
  await expect(channelRows(page).first()).toContainText("@chan00")
  await channels(page).getByRole("button", { name: "Show 6 more" }).click()
  await expect(channelRows(page).last()).toContainText("Directory probes")
})

test("a Channel left out leaves the whole tab, stays listed, and Pick all brings it back", async ({
  page,
}) => {
  const seen = await mockBreakdown(page)
  const trend = await mockTrend(page)
  await page.goto("/?tab=requests")
  await expect(total(page)).toHaveText("1,720 Requests")

  // chan00 made 50 Requests.
  await page.getByRole("checkbox", { name: "Pick @chan00" }).uncheck()
  await expect(total(page)).toHaveText("1,670 Requests")
  await expect(page.getByTestId("requests-left-out")).toHaveText(
    "1 Channel left out Pick all",
  )
  expect(seen.at(-1)?.searchParams.getAll("leftOut")).toEqual(["chan00"])
  expect(trend.at(-1)?.searchParams.getAll("leftOut")).toEqual(["chan00"])
  await expect(row(page, "@chan00")).toHaveCSS("opacity", "0.4")

  // The probes row leaves by its kind.
  await page.getByRole("checkbox", { name: "Pick Directory probes" }).uncheck()
  await expect(total(page)).toHaveText("870 Requests")
  expect(seen.at(-1)?.searchParams.getAll("leftOutKinds")).toEqual(["probe"])

  await page.getByRole("button", { name: "Pick all" }).click()
  await expect(total(page)).toHaveText("1,720 Requests")
  await expect(page.getByTestId("requests-left-out")).toHaveCount(0)

  // The header box leaves out every listed row: the search keeps ten.
  await channels(page).getByLabel("Search Channels").fill("@chan2")
  await page.getByRole("checkbox", { name: "Pick every listed row" }).uncheck()
  await expect(page.getByTestId("requests-left-out")).toHaveText(
    "10 Channels left out Pick all",
  )
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
