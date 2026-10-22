import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { readScopedStorage, seedScopedStorage } from "./utils/scoped-storage.ts"

/**
 * SFR-01: a Generate that broke leaves a Failed Summary that says why.
 * SFR-02: it can be retried on the worker, the text streams into the page, a
 * page opened mid-Attempt attaches to it, and a running Attempt can be stopped.
 * SFR-03: a Partial response can be kept, dismissed and restored, and the
 * automatic retry's countdown can be cancelled.
 * SFR-04: a retry can run on another Key and model, warns when the saved prompt
 * won't fit, and leaves the Action tab's selection alone.
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
const CUT_ID = "e2e-sfr-cut"
const COUNTDOWN_ID = "e2e-sfr-countdown"

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
  [CUT_ID]: summary(CUT_ID, { status: "failed", promptText: "P" }),
  [COUNTDOWN_ID]: summary(COUNTDOWN_ID, { status: "failed", promptText: "P" }),
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
  [CUT_ID]: [
    attempt(CUT_ID, 1, {
      partialText: "An older draft",
      partialDismissedAt: NOW - 30_000,
    }),
    attempt(CUT_ID, 2, {
      outcome: "stopped",
      kind: null,
      error: null,
      partialText: "The newest draft of the brief",
    }),
  ],
  [COUNTDOWN_ID]: [
    attempt(COUNTDOWN_ID, 1, {
      error: "The AI model is overloaded right now.",
    }),
  ],
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
  row(CUT_ID, "failed", 1),
  row(COUNTDOWN_ID, "failed", 1),
]

/** What a test changed; read before the fixed rows above. */
let state: {
  details: Record<string, unknown>
  attempts: Record<string, unknown[]>
  events: Record<string, string>
  posted: string[]
  onStart?: () => unknown
  /** The body of the last Attempt start. */
  startBody?: unknown
  onStop?: () => unknown
  /** Keep, dismiss, restore or cancel on one Attempt (SFR-03). */
  onAct?: (action: string, attemptId: string) => unknown
  /** The worker finishing, once the page has watched the Attempt. */
  afterWatch?: () => void
}

const sse = (...frames: object[]) =>
  frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("")

async function mockSummaries(page: Page): Promise<void> {
  state = { details: {}, attempts: {}, events: {}, posted: [] }
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
      return route.fulfill({
        json: ROWS.map((r) => state.details[r.id] ?? DETAILS[r.id]),
      })
    }
    if (route.request().method() === "POST") {
      state.posted.push(path)
      const start = path.match(/^\/summaries\/([^/]+)\/attempts\/start$/)
      if (start && state.onStart) {
        state.startBody = route.request().postDataJSON()
        return route.fulfill({ json: state.onStart() })
      }
      const stop = path.match(/\/attempts\/([^/]+)\/stop$/)
      if (stop && state.onStop) return route.fulfill({ json: state.onStop() })
      const act = path.match(
        /\/attempts\/([^/]+)\/(keep|dismiss|restore|cancel)$/,
      )
      if (act && state.onAct)
        return route.fulfill({ json: state.onAct(act[2], act[1]) })
    }
    const events = path.match(/\/attempts\/([^/]+)\/events$/)
    if (events) {
      const body = state.events[events[1]] ?? ""
      state.afterWatch?.()
      return route.fulfill({ contentType: "text/event-stream", body })
    }
    const attempts = path.match(/^\/summaries\/([^/]+)\/attempts$/)
    if (attempts)
      return route.fulfill({
        json: state.attempts[attempts[1]] ?? ATTEMPTS[attempts[1]] ?? [],
      })
    const detail = path.match(/^\/summaries\/([^/]+)$/)
    const found = detail && (state.details[detail[1]] ?? DETAILS[detail[1]])
    if (found && route.request().method() === "GET")
      return route.fulfill({ json: found })
    return route.fallback()
  })
}

test.beforeEach(async ({ page }) => {
  await mockSummaries(page)
})

