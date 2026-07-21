import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

import { WORKSPACE_TABS } from "../src/constants"
import {
  seedBulkChannels,
  seedPartialHistoryChannel,
  seedTestChannel,
} from "./utils/seed-channel"

function paletteModifier() {
  return process.platform === "darwin" ? "Meta" : "Control"
}

async function openPaletteKeyboard(page: Page) {
  await page.locator("main").click({ position: { x: 8, y: 8 } })
  await page.keyboard.press(`${paletteModifier()}+Shift+P`)
  await expect(page.getByTestId("command-palette")).toBeVisible()
}

async function runPaletteCommand(page: Page, query: string) {
  await page.getByPlaceholder("Type a command...").fill(query)
  await page.keyboard.press("Enter")
}

const entityChannelInputPlaceholder =
  "Name, display name, tag, #tag, or tag:tag..."

async function pickEntityChannelKeyboard(page: Page, channelName: string) {
  const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
  await entityInput.fill(channelName)
  await entityInput.press("Enter")
}

async function pickEntityFilterKeyboard(page: Page, value: string) {
  const entityInput = page.getByPlaceholder("Filter...")
  await entityInput.fill(value)
  await entityInput.press("Enter")
}

async function closePaletteKeyboard(page: Page) {
  const palette = page.getByTestId("command-palette")
  if (!(await palette.isVisible())) return
  await page.keyboard.press("Escape")
  if (await palette.isVisible()) {
    await page.keyboard.press("Escape")
  }
  await expect(palette).not.toBeVisible()
}

async function selectChannelsKeyboard(page: Page, channelNames: string[]) {
  await openPaletteKeyboard(page)
  await runPaletteCommand(page, "select channel")
  const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
  for (const name of channelNames) {
    await entityInput.fill(name)
    await entityInput.press("Enter")
  }
  await closePaletteKeyboard(page)
}

async function channelHasTag(
  page: Page,
  channelName: string,
  tag: string,
): Promise<boolean> {
  return page.evaluate(
    async ({ name, expectedTag }) => {
      const token = localStorage.getItem("access_token")
      if (!token) return false

      const response = await fetch("/api/v1/data/channels", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) return false

      const channels = (await response.json()) as Array<{
        name: string
        tags?: Array<string | { name?: string }>
      }>
      const channel = channels.find((entry) => entry.name === name)
      if (!channel?.tags) return false
      return channel.tags.some((entry) => {
        if (typeof entry === "string") return entry === expectedTag
        return entry?.name === expectedTag
      })
    },
    { name: channelName, expectedTag: tag },
  )
}

async function gotoSummarizer(page: Page, tab = "summary") {
  await page.goto(`/summarizer?tab=${tab}`)
  await expect(page.getByTestId("command-palette-button")).toBeVisible()
}

type DiscoverForwardFixture = {
  carrierName: string
  /** Already-followed forward source (appears checked+disabled). */
  followedSource?: string
  /** Unfollowed forward sources shown as follow candidates. */
  unfollowedSources: string[]
  /**
   * Original (non-forwarded) posts to include, carrying no handles or links so
   * they yield zero candidates under any signal.
   */
  originalPostCount?: number
}

const DISCOVER_SIGNAL_KINDS = ["forward", "mention", "link"] as const
type DiscoverSignalKind = (typeof DISCOVER_SIGNAL_KINDS)[number]

/**
 * Signal chips are schema-backed, so they survive reloads *and leak between
 * specs*. Blind clicking therefore toggles whatever the previous spec left
 * behind; set the desired state explicitly instead.
 */
async function setDiscoverSignal(
  page: Page,
  kind: DiscoverSignalKind,
  enabled: boolean,
) {
  const chip = page.getByTestId(`discover-signal-${kind}`)
  await expect(chip).toBeVisible()
  const current = await chip.getAttribute("aria-pressed")
  if (current !== String(enabled)) {
    await chip.click()
  }
  await expect(chip).toHaveAttribute("aria-pressed", String(enabled))
}

async function setDiscoverSignals(
  page: Page,
  enabled: Record<DiscoverSignalKind, boolean>,
) {
  for (const kind of DISCOVER_SIGNAL_KINDS) {
    await setDiscoverSignal(page, kind, enabled[kind])
  }
}

