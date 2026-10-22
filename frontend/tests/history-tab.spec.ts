import type { Page, Route } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

/**
 * The History tab's bar over a mocked API (HTR): filter by Kind and Status,
 * bound the list from a bar of the time filter's spread, sort both ways, and
 * fold the controls into the phone's sheet. The three routes are stubbed with
 * the server's shapes, and the stub filters as the server does, so the list
 * and the footer's total move together.
 */

const MINUTE = 60_000
const DAY = 1440 * MINUTE
/** 2026-10-01T00:00:00Z, a minute-aligned Written base. */
const T0 = Date.UTC(2026, 9, 1)

type Row = {
  kind: "summary" | "chat" | "tag" | "discovery"
  id: string
  timestamp: number
  status?: string
}

const ROWS: Row[] = [
  {
    kind: "summary",
    id: "htr-s1",
    timestamp: T0 + 3 * DAY,
    status: "complete",
  },
  { kind: "summary", id: "htr-s2", timestamp: T0 + 2 * DAY, status: "pending" },
  { kind: "chat", id: "htr-c1", timestamp: T0 + DAY },
  { kind: "discovery", id: "htr-d1", timestamp: T0 },
]

const shaped = (r: Row) => ({
  ...r,
  title: `Artifact ${r.id}`,
  isStarred: false,
  scope: {
    channels: ["alpha"],
    start: r.timestamp - DAY,
    end: r.timestamp,
    durationMinutes: 1440,
  },
  ...(r.kind === "summary" && {
    language: "English",
    autoRegenerate: false,
    autoPublish: false,
    failedAttempts: 0,
  }),
})

/** The list's filters, as the server applies them (Written bound only). */
function kept(q: URLSearchParams, skip?: "kind" | "status"): Row[] {
  const start = q.get("start")
  const end = q.get("end")
  return ROWS.filter(
    (r) =>
      (skip === "kind" || !q.get("kind") || r.kind === q.get("kind")) &&
      (skip === "status" || !q.get("status") || r.status === q.get("status")) &&
      (start === null || r.timestamp >= Number(start)) &&
      (end === null || r.timestamp < Number(end)),
  )
}

/** One bar per day from T0, the spread's 32 bars. */
const SPREAD = {
  total: ROWS.length,
  min: T0,
  max: T0 + 32 * DAY,
  median: T0 + DAY,
  bins: Array.from({ length: 32 }, (_, i) => ({
    lo: T0 + i * DAY,
    hi: T0 + (i + 1) * DAY,
    count: ROWS.filter(
      (r) => r.timestamp >= T0 + i * DAY && r.timestamp < T0 + (i + 1) * DAY,
    ).length,
  })),
}

async function mockHistory(page: Page): Promise<void> {
  await page.route("**/api/v1/data/artifacts**", async (route: Route) => {
    const url = new URL(route.request().url())
    const q = url.searchParams
    if (url.pathname.endsWith("/artifacts/spread"))
      return route.fulfill({ json: SPREAD })
    if (url.pathname.endsWith("/artifacts/counts")) {
      const byKind = kept(q, "kind")
      const byStatus = kept(q, "status")
      const count = (rows: Row[], f: (r: Row) => boolean) =>
        rows.filter(f).length
      return route.fulfill({
        json: {
          total: kept(q).length,
          kinds: {
            summary: count(byKind, (r) => r.kind === "summary"),
            chat: count(byKind, (r) => r.kind === "chat"),
            tag: count(byKind, (r) => r.kind === "tag"),
            discovery: count(byKind, (r) => r.kind === "discovery"),
          },
          kindsAll: byKind.length,
          statuses: {
            failed: count(byStatus, (r) => r.status === "failed"),
            pending: count(byStatus, (r) => r.status === "pending"),
          },
          statusesAll: byStatus.length,
        },
      })
    }
    if (!url.pathname.endsWith("/artifacts")) return route.fallback()
    const rows = kept(q).sort((a, b) =>
      q.get("descending") === "false"
        ? a.timestamp - b.timestamp
        : b.timestamp - a.timestamp,
    )
    return route.fulfill({
      json: Number(q.get("offset") ?? 0) === 0 ? rows.map(shaped) : [],
    })
  })
}

const cards = (page: Page) => page.getByTestId("artifact-card")
const ids = (page: Page) =>
  cards(page).evaluateAll((els) => els.map((el) => el.dataset.artifactId))
const total = (page: Page) => page.getByTestId("history-total")

test.beforeEach(async ({ page }) => {
  await mockHistory(page)
})

test("Kind and Status narrow the list and the total, and live in the URL", async ({
  page,
}) => {
  await page.goto("/?tab=history")
  await expect(cards(page)).toHaveCount(4, { timeout: 20_000 })
  await expect(total(page)).toHaveText("4 artifacts")
  await expect(page.getByTestId("history-kind-summary")).toHaveText("Summary2")

  await page.getByTestId("history-kind-summary").click()
  await expect(page).toHaveURL(/historyKind=summary/)
  await expect(cards(page)).toHaveCount(2)
  await expect(total(page)).toHaveText("2 artifacts")

  await page.getByTestId("history-status-pending").click()
  await expect(page).toHaveURL(/historyStatus=pending/)
  await expect(cards(page)).toHaveCount(1)
  await expect(total(page)).toHaveText("1 artifact")

  await page.reload()
  await expect(cards(page)).toHaveCount(1, { timeout: 20_000 })
})

test("a bar of the time filter's spread bounds the list to it", async ({
  page,
}) => {
  await page.goto("/?tab=history")
  await expect(cards(page)).toHaveCount(4, { timeout: 20_000 })

  await page
    .getByRole("button", { name: "Written", exact: true })
    .and(page.locator("[aria-haspopup=dialog]"))
    .click()
  // The second day's bar holds the Chat alone.
  await page.getByTestId("directory-bound-bar-1").click()
  await page.keyboard.press("Escape")

  await expect(page).toHaveURL(/historyTime=/)
  await expect(cards(page)).toHaveCount(1)
  await expect(total(page)).toHaveText("1 artifact")
  expect(await ids(page)).toEqual(["htr-c1"])
})

test("the sort reads newest first, then oldest first", async ({ page }) => {
  await page.goto("/?tab=history")
  await expect(cards(page)).toHaveCount(4, { timeout: 20_000 })
  await expect(page.getByTestId("history-footer")).toContainText(
    "Sorted by Written, newest first",
  )
  expect(await ids(page)).toEqual(["htr-s1", "htr-s2", "htr-c1", "htr-d1"])

  await page.getByRole("button", { name: "Sort descending" }).click()
  await expect(page).toHaveURL(/historyOrder=oldest/)
  await expect(page.getByTestId("history-footer")).toContainText("oldest first")
  await expect
    .poll(() => ids(page))
    .toEqual(["htr-d1", "htr-c1", "htr-s2", "htr-s1"])
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test("the controls fold behind one Filters button", async ({ page }) => {
    await page.goto("/?tab=history&historyKind=chat")
    await expect(cards(page)).toHaveCount(1, { timeout: 20_000 })
    await expect(page.getByTestId("history-kind-chat")).toHaveCount(0)

    const button = page.getByTestId("history-controls-button")
    await expect(button).toHaveText("1")
    await button.click()
    const sheet = page.getByRole("dialog", { name: "Filters and sort" })
    await expect(sheet).toBeVisible()
    await sheet.getByTestId("history-kind-all").click()
    await sheet.getByRole("button", { name: "Done" }).click()
    await expect(cards(page)).toHaveCount(4)
  })
})