test("a Failed Summary shows its latest error and folds the earlier ones", async ({
  page,
}) => {
  await page.goto(`/?tab=summary&summary=${FAILED_ID}`)

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
  await page.goto(`/?tab=summary&summary=${NO_PROMPT_ID}`)

  await expect(page.getByRole("alert")).toContainText("Too many tokens", {
    timeout: 20_000,
  })
  await expect(page.getByRole("alert")).toContainText("no AI Key charged")
  await expect(page.getByText("Use another AI")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Copy prompt" })).toHaveCount(0)
})

test("Retry runs on the worker, streams into the page, then shows the report", async ({
  page,
}) => {
  const running = attempt(FAILED_ID, 3, {
    outcome: "running",
    kind: null,
    error: null,
    endedAt: null,
  })
  state.onStart = () => {
    state.attempts[FAILED_ID] = [...ATTEMPTS[FAILED_ID], running]
    state.events[running.id] = sse(
      { text: "The fresh " },
      { text: "report." },
      { outcome: "succeeded", error: null },
    )
    state.afterWatch = () => {
      // What the worker wrote by the time the watch ends.
      state.details[FAILED_ID] = summary(FAILED_ID, {
        text: "The fresh report.",
        status: null,
      })
      state.attempts[FAILED_ID] = [
        ...ATTEMPTS[FAILED_ID],
        { ...running, outcome: "succeeded", endedAt: NOW },
      ]
    }
    return running
  }
  await page.goto(`/?tab=summary&summary=${FAILED_ID}`)
  await expect(page.getByTestId("try-again")).toContainText("Attempt 3", {
    timeout: 20_000,
  })

  await page.getByRole("button", { name: "Retry" }).click()

  // The finished report, not the running card that streamed it.
  await expect(page.getByTestId("running-attempt")).toHaveCount(0, {
    timeout: 20_000,
  })
  await expect(page.getByText("The fresh report.")).toBeVisible()
  expect(state.posted).toContain(`/summaries/${FAILED_ID}/attempts/start`)
  await expect(page.getByText("Failed ×2")).toHaveCount(0)
  // It took three Attempts, so the finished report keeps them folded.
  await expect(page.getByRole("button", { name: "Attempts (3)" })).toBeVisible()
})

test("a retry runs on another Key and model, warns it won't fit, and leaves the Action tab alone", async ({
  page,
}) => {
  const keys = [
    { id: "k-work", label: "Work key", provider: "gemini", baseUrl: null },
    { id: "k-spare", label: "Spare key", provider: "gemini", baseUrl: null },
  ].map((k) => ({ ...k, lastValidated: null, createdAt: NOW }))
  // The Action tab's model is the Account's (SET-05), and the retry must not move it.
  const aiPrefs: Record<string, unknown> = { selectedModel: "gemini-x" }
  await page.route("**/api/v1/data/settings/ai_prefs", (route) => {
    if (route.request().method() === "PUT")
      Object.assign(aiPrefs, route.request().postDataJSON())
    return route.fulfill({ json: { key: "ai_prefs", value: aiPrefs } })
  })
  await page.route("**/api/v1/data/ai-keys", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: keys })
      : route.fallback(),
  )
  const CATALOGUES: Record<string, unknown[]> = {
    "k-work": [{ id: "gemini-x", label: "gemini-x", contextLength: 1_000_000 }],
    // "THE SAVED PROMPT" is four tokens: past `tiny`'s two.
    "k-spare": [
      { id: "roomy", label: "roomy", contextLength: 1_000_000 },
      { id: "tiny", label: "tiny", contextLength: 2 },
    ],
  }
  await page.route("**/api/v1/ai/models", (route) => {
    const { aiKeyId } = route.request().postDataJSON() as { aiKeyId?: string }
    const models = CATALOGUES[aiKeyId ?? "k-work"] ?? []
    return route.fulfill({
      json: {
        models: models.map((m) => ({ ...(m as object), provider: "gemini" })),
        default: "",
      },
    })
  })
  state.attempts[FAILED_ID] = ATTEMPTS[FAILED_ID].map((a) => ({
    ...(a as object),
    keyId: "k-work",
  }))
  const running = attempt(FAILED_ID, 3, {
    outcome: "running",
    kind: null,
    error: null,
    endedAt: null,
    keyId: "k-spare",
    model: "tiny",
  })
  state.onStart = () => {
    state.attempts[FAILED_ID] = [...(state.attempts[FAILED_ID] ?? []), running]
    state.events[running.id] = sse(
      { text: "A tiny report." },
      { outcome: "succeeded", error: null },
    )
    state.afterWatch = () => {
      state.details[FAILED_ID] = summary(FAILED_ID, {
        text: "A tiny report.",
        status: null,
        model: "tiny",
      })
    }
    return running
  }

  await page.goto(`/?tab=summary&summary=${FAILED_ID}`)
  await expect(page.getByTestId("try-again")).toBeVisible({ timeout: 20_000 })
  await seedScopedStorage(page, {
    selected_ai_key: "k-work",
    ai_key_models: JSON.stringify({ "k-work": "gemini-x" }),
  })
  await page.reload()

  const card = page.getByTestId("try-again")
  const keyChip = card.getByLabel("Retry AI key")
  await expect(keyChip).toHaveValue("k-work", { timeout: 20_000 })
  await expect(
    card.getByRole("combobox", { name: "Retry model" }),
  ).toContainText("gemini-x")
  await expect(card.getByTestId("prompt-fit")).toHaveCount(0)

  await keyChip.selectOption("k-spare")
  await card.getByRole("combobox", { name: "Retry model" }).click()
  await page.getByRole("option", { name: "tiny" }).click()
  await expect(card.getByTestId("prompt-fit")).toContainText("won't fit")

  // It advises and never blocks.
  await card.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByText("A tiny report.")).toBeVisible({
    timeout: 20_000,
  })
  expect(state.startBody).toMatchObject({ aiKeyId: "k-spare", model: "tiny" })

  // The Action tab's Key and that Key's model are what they were.
  expect(await readScopedStorage(page, "selected_ai_key")).toBe("k-work")
  expect(
    JSON.parse((await readScopedStorage(page, "ai_key_models")) ?? "{}"),
  ).toEqual({ "k-work": "gemini-x" })
  await page.goto("/?tab=action")
  await expect(page.getByLabel("AI key", { exact: true })).toHaveValue(
    "k-work",
    { timeout: 20_000 },
  )
  await expect(
    page.getByRole("combobox", { name: "Inference model" }),
  ).toContainText("gemini-x")
})

