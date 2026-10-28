import type { Page, Route } from "@playwright/test"

import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel.ts"
import {
  gotoWorkspace,
  openPaletteKeyboard,
} from "./utils/summarizer-helpers.ts"

/**
 * An Operator's Request kind switches (RKD-02, ADR-040), seam 2 of the
 * request-kinds spec: the Telegram work panel, the Requests tab's Status
 * column and the greyed actions, over a mocked runtime config, Breakdown and
 * lanes. A switch write is mocked too, so no test changes the deployment.
 */

const KINDS: [string, string][] = [
  ["auto", "Auto sync"],
  ["bulk", "Manual bulk"],
  ["single", "Manual single"],
  ["follow", "Follow"],
  ["probe", "Directory probe"],
  ["handle", "Handle check"],
  ["botApi", "Bot API"],
]
/** 10:32 today, when the kinds a test starts disabled went off. */
const SINCE = new Date().setHours(10, 32, 0, 0)

const part = (kind: string, requests: number) => ({
  kind,
  requests,
  useful: requests,
  idle: 0,
  wasted: 0,
  charged: 0,
  newPosts: 0,
  repeatedPosts: 0,
  syncs: 0,
  failedSyncs: 0,
  ledgerOnly: 0,
})

/**
 * The switches as `off` says, which a mocked write updates; every write, in
 * order.
 */
async function mockSwitches(page: Page, off: Record<string, number>) {
  const writes: [string, boolean][] = []
  await page.route("**/api/v1/jobs/runtime-config", async (route: Route) => {
    const response = await route.fetch()
    const body = await response.json()
    const requestKinds = KINDS.map(([kind, label]) => ({
      kind,
      label,
      enabled: !(kind in off),
      disabledSince: off[kind] ?? null,
      refusal: `${label} is disabled on this deployment`,
    }))
    await route.fulfill({ response, json: { ...body, requestKinds } })
  })
  await page.route(
    /\/api\/v1\/settings\/jobs\.deployment\.\w+RequestsEnabled$/,
    async (route: Route) => {
      const kind = /deployment\.(\w+)RequestsEnabled/.exec(
        route.request().url(),
      )?.[1] as string
      const { value } = route.request().postDataJSON()
      writes.push([kind, value])
      if (value) delete off[kind]
      else off[kind] = SINCE
      await route.fulfill({ json: {} })
    },
  )
  return writes
}

/** A day of 100 auto Requests, 900 probes and 5 unattributed; 3 and 40 queued. */
async function mockLoad(page: Page) {
  await page.route("**/api/v1/requests/breakdown?**", (route: Route) =>
    route.fulfill({
      json: {
        start: "2026-10-27T00:00:00",
        end: "2026-10-28T00:00:00",
        byKind: [part("auto", 100), part("probe", 900), part("other", 5)],
        byChannel: [],
        byAccount: [],
      },
    }),
  )
  await page.route("**/api/v1/requests/trend?**", (route: Route) =>
    route.fulfill({
      json: { start: "", end: "", hourlyDays: 30, buckets: [] },
    }),
  )
  await page.route("**/api/v1/requests/spread**", (route: Route) =>
    route.fulfill({ json: { recordDays: 7, hourlyDays: 30, buckets: [] } }),
  )
  const lane = (name: string, budget: string | null, queued: number) => ({
    lane: name,
    budget,
    tier: budget && "normal",
    queued,
    paused: false,
  })
  await page.route("**/api/v1/jobs/lanes", (route: Route) =>
    route.fulfill({
      json: {
        lanes: [
          lane("auto_sync_normal", "auto_sync", 3),
          lane("discover_probe_background", null, 40),
        ],
      },
    }),
  )
}

const panel = (page: Page) => page.getByTestId("telegram-work")
const panelRow = (page: Page, label: string) =>
  panel(page).getByRole("row").filter({ hasText: label })

