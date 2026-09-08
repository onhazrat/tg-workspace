import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

import {
  clearScopedStorage,
  readScopedStorage,
  seedScopedStorage,
} from "./scoped-storage.ts"

export function paletteModifier() {
  return process.platform === "darwin" ? "Meta" : "Control"
}

export async function openPaletteKeyboard(page: Page) {
  await page.locator("main").click({ position: { x: 8, y: 8 } })
  await page.keyboard.press(`${paletteModifier()}+Shift+P`)
  await expect(page.getByTestId("command-palette")).toBeVisible()
}

export async function runPaletteCommand(page: Page, query: string) {
  await page.getByPlaceholder("Type a command...").fill(query)
  await page.keyboard.press("Enter")
}

export const entityChannelInputPlaceholder =
  "Name, display name, tag, #tag, or tag:tag..."

export async function pickEntityChannelKeyboard(
  page: Page,
  channelName: string,
) {
  const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
  await entityInput.fill(channelName)
  await entityInput.press("Enter")
}

export async function pickEntityFilterKeyboard(page: Page, value: string) {
  const entityInput = page.getByPlaceholder("Filter...")
  await entityInput.fill(value)
  await entityInput.press("Enter")
}

export async function closePaletteKeyboard(page: Page) {
  const palette = page.getByTestId("command-palette")
  if (!(await palette.isVisible())) return
  await page.keyboard.press("Escape")
  if (await palette.isVisible()) {
    await page.keyboard.press("Escape")
  }
  await expect(palette).not.toBeVisible()
}

export async function selectChannelsKeyboard(
  page: Page,
  channelNames: string[],
) {
  await openPaletteKeyboard(page)
  await runPaletteCommand(page, "select channel")
  const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
  for (const name of channelNames) {
    await entityInput.fill(name)
    await entityInput.press("Enter")
  }
  await closePaletteKeyboard(page)
}