test("a Summary reopened mid-Attempt shows the text so far, and Stop ends it", async ({
  page,
}) => {
  const running = attempt(FAILED_ID, 3, {
    outcome: "running",
    kind: null,
    error: null,
    endedAt: null,
  })
  state.attempts[FAILED_ID] = [...ATTEMPTS[FAILED_ID], running]
  // The worker is still writing: the watch has sent this much and no end.
  state.events[running.id] = sse({ text: "Half of the brief" })
  state.onStop = () => {
    const stopped = { ...running, outcome: "stopped", partialText: "Half" }
    state.attempts[FAILED_ID] = [...ATTEMPTS[FAILED_ID], stopped]
    return stopped
  }

  await page.goto(`/?tab=summary&summary=${FAILED_ID}`)
  const card = page.getByTestId("running-attempt")
  await expect(card).toContainText("Half of the brief", { timeout: 20_000 })
  await expect(card).toContainText("Attempt 3 is running")
  await expect(page.getByTestId("try-again")).toHaveCount(0)

  await card.getByRole("button", { name: "Stop" }).click()

  await expect(page.getByTestId("running-attempt")).toHaveCount(0)
  await expect(page.getByTestId("try-again")).toBeVisible()
  expect(state.posted).toContain(
    `/summaries/${FAILED_ID}/attempts/${running.id}/stop`,
  )
})

test("a token-limit refusal leads with Change selection", async ({ page }) => {
  await page.goto(`/?tab=summary&summary=${NO_PROMPT_ID}`)

  const card = page.getByTestId("change-selection-card")
  await expect(card).toContainText("No AI Key was charged", { timeout: 20_000 })
  await expect(page.getByTestId("try-again")).toHaveCount(0)
  await card.getByRole("button", { name: "Change selection" }).click()
  await expect(page).toHaveURL(/tab=action/)
})

test("a Pending Summary keeps the Copy Prompt panel", async ({ page }) => {
  await page.goto(`/?tab=summary&summary=${PENDING_ID}`)

  await expect(page.getByText("Awaiting External Response")).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByText("A COPIED PROMPT")).toBeVisible()
  await expect(page.getByText("Use another AI")).toHaveCount(0)
})

test("History's Failed filter shows only the red cards, and keeps it in the URL", async ({
  page,
}) => {
  await page.goto("/?tab=history")
  const cards = page.getByTestId("artifact-card")
  await expect(cards).toHaveCount(5, { timeout: 20_000 })
  await expect(
    page.locator(`[data-artifact-id="${PENDING_ID}"]`),
  ).toContainText("Awaiting response")

  await page.getByTestId("history-status-failed").click()
  await expect(page).toHaveURL(/historyStatus=failed/)
  await expect(cards).toHaveCount(4)
  const failed = page.locator(`[data-artifact-id="${FAILED_ID}"]`)
  // The badge says it; the footer does not say it again.
  await expect(failed).toContainText("Failed ×2")
  await expect(failed).not.toContainText("2 failed attempts")
  await expect(failed).toHaveClass(/border-red-500/)

  // A reload keeps the filter.
  await page.reload()
  await expect(cards).toHaveCount(4, { timeout: 20_000 })
  await expect(page.getByTestId("history-status-failed")).toHaveAttribute(
    "aria-pressed",
    "true",
  )
})