test("the panel shows each kind's load, asks before disabling and enables at once", async ({
  page,
}) => {
  const writes = await mockSwitches(page, { botApi: SINCE })
  await mockLoad(page)
  // A link to one of its Settings lands on the panel.
  await page.goto("/?tab=settings&setting=jobs.deployment.probeRequestsEnabled")
  await expect(panel(page)).toBeInViewport()
  await expect(panel(page).getByRole("row")).toHaveCount(1 + KINDS.length)
  await expect(panelRow(page, "Directory probe")).toContainText("90090%40On")
  await expect(panelRow(page, "Bot API")).toContainText("off since 10:32")
  // The seven Settings are not plain rows as well.
  await expect(
    page.locator("#setting-jobs-deployment-probeRequestsEnabled"),
  ).toHaveCount(0)

  await page.getByTestId("telegram-work-probe").click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText(
    "900 Requests in the last 24 hours were Directory probe.",
  )
  await expect(dialog).toContainText("40 queued messages will wait")
  await expect(dialog).toContainText(
    '"Directory probe is disabled on this deployment"',
  )
  expect(writes).toEqual([])
  await page.getByTestId("telegram-work-confirm").click()
  await expect(panelRow(page, "Directory probe")).toContainText(
    "off since 10:32",
  )
  expect(writes).toEqual([["probe", false]])

  await page.getByTestId("telegram-work-botApi").click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId("telegram-work-botApi")).toHaveText("On")
  expect(writes).toEqual([
    ["probe", false],
    ["botApi", true],
  ])
})

test("the Requests tab's Status reads On or Off, keeps a zero row and links to the panel", async ({
  page,
}) => {
  await mockSwitches(page, { botApi: SINCE })
  await mockLoad(page)
  await page.goto("/?tab=requests")
  const kinds = page.getByRole("region", { name: "By kind of work" })
  const kindRow = (label: string) =>
    kinds.getByRole("row").filter({ hasText: label })
  await expect(kindRow("Auto sync").getByRole("cell").last()).toHaveText("On")
  await expect(kindRow("Other").getByRole("cell").last()).toHaveText("–")
  await expect(kindRow("Bot API").getByRole("cell").nth(2)).toHaveText("0")
  const off = kindRow("Bot API").getByRole("button", {
    name: "Off since 10:32",
  })
  await off.click()
  await expect(page).toHaveURL(/tab=settings/)
  await expect(page).toHaveURL(/setting=jobs.deployment.requestKinds/)
  await expect(panel(page)).toBeInViewport()
})

test("a disabled kind's actions are greyed out with its refusal", async ({
  page,
}) => {
  const off = Object.fromEntries(KINDS.map(([kind]) => [kind, SINCE]))
  await mockSwitches(page, off)
  const name = `rkd${Date.now()}`
  await gotoWorkspace(page, "channels")
  // Leaves the Channels tab searched down to it.
  await seedTestChannel(page, name)
  const card = page.locator(`[data-channel-name="${name}"]`)
  await expect(card.getByRole("button", { name: "Sync" })).toBeDisabled()
  const syncAll = page.getByRole("button", { name: "Sync all" })
  await expect(syncAll).toBeDisabled()
  await expect(syncAll).toHaveAttribute(
    "title",
    "Manual bulk is disabled on this deployment",
  )
  const follow = page.locator("#tour-add-channel")
  await expect(follow).toBeDisabled()
  await expect(follow).toHaveAttribute(
    "title",
    "Follow is disabled on this deployment",
  )

  await openPaletteKeyboard(page)
  await page.getByPlaceholder("Type a command...").fill("Add Channel")
  await expect(page.getByTestId("command-palette")).toContainText(
    "Handle check is disabled on this deployment",
  )
  await page.keyboard.press("Escape")

  await page.goto("/?tab=settings&setting=sync.yours.resyncAll")
  const reset = page
    .locator("#setting-sync-yours-resyncAll")
    .getByRole("button", { name: "Reset and sync all channels" })
  await expect(reset).toBeDisabled()
  await expect(reset).toHaveAttribute(
    "title",
    "Manual bulk is disabled on this deployment",
  )
})

test("an Account without Jobs manage sees no panel", async ({ page }) => {
  await mockSwitches(page, {})
  await mockLoad(page)
  await page.route("**/api/v1/settings/registry", async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ response, json: { ...body, permissions: [] } })
  })
  await page.goto("/?tab=settings&setting=jobs.deployment.requestKinds")
  await expect(page.locator("#settings-topic-account")).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
})