export async function channelHasTag(
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

export async function gotoWorkspace(page: Page, tab = "summary") {
  await page.goto(`/workspace?tab=${tab}`)
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

export const DISCOVER_SIGNAL_KINDS = ["forward", "mention", "link"] as const
type DiscoverSignalKind = (typeof DISCOVER_SIGNAL_KINDS)[number]

/**
 * Signal chips are schema-backed, so they survive reloads *and leak between
 * specs*. Blind clicking therefore toggles whatever the previous spec left
 * behind; set the desired state explicitly instead.
 */
export async function setDiscoverSignal(
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

export async function setDiscoverSignals(
  page: Page,
  enabled: Record<DiscoverSignalKind, boolean>,
) {
  for (const kind of DISCOVER_SIGNAL_KINDS) {
    await setDiscoverSignal(page, kind, enabled[kind])
  }
}

export async function mockDiscoverForwardPosts(
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
    // The feed and the plain listing are both POST now (the channel selection
    // travels in the body), so match on the path instead of the method: the
    // sibling POSTs under /posts/ have their own handlers registered later,
    // which win because Playwright evaluates newest-first.
    if (new URL(route.request().url()).pathname !== "/api/v1/data/posts") {
      await route.continue()
      return
    }
    await route.fulfill({ json: posts })
  })

  // Discover is computed server-side now, so mock its endpoint directly rather
  // than relying on the client aggregating the mocked /posts. Built from the
  // same fixture sources so the two stay consistent. Registered after the
  // generic /posts route so it wins for this more specific path (Playwright
  // evaluates handlers newest-first).
  const emptyCounts = () => ({ forward: 0, mention: 0, link: 0 })
  const sources: { name: string; isFollowed: boolean }[] = [
    ...(fixture.followedSource
      ? [{ name: fixture.followedSource, isFollowed: true }]
      : []),
    ...fixture.unfollowedSources.map((name) => ({ name, isFollowed: false })),
  ]
  const candidates = sources.map((source, index) => ({
    name: source.name,
    displayName: source.name,
    counts: { forward: 1, mention: 0, link: 0 },
    total: 1,
    seenIn: [
      {
        channelName: fixture.carrierName,
        counts: { forward: 1, mention: 0, link: 0 },
        total: 1,
      },
    ],
    seenInCount: 1,
    lastSeen: now - index * 1000,
    isFollowed: source.isFollowed,
    reference: {
      channelName: fixture.carrierName,
      postId: 900_000_000 + index,
      timestamp: now - index * 1000,
    },
  }))
  const discoverResponse = {
    candidates,
    scopeCounts: {
      ...emptyCounts(),
      forwardPosts: sources.length,
      mentionPosts: 0,
      linkPosts: 0,
    },
    // Posts surviving the scope filters: forwards plus any original posts.
    postsInScope: sources.length + (fixture.originalPostCount ?? 0),
  }

  // Generating now saves a report, so the response carries the stored-artifact
  // envelope (id, frozen scope, timestamp) around the same aggregate.
  const discoverReport = {
    id: "e2e-report-1",
    scope: {
      channels: [fixture.carrierName],
      startDate: 0,
      endDate: now,
      signals: ["forward", "mention", "link"],
      keyword: null,
      forwarded: "all",
      media: "all",
      maxPerChannel: 0,
      maxPerChannelMode: "latest",
      seed: 0,
      scopedPostCount: null,
    },
    timestamp: now,
    candidateCount: candidates.length,
    ...discoverResponse,
  }

  await page.route("**/api/v1/data/discover/candidates**", async (route) => {
    await route.fulfill({ json: discoverResponse })
  })

  // One handler for every report route: overlapping glob patterns are matched
  // last-registered-first by Playwright, which makes separate routes for
  // `/reports`, `/reports/latest` and `/reports/{id}` order-dependent.
  // Acts as the store, so a report fetched by id matches the one generated.
  let storedReport = discoverReport

  await page.route("**/api/v1/data/discover/reports**", async (route) => {
    const url = route.request().url()
    if (route.request().method() === "POST") {
      // Echo the requested scope back. A saved report describes the inputs it
      // actually ran with, and the empty-state guide is derived from *that*
      // rather than from the live signal chips — so a mock returning a fixed
      // scope would make the guide disagree with what the test asked for.
      const body = route.request().postDataJSON() ?? {}
      storedReport = {
        ...discoverReport,
        scope: {
          ...discoverReport.scope,
          signals: body.signals ?? discoverReport.scope.signals,
          forwarded: body.forwarded ?? "all",
          media: body.media ?? "all",
          keyword: body.keyword ?? null,
        },
      }
      await route.fulfill({ json: storedReport })
      return
    }
    if (url.includes("/reports/latest")) {
      // These specs start with no saved report.
      await route.fulfill({ json: null })
      return
    }
    if (url.includes(`/reports/${discoverReport.id}`)) {
      await route.fulfill({ json: storedReport })
      return
    }
    await route.fulfill({ json: [] })
  })

  await page.route("**/api/v1/data/posts/counts**", async (route) => {
    // Per-channel scope counts; the carrier is the only channel in scope here.
    await route.fulfill({
      json: { [fixture.carrierName]: posts.length },
    })
  })

  await clearScopedStorage(page, ["sync_etag_posts"])
  await seedScopedStorage(page, {
    startDateTs: String(now - 14 * 24 * 60 * 60 * 1000),
    endDateTs: String(now + 60_000),
    postFilter_maxPerChannel: "0",
    // Persisted across specs; a leftover media filter would empty the scope.
    postFilter_media: "all",
  })
}

export function completedFollowJobStatus(
  followJobId: string,
  channelNames: string[],
) {
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
export async function mockBulkFollowJob(
  page: Page,
  followJobId = "e2e-follow-job",
) {
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
export async function pinSelectionToCarrier(page: Page, carrierName: string) {
  await gotoWorkspace(page, "channels")
  // Seeded channels auto-select once the channel list arrives, which under
  // load lands *after* the clear+select above and silently clobbers it. The
  // carrier then ends up unselected, posts are read from IDB filtered to other
  // channels, and the spec fails with a "no posts in scope" far from the cause.
  // Retry until the pin sticks rather than asserting a racy first attempt.
  const expected = JSON.stringify([carrierName])
  const readSelection = async () =>
    (await readScopedStorage(page, "selectedChannels")) ?? "[]"

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
  await clearScopedStorage(page, ["sync_etag_posts"])
}

export async function openDiscoverWithForwards(
  page: Page,
  fixture: DiscoverForwardFixture,
) {
  await mockDiscoverForwardPosts(page, fixture)
  await pinSelectionToCarrier(page, fixture.carrierName)

  await gotoWorkspace(page, "discover")
  await expect(
    page.getByRole("heading", { name: "Channel Candidates" }),
  ).toBeVisible()

  // Generating moved to the Action tab — Discover renders results only, and no
  // longer auto-opens the most recent report. Click through rather than
  // `gotoWorkspace`: a full page load would discard the pinned selection.
  await page.locator("#tour-tab-action").click()
  await page.getByTestId("action-generate-report").click()
  await expect(page).toHaveURL(/tab=discover/, { timeout: 30_000 })

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