type Row = { id: string; partialDismissedAt: number | null }

/** The two journeys SFR-03 adds, at a desktop and at a phone's width. */
for (const [width, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 375, height: 812 }],
] as const) {
  test.describe(`at ${width} width`, () => {
    test.use({ viewport })

    test("a Partial response can be dismissed, restored and kept", async ({
      page,
    }) => {
      let rows = [...ATTEMPTS[CUT_ID]] as Row[]
      const newest = rows[1] as Row
      state.attempts[CUT_ID] = rows
      const set = (id: string, dismissedAt: number | null) => {
        rows = rows.map((a) =>
          a.id === id ? { ...a, partialDismissedAt: dismissedAt } : a,
        )
        state.attempts[CUT_ID] = rows
        return rows.find((a) => a.id === id)
      }
      state.onAct = (action, id) => {
        if (action === "dismiss") return set(id, NOW)
        if (action === "restore") return set(id, null)
        // Keep: the server finishes the Summary with the draft, Incomplete.
        state.details[CUT_ID] = summary(CUT_ID, {
          text: "The newest draft of the brief",
          status: null,
          incomplete: true,
        })
        const kept = attempt(CUT_ID, 3, { outcome: "kept_partial", kind: null })
        state.attempts[CUT_ID] = [...rows, kept]
        return kept
      }

      await page.goto(`/?tab=summary&summary=${CUT_ID}`)
      const drafts = page.getByTestId("partial-responses")
      await expect(drafts).toContainText("The newest draft of the brief", {
        timeout: 20_000,
      })
      await expect(drafts).not.toContainText("An older draft")
      await noSidewaysScroll(page)

      await drafts.getByRole("button", { name: "Dismiss", exact: true }).click()
      await expect(
        drafts.getByRole("button", { name: "Dismissed (2)" }),
      ).toBeVisible()
      expect(state.posted).toContain(
        `/summaries/${CUT_ID}/attempts/${newest.id}/dismiss`,
      )

      await drafts.getByRole("button", { name: "Dismissed (2)" }).click()
      await drafts.getByRole("button", { name: "Restore" }).first().click()
      await expect(
        drafts.getByRole("button", { name: "Dismissed (1)" }),
      ).toBeVisible()
      expect(state.posted).toContain(
        `/summaries/${CUT_ID}/attempts/${newest.id}/restore`,
      )

      await drafts.getByRole("button", { name: "Keep this draft" }).click()
      await expect(page.getByTestId("incomplete-mark")).toContainText(
        "The text stops here",
        { timeout: 20_000 },
      )
      await expect(
        page.getByText("The newest draft of the brief"),
      ).toBeVisible()
      expect(state.posted).toContain(
        `/summaries/${CUT_ID}/attempts/${newest.id}/keep`,
      )
      await noSidewaysScroll(page)
    })

    test("the automatic retry's countdown can be cancelled", async ({
      page,
    }) => {
      const queued = attempt(COUNTDOWN_ID, 2, {
        outcome: "running",
        kind: null,
        error: null,
        automatic: true,
        startedAt: Date.now() + 120_000,
        endedAt: null,
      })
      state.attempts[COUNTDOWN_ID] = [...ATTEMPTS[COUNTDOWN_ID], queued]
      state.onAct = () => {
        state.attempts[COUNTDOWN_ID] = [...ATTEMPTS[COUNTDOWN_ID]]
        return { status: "cancelled" }
      }

      await page.goto(`/?tab=summary&summary=${COUNTDOWN_ID}`)
      const countdown = page.getByTestId("retry-countdown")
      await expect(countdown).toContainText("Retrying automatically in", {
        timeout: 20_000,
      })
      await expect(page.getByTestId("try-again")).toHaveCount(0)
      await noSidewaysScroll(page)

      await countdown.getByRole("button", { name: "Cancel" }).click()

      await expect(page.getByTestId("retry-countdown")).toHaveCount(0)
      await expect(page.getByTestId("try-again")).toBeVisible()
      expect(state.posted).toContain(
        `/summaries/${COUNTDOWN_ID}/attempts/${queued.id}/cancel`,
      )
    })
  })
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth + 1)
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } })

  for (const [name, url] of [
    ["the failure page", `/?tab=summary&summary=${FAILED_ID}`],
    ["History filtered to Failed", "/?tab=history&historyStatus=failed"],
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
