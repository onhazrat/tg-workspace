import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

/**
 * SFR-01: a Generate that broke leaves a Failed Summary that says why.
 *
 * Over a mocked API, because the journey is about what the tab and History
 * show for rows in a given state, and making a real Generate fail would drag
 * an AI provider into it. The rows are the server's shapes: a Summary's
 * detail, its Attempts, and the History list with its status filter.
 */

const NOW = Date.now()
const FAILED_ID = "e2e-sfr-failed"
const NO_PROMPT_ID = "e2e-sfr-no-prompt"
const PENDING_ID = "e2e-sfr-pending"

const scope = {
  channels: ["alpha", "beta"],
  start: NOW - 86_400_000,
  end: NOW,
  durationMinutes: 1440,
}

const summary = (id: string, extra: Record<string, unknown>) => ({
  id,
  text: "",
  language: "English",
  model: "gemini-x",
  postCount: 5,
  timestamp: NOW - 60_000,
  chatMessageCount: 0,
  scope,
  ...extra,
})

const DETAILS: Record<string, unknown> = {
  [FAILED_ID]: summary(FAILED_ID, {
    status: "failed",
    promptText: "THE SAVED PROMPT",
  }),
  [NO_PROMPT_ID]: summary(NO_PROMPT_ID, { status: "failed" }),
  [PENDING_ID]: summary(PENDING_ID, {
    status: "pending",
    promptText: "A COPIED PROMPT",
  }),
}

const attempt = (summaryId: string, n: number, over: object) => ({
  id: `${summaryId}-a${n}`,
  summaryId,
  attempt: n,
  outcome: "failed",
  kind: "transient",
  error: `error ${n}`,
  model: "gemini-x",
  keyId: null,
  partialText: null,
  partialDismissedAt: null,
  automatic: false,
  scheduled: false,
  startedAt: NOW - 50_000,
  endedAt: NOW - 40_000,
  ...over,
})

const ATTEMPTS: Record<string, unknown[]> = {
  [FAILED_ID]: [
    attempt(FAILED_ID, 1, { kind: "quota", error: "Quota exhausted for key" }),
    attempt(FAILED_ID, 2, { error: "The AI model is overloaded right now." }),
  ],
  [NO_PROMPT_ID]: [
    attempt(NO_PROMPT_ID, 1, { kind: "limit", error: "Too many tokens" }),
  ],
  [PENDING_ID]: [],
}

const row = (id: string, status: string, failedAttempts: number) => ({
  kind: "summary",
  id,
  title: "",
  timestamp: NOW - 60_000,
  model: "gemini-x",
  postCount: 5,
  isStarred: false,
  note: null,
  actedByEmail: null,
  scope,
  status,
  language: "English",
  autoRegenerate: false,
  autoPublish: false,
  failedAttempts,
})

const ROWS = [
  row(FAILED_ID, "failed", 2),
  row(NO_PROMPT_ID, "failed", 1),
  row(PENDING_ID, "pending", 0),
]

async function mockSummaries(page: Page): Promise<void> {
  await page.route("**/api/v1/data/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace("/api/v1/data", "")
    if (path === "/artifacts") {
      const status = url.searchParams.get("status")
      const offset = Number(url.searchParams.get("offset") ?? 0)
      const rows = ROWS.filter((r) => !status || r.status === status)
      return route.fulfill({ json: offset === 0 ? rows : [] })
    }
    if (path === "/summaries") {
      if (route.request().method() !== "GET") return route.fallback()
      return route.fulfill({ json: ROWS.map((r) => DETAILS[r.id]) })
    }
    const attempts = path.match(/^\/summaries\/([^/]+)\/attempts$/)
    if (attempts) return route.fulfill({ json: ATTEMPTS[attempts[1]] ?? [] })
    const detail = path.match(/^\/summaries\/([^/]+)$/)
    if (detail && DETAILS[detail[1]] && route.request().method() === "GET")
      return route.fulfill({ json: DETAILS[detail[1]] })
    return route.fallback()
  })
}

test.beforeEach(async ({ page }) => {
  await mockSummaries(page)
})

test("a Failed Summary shows its latest error and folds the earlier ones", async ({
  page,
}) => {
  await page.goto(`/workspace?tab=summary&summary=${FAILED_ID}`)

  await expect(page.getByText("Analysis Report")).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText("Failed ×2")).toBeVisible()
  const latest = page.getByRole("alert")
  await expect(latest).toContainText("The AI model is overloaded right now.")
  await expect(latest).toContainText("Attempt 2")
  // The earlier reason is kept, folded.
  await expect(page.getByText("Quota exhausted for key")).toBeHidden()
  await page.getByRole("button", { name: "Earlier attempts (1)" }).click()
  await expect(page.getByText("Quota exhausted for key")).toBeVisible()

  await expect(page.getByText("Use another AI")).toBeVisible()
  await page.getByRole("button", { name: "Paste response" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  // Never the Copy Prompt panel.
  await expect(page.getByText("Awaiting External Response")).toHaveCount(0)
})

test("a Generate refused before its prompt existed offers nothing to copy", async ({
  page,
}) => {
  await page.goto(`/workspace?tab=summary&summary=${NO_PROMPT_ID}`)

  await expect(page.getByRole("alert")).toContainText("Too many tokens", {
    timeout: 20_000,
  })
  await expect(page.getByRole("alert")).toContainText("no AI Key charged")
  await expect(page.getByText("Use another AI")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Copy prompt" })).toHaveCount(0)
})

test("a Pending Summary keeps the Copy Prompt panel", async ({ page }) => {
  await page.goto(`/workspace?tab=summary&summary=${PENDING_ID}`)

  await expect(page.getByText("Awaiting External Response")).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText("A COPIED PROMPT")).toBeVisible()
  await expect(page.getByText("Use another AI")).toHaveCount(0)
})

test("History's Failed filter shows only the red cards, and keeps it in the URL", async ({
  page,
}) => {
  await page.goto("/workspace?tab=history")
  const cards = page.getByTestId("artifact-card")
  await expect(cards).toHaveCount(3, { timeout: 20_000 })
  await expect(
    page.locator(`[data-artifact-id="${PENDING_ID}"]`),
  ).toContainText("Awaiting response")

  await page.getByTestId("history-status-failed").click()
  await expect(page).toHaveURL(/historyStatus=failed/)
  await expect(cards).toHaveCount(2)
  const failed = page.locator(`[data-artifact-id="${FAILED_ID}"]`)
  await expect(failed).toContainText("Failed ×2")
  await expect(failed).toContainText("2 failed attempts")
  await expect(failed).toHaveClass(/border-red-500/)

  // A reload keeps the filter.
  await page.reload()
  await expect(cards).toHaveCount(2, { timeout: 20_000 })
  await expect(page.getByTestId("history-status-failed")).toHaveAttribute(
    "aria-pressed",
    "true",
  )
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } })

  for (const [name, url] of [
    ["the failure page", `/workspace?tab=summary&summary=${FAILED_ID}`],
    [
      "History filtered to Failed",
      "/workspace?tab=history&historyStatus=failed",
    ],
  ]) {
    test(`${name} has no sideways scroll`, async ({ page }) => {
      await page.goto(url)
      await expect(page.getByText(/Failed ×2/).first()).toBeVisible({
        timeout: 20_000,
      })
      const scroller = page.getByTestId("workspace-scroll")
      const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
      const page_ = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(page_.scrollWidth).toBeLessThanOrEqual(page_.clientWidth + 1)
    })
  }
})