async function mockDiscoverForwardPosts(
  page: Page,
  fixture: DiscoverForwardFixture,
) {
  const now = Date.now()
  const etag = `${fixture.carrierName}-${now}`
  const posts: Array<Record<string, unknown>> = []
  // High ids avoid collisions with auto-sync scrape upserts that overwrite id=1.
  let postId = 900_000_000 + (now % 100_000)

  if (fixture.followedSource) {
    posts.push({
      id: postId++,
      channelName: fixture.carrierName,
      text: "Forward from followed source",
      date: new Date(now - 5_000).toISOString(),
      timestamp: now - 5_000,
      forwardedFrom: fixture.followedSource,
      forwardedFromName: fixture.followedSource,
    })
  }

  for (const source of fixture.unfollowedSources) {
    posts.push({
      id: postId++,
      channelName: fixture.carrierName,
      text: `Forward from ${source}`,
      date: new Date(now - 10_000 - posts.length * 1000).toISOString(),
      timestamp: now - 10_000 - posts.length * 1000,
      forwardedFrom: source,
      forwardedFromName: source,
    })
  }

  // Text deliberately free of handles and t.me links: these posts must survive
  // the "Original Only" filter while contributing no discovery candidates.
  for (let i = 0; i < (fixture.originalPostCount ?? 0); i += 1) {
    posts.push({
      id: postId++,
      channelName: fixture.carrierName,
      text: `Original post number ${i} about local weather and traffic.`,
      date: new Date(now - 20_000 - posts.length * 1000).toISOString(),
      timestamp: now - 20_000 - posts.length * 1000,
    })
  }

  await page.route("**/api/v1/data/sync-meta**", async (route) => {
    await route.fulfill({
      json: {
        channels: {
          etag: `playwright-discover-channels-${etag}`,
          updatedAt: new Date().toISOString(),
        },
        posts: {
          etag: `playwright-discover-posts-${etag}`,
          updatedAt: new Date().toISOString(),
        },
      },
    })
  })

  await page.route("**/api/v1/data/posts**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue()
      return
    }
    await route.fulfill({ json: posts })
  })

  await page.evaluate((ts) => {
    localStorage.removeItem("sync_etag_posts")
    localStorage.setItem("startDateTs", String(ts - 14 * 24 * 60 * 60 * 1000))
    localStorage.setItem("endDateTs", String(ts + 60_000))
    localStorage.setItem("postFilter_maxPerChannel", "0")
    // Persisted across specs; a leftover media filter would empty the scope.
    localStorage.setItem("postFilter_media", "all")
  }, now)
}

function completedFollowJobStatus(followJobId: string, channelNames: string[]) {
  return {
    followJobId,
    status: "completed",
    source: "Discover bulk follow",
    total: channelNames.length,
    completed: channelNames.length,
    added: channelNames.length,
    skipped: 0,
    unavailable: 0,
    failed: 0,
    results: channelNames.map((name) => ({ name, status: "added" })),
    syncJobId: null,
    createdAt: Date.now(),
    finishedAt: Date.now(),
  }
}

/** Mock bulk-follow create + SSE completion; returns POST call recorder. */
async function mockBulkFollowJob(page: Page, followJobId = "e2e-follow-job") {
  const postBodies: unknown[] = []

  await page.route("**/api/v1/data/channels/bulk-follow/**", async (route) => {
    const url = route.request().url()
    if (url.includes("/events")) {
      const jobId =
        url.match(/bulk-follow\/([^/]+)\/events/)?.[1] ?? followJobId
      const names =
        (
          postBodies[0] as { channels?: Array<{ name: string }> } | undefined
        )?.channels?.map((c) => c.name) ?? []
      const status = completedFollowJobStatus(jobId, names)
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify(status)}\n\ndata: [DONE]\n\n`,
      })
      return
    }

    if (route.request().method() === "GET") {
      const jobId = url.match(/bulk-follow\/([^/?]+)/)?.[1] ?? followJobId
      const names =
        (
          postBodies[0] as { channels?: Array<{ name: string }> } | undefined
        )?.channels?.map((c) => c.name) ?? []
      await route.fulfill({
        json: completedFollowJobStatus(jobId, names),
      })
      return
    }

    await route.continue()
  })

  await page.route("**/api/v1/data/channels/bulk-follow", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }
    postBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ followJobId }),
    })
  })

  return {
    getPostCount: () => postBodies.length,
    getPostBodies: () => postBodies,
  }
}

/**
 * Seeded channels auto-select on first load when prevChannelNames is empty.
 * Land on channels, let that settle, then pin selection to the carrier only.
 */
async function pinSelectionToCarrier(page: Page, carrierName: string) {
  await gotoSummarizer(page, "channels")
  // Seeded channels auto-select once the channel list arrives, which under
  // load lands *after* the clear+select above and silently clobbers it. The
  // carrier then ends up unselected, posts are read from IDB filtered to other
  // channels, and the spec fails with a "no posts in scope" far from the cause.
  // Retry until the pin sticks rather than asserting a racy first attempt.
  const expected = JSON.stringify([carrierName])
  const readSelection = () =>
    page.evaluate(() => localStorage.getItem("selectedChannels") ?? "[]")

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await readSelection()) === expected) break
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear selection")
    await closePaletteKeyboard(page)
    await selectChannelsKeyboard(page, [carrierName])
    // Give a late-arriving auto-select a chance to show itself before retrying.
    await page.waitForTimeout(1_000)
  }

  await expect.poll(readSelection, { timeout: 15_000 }).toBe(expected)

  // Force a fresh mock pull on next mount (avoid IDB pollution from sync jobs).
  await page.evaluate(() => {
    localStorage.removeItem("sync_etag_posts")
  })
}

async function openDiscoverWithForwards(
  page: Page,
  fixture: DiscoverForwardFixture,
) {
  await mockDiscoverForwardPosts(page, fixture)
  await pinSelectionToCarrier(page, fixture.carrierName)

  await gotoSummarizer(page, "discover")
  await expect(
    page.getByRole("heading", { name: "Channel Candidates" }),
  ).toBeVisible()

  const expectedSources =
    fixture.unfollowedSources.length + (fixture.followedSource ? 1 : 0)
  await expect(
    page.getByText(`Candidates: ${expectedSources}`, { exact: false }).first(),
  ).toBeVisible({ timeout: 15_000 })

  for (const source of fixture.unfollowedSources) {
    await expect(
      page.getByTestId(`discover-channel-link-${source}`),
    ).toBeVisible({ timeout: 15_000 })
  }
  if (fixture.followedSource) {
    await expect(
      page.getByTestId(`discover-channel-link-${fixture.followedSource}`),
    ).toBeVisible({ timeout: 15_000 })
    // Wait until channels list marks this source as already followed (D5B).
    await expect(
      page.getByTestId(`discover-select-${fixture.followedSource}`),
    ).toBeDisabled({ timeout: 15_000 })
  }
}

test.describe("TG Summarizer", () => {
  test("summarizer shell renders workspace tabs", async ({ page }) => {
    await page.goto("/summarizer")

    for (const tab of WORKSPACE_TABS) {
      await expect(page.locator(`#tour-tab-${tab.id}`)).toBeVisible()
    }
  })

  test("tag tab opens Tag view", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")
    await page.locator("#tour-tab-tag").click()

    await expect(page).toHaveURL(/tab=tag/)
    await expect(page.locator("#tour-tab-tag")).toHaveClass(/border-app-ink/)
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible()
  })

  test("tag tab loads from ?tab=tag URL", async ({ page }) => {
    await page.goto("/summarizer?tab=tag")

    await expect(page).toHaveURL(/tab=tag/)
    await expect(page.locator("#tour-tab-tag")).toHaveClass(/border-app-ink/)
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible()
  })

  test("discover tab opens Discover view", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")
    await page.locator("#tour-tab-discover").click()

    await expect(page).toHaveURL(/tab=discover/)
    await expect(page.locator("#tour-tab-discover")).toHaveClass(
      /border-app-ink/,
    )
    await expect(
      page.getByRole("heading", { name: "Channel Candidates" }),
    ).toBeVisible()
  })

  test("discover tab loads from ?tab=discover URL", async ({ page }) => {
    await page.goto("/summarizer?tab=discover")

    await expect(page).toHaveURL(/tab=discover/)
    await expect(page.locator("#tour-tab-discover")).toHaveClass(
      /border-app-ink/,
    )
    await expect(
      page.getByRole("heading", { name: "Discovery Scope" }),
    ).toBeVisible()
  })

  test("discover shows forward-only empty guide when only forwards are enabled", async ({
    page,
  }) => {
    // Keep SPA state (filter is in-memory); avoid flaky tab-bar clicks under load.
    test.setTimeout(90_000)

    // The "original only" guide requires a non-empty scope of original posts.
    // Reading that from the shared dev DB is what made this spec unreliable —
    // it reported "no posts in scope" whenever the DB had none in range.
    const stamp = Date.now()
    const carrierName = `dsorig${stamp}`

    await gotoSummarizer(page, "channels")
    await seedTestChannel(page, carrierName)
    await mockDiscoverForwardPosts(page, {
      carrierName,
      unfollowedSources: [],
      originalPostCount: 3,
    })
    await pinSelectionToCarrier(page, carrierName)

    await gotoSummarizer(page, "posts")
    const originalOnly = page.getByRole("button", { name: "Original Only" })
    await originalOnly.click()
    await expect(originalOnly).toHaveClass(/bg-app-ink/)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "Go to Discover")
    await expect(page).toHaveURL(/tab=discover/)

    // Mentions and links stay valid on original posts, so the forward-specific
    // guide only appears once they are switched off.
    await setDiscoverSignals(page, {
      forward: true,
      mention: false,
      link: false,
    })

    await expect(page.getByText(/forward metadata/i)).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Show all posts" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Enable all signals" }),
    ).toBeVisible()

    // Restore, so later specs do not inherit a forward-only signal set.
    await setDiscoverSignals(page, {
      forward: true,
      mention: true,
      link: true,
    })
  })

  test("discover signal toggles persist and filter candidates", async ({
    page,
  }) => {
    await gotoSummarizer(page, "discover")

    // Do not assume the starting state: the preference is schema-backed and
    // outlives whichever spec ran before this one.
    await setDiscoverSignal(page, "mention", true)

    const mentionChip = page.getByTestId("discover-signal-mention")
    await mentionChip.click()
    await expect(mentionChip).toHaveAttribute("aria-pressed", "false")

    // Preference is schema-backed, so it survives a reload.
    await page.reload()
    await expect(page.getByTestId("discover-signal-mention")).toHaveAttribute(
      "aria-pressed",
      "false",
    )

    // Restore, so this spec does not disable mentions for the rest of the run.
    await setDiscoverSignal(page, "mention", true)
  })

  test("discover channel and forwarded-by links use web-view /s/ hrefs", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const followedSource = `dsfoll${stamp}`
    const unfollowedSource = `dsunf${stamp}`

    await gotoSummarizer(page, "channels")
    await seedTestChannel(page, carrierName)
    await seedTestChannel(page, followedSource)

    await openDiscoverWithForwards(page, {
      carrierName,
      followedSource,
      unfollowedSources: [unfollowedSource],
    })

    const channelLink = page.getByTestId(
      `discover-channel-link-${unfollowedSource}`,
    )
    await expect(channelLink).toHaveAttribute(
      "href",
      new RegExp(`/s/${unfollowedSource}`),
    )
    await expect(channelLink).toHaveAttribute("target", "_blank")

    const followedLink = page.getByTestId(
      `discover-channel-link-${followedSource}`,
    )
    await expect(followedLink).toHaveAttribute(
      "href",
      new RegExp(`/s/${followedSource}`),
    )

    const forwardedByLink = page
      .getByTestId(`discover-seen-in-link-${carrierName}`)
      .first()
    await expect(forwardedByLink).toHaveAttribute(
      "href",
      new RegExp(`/s/${carrierName}`),
    )
  })

  test("discover followed row checkbox is checked and disabled", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const followedSource = `dsfoll${stamp}`
    const unfollowedSource = `dsunf${stamp}`

    await gotoSummarizer(page, "channels")
    await seedTestChannel(page, carrierName)
    await seedTestChannel(page, followedSource)

    await openDiscoverWithForwards(page, {
      carrierName,
      followedSource,
      unfollowedSources: [unfollowedSource],
    })

    const followedCheckbox = page.getByTestId(
      `discover-select-${followedSource}`,
    )
    await expect(followedCheckbox).toBeChecked()
    await expect(followedCheckbox).toBeDisabled()

    const unfollowedCheckbox = page.getByTestId(
      `discover-select-${unfollowedSource}`,
    )
    await expect(unfollowedCheckbox).not.toBeChecked()
    await expect(unfollowedCheckbox).toBeEnabled()
  })

  test("discover follow selected sends one bulk-follow POST", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const sources = [`dsunfa${stamp}`, `dsunfb${stamp}`]

    await gotoSummarizer(page, "channels")
    await seedTestChannel(page, carrierName)

    const bulkFollow = await mockBulkFollowJob(page)
    await openDiscoverWithForwards(page, {
      carrierName,
      unfollowedSources: sources,
    })

    for (const source of sources) {
      await page.getByTestId(`discover-select-${source}`).click()
    }
    await expect(page.getByTestId("discover-bulk-bar")).toBeVisible()
    // Scoped to the bulk bar: "2 selected" also appears in the channel scope
    // line ("Channels: 2 selected"), so an unscoped locator matches twice and
    // fails Playwright's strict mode.
    await expect(
      page.getByTestId("discover-bulk-bar").getByText("2 selected"),
    ).toBeVisible()

    const dialogs: string[] = []
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })

    await page.getByTestId("discover-follow-selected").click()

    await expect.poll(() => bulkFollow.getPostCount()).toBe(1)
    expect(dialogs).toHaveLength(0)

    const body = bulkFollow.getPostBodies()[0] as {
      channels: Array<{ name: string }>
    }
    expect(body.channels.map((c) => c.name).sort()).toEqual([...sources].sort())

    await expect(page.getByText(/Follow finished/i)).toBeVisible({
      timeout: 15_000,
    })
  })

  test("discover follow selected confirms when selection is at least 5", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const sources = Array.from(
      { length: 5 },
      (_, index) => `dsunf${index}${stamp}`,
    )

    await gotoSummarizer(page, "channels")
    await seedTestChannel(page, carrierName)

    const bulkFollow = await mockBulkFollowJob(page)
    await openDiscoverWithForwards(page, {
      carrierName,
      unfollowedSources: sources,
    })

    await page.getByTestId("discover-select-all").click()
    await expect(page.getByText("5 selected")).toBeVisible()

    await page.getByTestId("discover-follow-selected").click()
    const confirmDialog = page.getByRole("dialog")
    await expect(confirmDialog).toBeVisible()
    await expect(confirmDialog.getByText(/Follow 5 channels/)).toBeVisible()
    await confirmDialog.getByRole("button", { name: "Cancel" }).click()
    await expect(confirmDialog).not.toBeVisible()
    await expect.poll(() => bulkFollow.getPostCount()).toBe(0)

    await page.getByTestId("discover-follow-selected").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Follow" })
      .click()
    await expect.poll(() => bulkFollow.getPostCount()).toBe(1)

    const body = bulkFollow.getPostBodies()[0] as {
      channels: Array<{ name: string }>
    }
    expect(body.channels).toHaveLength(5)
  })

  test("tag tab paste applies tags for all selected channels", async ({
    page,
  }) => {
    test.setTimeout(90_000)

    await gotoSummarizer(page, "channels")
    const first = await seedTestChannel(page)
    const second = await seedTestChannel(page)
    const third = await seedTestChannel(page)
    const tagName = `bulk${Date.now()}`

    await page.route("**/api/v1/ai/tag/prompt", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prompt: "tag prompt for e2e" }),
      })
    })

    await page.getByPlaceholder("Search channels...").fill("")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear selection")
    await closePaletteKeyboard(page)
    await selectChannelsKeyboard(page, [first, second, third])

    for (const name of [first, second, third]) {
      await expect(
        page.locator(
          `[data-channel-name="${name}"] button[aria-pressed="true"]`,
        ),
      ).toBeVisible()
    }

    await page.locator("#tour-tab-tag").click()
    await expect(page.getByText("3 selected channel(s)")).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(/batch/i)).not.toBeVisible()

    await page.getByRole("button", { name: "Copy Prompt" }).click()
    await expect(
      page.getByText(/tag prompt copied/i, { exact: false }),
    ).toBeVisible({ timeout: 15_000 })

    const pastePayload = JSON.stringify({
      [`@${first}`]: [tagName],
      [second]: [tagName],
      [third]: [tagName],
    })

    await page.getByRole("button", { name: "Paste Response" }).click()
    await page.locator("textarea").fill(pastePayload)
    await page.getByRole("button", { name: "Save Response" }).click()
    await expect(
      page.getByText(/Parsed tag suggestions for 3 channel/i),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("(3 channels)")).toBeVisible()

    await page.getByRole("button", { name: "Apply" }).click()
    await expect(page.getByText(/Added .* tags to 3 channels/i)).toBeVisible({
      timeout: 15_000,
    })

    for (const name of [first, second, third]) {
      await expect.poll(() => channelHasTag(page, name, tagName)).toBe(true)
    }
  })

  test("settings tab opens Settings hub with network section", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=summary")
    // Prefer role locators: `#nav-tab-*` CSS ids are flaky under Playwright
    // Chrome (document ID map sometimes misses React-assigned ids).
    await expect(
      page.getByRole("button", { name: "Summary", exact: true }).first(),
    ).toBeVisible()

    await page
      .getByRole("button", { name: "Settings", exact: true })
      .first()
      .click()
    await page.getByRole("button", { name: "Network", exact: true }).click()

    await expect(page.getByTestId("settings-search")).toBeVisible()
    await expect(page).toHaveURL(/tab=settings/)
    await expect(page).toHaveURL(/section=network/)
  })

  test("summary tab shows Copy Prompt button", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")

    await expect(
      page.locator("button").filter({ hasText: "Copy Prompt" }).first(),
    ).toBeVisible()
    await expect(
      page.locator("button").filter({ hasText: "Generate Summary" }).first(),
    ).toBeVisible()
  })

  test("command palette opens via shortcut and header button", async ({
    page,
  }) => {
    await page.goto("/summarizer")

    const palette = page.getByTestId("command-palette")
    await expect(palette).not.toBeVisible()

    await page.locator("main").click({ position: { x: 8, y: 8 } })
    const modifier = process.platform === "darwin" ? "Meta" : "Control"
    await page.keyboard.press(`${modifier}+Shift+P`)
    await expect(palette).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(palette).not.toBeVisible()

    await page.getByTestId("command-palette-button").click()
    await expect(palette).toBeVisible()
  })

  test("command palette navigates to channels tab", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")
    await page.getByTestId("command-palette-button").click()

    await page.getByPlaceholder("Type a command...").fill("channels")
    await page.getByRole("option", { name: "Go to Channels" }).click()

    await expect(page).toHaveURL(/tab=channels/)
    await expect(page.locator("#tour-tab-channels")).toHaveClass(
      /border-app-ink/,
    )
  })

  test("command palette toggles theme", async ({ page }) => {
    await page.goto("/summarizer")
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "light"))
    await page.reload()

    const html = page.locator("html")
    await expect(html).toHaveClass(/light/)

    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("toggle theme")
    await page.getByRole("option", { name: "Toggle Theme" }).click()

    await expect(html).toHaveClass(/dark/)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("vite-ui-theme")))
      .toBe("dark")
  })

  test("command palette copies all channel names", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("copy list of all channels")
    await page
      .getByRole("option", { name: "Copy List of All Channels" })
      .click()

    await expect(page.getByText(/Copied \d+ channels?/i)).toBeVisible({
      timeout: 15_000,
    })
  })

  test("command palette export selected channels uses jsonl", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    const channelName = await seedTestChannel(page)

    await page.locator("button.uppercase", { hasText: "None" }).click()
    await page
      .getByRole("button", { name: `Select ${channelName}`, exact: true })
      .click()

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("export list of selected channels")

    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
    await page
      .getByRole("option", { name: "Export List of Selected Channels" })
      .click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.jsonl$/)
  })

  test("import command shows confirmation before file picker", async ({
    page,
  }) => {
    await page.goto("/summarizer")

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("import list of all channels")
    await page
      .getByRole("option", { name: "Import List of All Channels" })
      .click()

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
  })

  test("command palette sync channel opens entity picker", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("sync channel")
    await page
      .getByRole("option", { name: "Sync Channel", exact: true })
      .click()
    await expect(
      page.getByPlaceholder("Name, display name, tag, #tag, or tag:tag..."),
    ).toBeVisible()
  })

  test("command palette delete channel shows confirm after pick", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("delete channel")
    const deleteOption = page.getByRole("option", {
      name: /Delete Channel/,
    })
    await expect(deleteOption).toBeVisible({ timeout: 10_000 })
    if (await deleteOption.isDisabled()) return

    await deleteOption.click()
    const channelOption = page
      .getByRole("option")
      .filter({ hasText: "@" })
      .first()
    if (!(await channelOption.isVisible())) return

    await channelOption.click()
    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await expect(page.getByText(/Delete @/)).toBeVisible()
  })

  test("command palette search posts opens in-palette results", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=posts")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("search posts")
    await page
      .getByRole("option", { name: "Search Posts", exact: true })
      .click()
    await page.getByRole("button", { name: "Apply" }).click()
    await expect(
      page.getByTestId("command-palette-search-results"),
    ).toBeVisible({ timeout: 30_000 })
  })

  test("command palette search summaries opens in-palette results", async ({
    page,
  }) => {
    await gotoSummarizer(page, "summary")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("search summaries")
    await page
      .getByRole("option", { name: "Search Summaries", exact: true })
      .click()
    await page.getByRole("button", { name: "Apply" }).click()
    await expect(
      page.getByTestId("command-palette-search-results"),
    ).toBeVisible({ timeout: 30_000 })
  })

  test("command palette reload channels command is available", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=channels")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("reload channels")
    await expect(
      page.getByRole("option", { name: "Reload Channels", exact: true }),
    ).toBeVisible()
  })

  test("command palette clear post filters command is available", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=posts")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("clear post filters")
    await expect(
      page.getByRole("option", { name: "Clear Post Filters", exact: true }),
    ).toBeVisible()
  })

  test("command palette fix all partial history command is available", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await seedPartialHistoryChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("fix all partial history")
    await expect(
      page.getByRole("option", {
        name: "Fix All Partial History",
        exact: true,
      }),
    ).toBeVisible()
  })

  test("command palette fix partial history opens filtered entity picker", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    const partialChannel = await seedPartialHistoryChannel(page)
    await seedTestChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("fix partial history channel")
    await page
      .getByRole("option", {
        name: "Fix Partial History (Channel)",
        exact: true,
      })
      .click()

    const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
    await expect(entityInput).toBeVisible()
    await entityInput.fill(partialChannel)
    await expect(
      page.getByRole("option", { name: new RegExp(`@${partialChannel}`) }),
    ).toBeVisible()
    await expect(page.getByRole("option", { name: /@e2e/ })).not.toBeVisible()
  })

  test("command palette show starred summaries toggles badge", async ({
    page,
  }) => {
    await gotoSummarizer(page, "summary")
    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("show starred summaries")
    const option = page.getByRole("option", {
      name: /Show Starred Summaries Only/,
    })
    await expect(option).toBeVisible()
    await expect(option).toContainText("OFF")
    await option.click()
    await expect(page.getByTestId("command-palette")).not.toBeVisible()
    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("show starred summaries")
    await expect(
      page.getByRole("option", { name: /Show Starred Summaries Only/ }),
    ).toContainText("ON", { timeout: 10_000 })
  })
})

test.describe("command palette keyboard", () => {
  test("K1: opens and closes via keyboard shortcut", async ({ page }) => {
    await page.goto("/summarizer")
    const palette = page.getByTestId("command-palette")
    await expect(palette).not.toBeVisible()

    await openPaletteKeyboard(page)
    await page.keyboard.press("Escape")
    await expect(palette).not.toBeVisible()
  })

  test("K2: navigates to channels tab via type and Enter", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "channels")
    await expect(page).toHaveURL(/tab=channels/)
  })

  test("K3: toggles theme via type and Enter", async ({ page }) => {
    await page.goto("/summarizer")
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "light"))
    await page.reload()

    const html = page.locator("html")
    await expect(html).toHaveClass(/light/)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "toggle theme")

    await expect(html).toHaveClass(/dark/)
  })

  test("K4: sync channel entity pick via keyboard", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const channelName = await seedTestChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "sync channel")
    await page
      .getByPlaceholder("Name, display name, tag, #tag, or tag:tag...")
      .fill(channelName)
    await page.keyboard.press("Enter")

    await expect(page.getByText(/sync/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test("K5: multi-pick select channel stays open", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const first = await seedTestChannel(page)
    const second = await seedTestChannel(page)

    await page.getByPlaceholder("Search channels...").fill("")

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear selection")
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("command-palette")).not.toBeVisible()

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "select channel")

    const entityInput = page.getByPlaceholder(
      "Name, display name, tag, #tag, or tag:tag...",
    )
    const pickChannel = async (name: string) => {
      await entityInput.fill(name)
      await entityInput.press("Enter")
    }

    await pickChannel(first)
    await expect(page.getByTestId("command-palette")).toBeVisible()

    await pickChannel(second)

    const palette = page.getByTestId("command-palette")
    if (await palette.isVisible()) {
      await page.keyboard.press("Escape")
      if (await palette.isVisible()) {
        await page.keyboard.press("Escape")
      }
    }
    await expect(palette).not.toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${first}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${second}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
  })

  test("K6: add channel editor apply via Enter", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const channelName = `kbd${Date.now()}`

    await page.route("**/api/v1/telegram/channel-info", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ displayName: channelName, telemetry: {} }),
      })
    })

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "add channel")
    const channelHandle = page.getByLabel(/Channel handle/i)
    await channelHandle.fill(channelName)
    await channelHandle.press("Enter")

    await expect(page.getByTestId("command-palette")).toBeVisible()
    await expect(
      page.locator("#tour-channel-grid").getByText(`@${channelName}`),
    ).toBeVisible({
      timeout: 15_000,
    })
  })

  test("K7: search posts opens results and picks via keyboard", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=posts")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "search posts")
    await page.getByLabel(/Search posts/i).fill("test")
    await page.keyboard.press("Enter")

    const results = page.getByTestId("command-palette-search-results")
    await expect(results).toBeVisible({ timeout: 30_000 })

    const firstResult = page.getByRole("option").first()
    if (!(await firstResult.isVisible())) return

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("command-palette")).not.toBeVisible()
    await expect(page).toHaveURL(/tab=posts/)
  })

  test("K8: delete channel confirm dismisses via Escape", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const channelName = await seedTestChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "delete channel")
    await page
      .getByPlaceholder("Name, display name, tag, #tag, or tag:tag...")
      .fill(channelName)
    await page.keyboard.press("Enter")

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("command-palette-confirm")).not.toBeVisible()
    await expect(
      page.locator("#tour-channel-grid").getByText(`@${channelName}`),
    ).toBeVisible()
  })

  test("K9: clear cache confirm proceeds via Tab and Enter", async ({
    page,
  }) => {
    await page.goto("/summarizer")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear cache")

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("command-palette")).not.toBeVisible({
      timeout: 15_000,
    })
  })

  test("K10: entity view Backspace on empty filter returns to root", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "sync channel")
    await expect(
      page.getByPlaceholder("Name, display name, tag, #tag, or tag:tag..."),
    ).toBeVisible()

    await page.keyboard.press("Backspace")
    await expect(page.getByPlaceholder("Type a command...")).toBeVisible()
  })

  test("K12: add tag chain via keyboard", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const channelName = await seedTestChannel(page)
    const tagName = `tag${Date.now()}`

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "add tag")
    await pickEntityChannelKeyboard(page, channelName)

    const tagInput = page.locator("#command-palette-editor")
    await expect(tagInput).toBeVisible()
    await tagInput.fill(tagName)
    await tagInput.press("Enter")

    await expect(page.getByTestId("command-palette")).not.toBeVisible({
      timeout: 15_000,
    })
    await expect
      .poll(() => channelHasTag(page, channelName, tagName))
      .toBe(true)
    await expect(
      page.locator(`[data-channel-name="${channelName}"]`).getByText(tagName),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("K13: remove tag chain via keyboard", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const tagName = `rm${Date.now()}`
    const channelName = await seedTestChannel(page, undefined, [tagName])

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "remove tag")
    await pickEntityChannelKeyboard(page, channelName)

    const tagFilter = page.getByPlaceholder("Filter...")
    await expect(tagFilter).toBeVisible()
    await tagFilter.fill(tagName)
    await tagFilter.press("Enter")

    await expect(page.getByTestId("command-palette")).not.toBeVisible({
      timeout: 15_000,
    })
    await expect
      .poll(() => channelHasTag(page, channelName, tagName))
      .toBe(false)
    await expect(
      page.locator(`[data-channel-name="${channelName}"]`).getByText(tagName),
    ).not.toBeVisible()
  })

  test("K14: search-results back preserves editor query", async ({ page }) => {
    const searchQuery = `kbdquery${Date.now()}`
    await page.goto("/summarizer?tab=posts")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "search posts")

    const editorInput = page.locator("#command-palette-editor")
    await editorInput.fill(searchQuery)
    await editorInput.press("Enter")

    await expect(
      page.getByTestId("command-palette-search-results"),
    ).toBeVisible({ timeout: 30_000 })

    const resultsFilter = page.getByPlaceholder("Filter results...")
    await resultsFilter.fill("")
    await resultsFilter.press("Backspace")

    await expect(editorInput).toBeVisible()
    await expect(editorInput).toHaveValue(searchQuery)
  })

  test("K11: offline mode skips disabled sync all", async ({ page }) => {
    await page.route("**/api/v1/utils/health-check/**", (route) =>
      route.abort("failed"),
    )
    await page.goto("/summarizer")
    await expect(page.getByText("Server offline.")).toBeVisible({
      timeout: 15_000,
    })

    await openPaletteKeyboard(page)
    await page.getByPlaceholder("Type a command...").fill("sync all")

    const syncAll = page.locator(
      '[data-slot="command-item"][data-value="sync-all"]',
    )
    await expect(syncAll).toBeVisible()
    await expect(syncAll).toHaveAttribute("aria-disabled", "true")
    await page.keyboard.press("ArrowDown")
    await expect(syncAll).not.toHaveAttribute("data-selected", "true")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("command-palette")).toBeVisible()
  })

  test("K15: clear indexeddb table confirm cancel via keyboard", async ({
    page,
  }) => {
    await gotoSummarizer(page, "summary")

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear indexeddb")
    await pickEntityFilterKeyboard(page, "translations")

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("command-palette-confirm")).not.toBeVisible()
    await expect(page.getByPlaceholder("Filter...")).toBeVisible()
  })

  test("K16: deselect channel multi-pick via keyboard", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const first = await seedTestChannel(page)
    const second = await seedTestChannel(page)

    await selectChannelsKeyboard(page, [first, second])

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "deselect channel")

    const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
    for (const name of [first, second]) {
      await entityInput.fill(name)
      await entityInput.press("Enter")
      await expect(page.getByTestId("command-palette")).toBeVisible()
    }

    await closePaletteKeyboard(page)
    await expect(
      page.locator(
        `[data-channel-name="${first}"] button[aria-pressed="true"]`,
      ),
    ).not.toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${second}"] button[aria-pressed="true"]`,
      ),
    ).not.toBeVisible()
  })

  test("K17: freeze and unfreeze channel via keyboard", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    const channelName = await seedTestChannel(page)
    const card = page.locator(`[data-channel-name="${channelName}"]`)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "freeze channel")
    await pickEntityChannelKeyboard(page, channelName)
    await closePaletteKeyboard(page)

    await expect(card.getByText("Frozen", { exact: true })).toBeVisible({
      timeout: 15_000,
    })

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "unfreeze channel")
    await pickEntityChannelKeyboard(page, channelName)
    await closePaletteKeyboard(page)

    await expect(card.getByText("Frozen", { exact: true })).not.toBeVisible()
  })

  test("K18: fix partial history channel stays open after confirm", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    const first = await seedPartialHistoryChannel(page)
    const second = await seedPartialHistoryChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "fix partial history channel")

    const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
    for (const name of [first, second]) {
      await entityInput.fill(name)
      await entityInput.press("Enter")
      await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
      await page.getByTestId("command-palette-confirm-confirm").click()
      await expect(page.getByTestId("command-palette")).toBeVisible()
      await expect(entityInput).toBeVisible()
    }

    await closePaletteKeyboard(page)
  })

  test("channel grid loads more cards on first visit when scrolling", async ({
    page,
  }) => {
    const prefix = `scroll${Date.now()}`
    await gotoSummarizer(page, "summary")
    await seedBulkChannels(page, 25, prefix)

    await page.goto("/summarizer?tab=channels")
    await expect(page.getByTestId("command-palette-button")).toBeVisible()
    await page.getByPlaceholder("Search channels...").fill(prefix)

    const seededCards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(seededCards).toHaveCount(20, { timeout: 30_000 })

    const scrollContainer = page.getByTestId("workspace-scroll")
    await scrollContainer.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    await expect(seededCards).toHaveCount(25, { timeout: 10_000 })
  })

  test("posts media filter controls persist and filter rendered cards", async ({
    page,
  }) => {
    const channelName = `media${Date.now()}`
    const now = Date.now()

    await gotoSummarizer(page, "channels")
    await seedTestChannel(page, channelName)

    await page.route("**/api/v1/data/sync-meta**", async (route) => {
      await route.fulfill({
        json: {
          channels: {
            etag: "playwright-channels",
            updatedAt: new Date().toISOString(),
          },
          posts: {
            etag: "playwright-posts",
            updatedAt: new Date().toISOString(),
          },
        },
      })
    })

    await page.route("**/api/v1/data/posts**", async (route) => {
      await route.fulfill({
        json: [
          {
            id: 1,
            channelName,
            text: "Caption only",
            date: new Date(now).toISOString(),
            timestamp: now,
          },
          {
            id: 2,
            channelName,
            text: "[photo]",
            date: new Date(now - 1000).toISOString(),
            timestamp: now - 1000,
            media: {
              kinds: ["photo"],
              isMediaOnly: true,
              views: "1.2K",
              thumbApiPath: "/api/v1/telegram/post-thumb/demo/2",
            },
          },
        ],
      })
    })

    await page.evaluate(() => {
      localStorage.removeItem("sync_etag_posts")
    })

    await selectChannelsKeyboard(page, [channelName])
    await gotoSummarizer(page, "posts")

    await expect(page.getByTestId("post-media-filter-photo")).toBeVisible()
    await page.getByTestId("post-media-filter-photo").click()

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("postFilter_media")))
      .toBe("photo")

    await expect(page.getByTestId("post-card-media-badge-photo")).toBeVisible()
    await expect(page.getByText("Caption only")).not.toBeVisible()
  })

  test("trim channel selection keeps first N by activity rate sort", async ({
    page,
  }) => {
    test.setTimeout(90_000)

    const prefix = `trimtest${Date.now()}`
    const channelNames = Array.from(
      { length: 5 },
      (_, index) => `${prefix}${index}`,
    )

    await gotoSummarizer(page, "channels")

    await page.evaluate(
      async ({ names }) => {
        const token = localStorage.getItem("access_token")
        if (!token) {
          throw new Error("trim test: missing access_token")
        }

        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        }

        await Promise.all(
          names.map((name) =>
            fetch(`/api/v1/data/channels/${name}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ id: name, name }),
            }).then(async (response) => {
              if (!response.ok) {
                throw new Error(
                  `trim test seed failed (${response.status}): ${await response.text()}`,
                )
              }
            }),
          ),
        )
      },
      { names: channelNames },
    )

    await page.route("**/api/v1/data/channels**", async (route) => {
      const response = await route.fetch()
      const body = await response.json()

      const augmentChannel = (channel: {
        name: string
        stats?: Record<string, unknown>
      }) => {
        const index = channelNames.indexOf(channel.name)
        if (index === -1) return channel
        return {
          ...channel,
          stats: {
            count: 10,
            minId: 1,
            maxId: 10,
            velocity: index + 1,
          },
        }
      }

      const json = Array.isArray(body)
        ? body.map(augmentChannel)
        : augmentChannel(body)

      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        json,
      })
    })

    await page.evaluate(() => {
      localStorage.setItem("channelGrid_sortBy", "activity_rate")
      localStorage.setItem("channelGrid_sortDirection", "asc")
      localStorage.removeItem("sync_etag_channels")
    })

    await page.reload()
    await expect(page.getByTestId("command-palette-button")).toBeVisible()

    await page.getByPlaceholder("Search channels...").fill(prefix)
    for (const name of channelNames) {
      await expect(page.locator(`[data-channel-name="${name}"]`)).toBeVisible({
        timeout: 15_000,
      })
    }

    await page.locator("button.uppercase", { hasText: "None" }).click()
    await page.locator("button.uppercase", { hasText: "All" }).first().click()
    await expect(page.getByText("5 Selected")).toBeVisible()

    await page.getByTestId("channel-trim-count").fill("2")
    await page.getByTestId("channel-trim-button").click()

    await expect(page.getByText("2 Selected")).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${channelNames[0]}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${channelNames[1]}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${channelNames[2]}"] button[aria-pressed="true"]`,
      ),
    ).not.toBeVisible()

    await page.getByTestId("channel-trim-count").fill("5")
    await page.getByTestId("channel-trim-button").click()
    await expect(page.getByText(/Already 2 or fewer selected/i)).toBeVisible()
    await expect(page.getByText("2 Selected")).toBeVisible()
  })
})
