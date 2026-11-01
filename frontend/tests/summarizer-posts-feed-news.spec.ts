/**
 * The Posts feed against the real app, its reads mocked: [ and ] walk a reply
 * chain, a refetch that brings a Post in above the reader holds it behind the
 * new-posts pill, and the first load's skeleton takes the Compact grid's shape.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

async function mockPosts(page: Page, channel: string) {
  const now = Date.now()
  const post = (id: number, text: string, replyToPostId?: number) => ({
    id,
    channelName: channel,
    text,
    date: new Date(now - id * 60_000).toISOString(),
    timestamp: now - id * 60_000,
    ...(replyToPostId ? { replyToPostId, replyTo: { channel } } : {}),
  })
  // 1 answers 3, which the feed shows; 3 answers 99, which it does not.
  const feed = [
    post(1, "the reply", 3),
    post(2, "unrelated"),
    post(3, "the middle", 99),
  ]
  const state = { feed, delay: 0 }
  await page.route("**/api/v1/data/posts**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/data/posts") {
      await route.continue()
      return
    }
    if (state.delay) await new Promise((r) => setTimeout(r, state.delay))
    await route.fulfill({ json: state.feed })
  })
  await page.route("**/api/v1/data/posts/counts**", (route) =>
    route.fulfill({
      json: { counts: { [channel]: 3 }, selected: {}, tooNewToJudge: 0 },
    }),
  )
  await page.route("**/api/v1/data/posts/lookup", (route) =>
    route.fulfill({ json: [post(99, "the root question")] }),
  )
  return { state, post }
}

async function openPosts(page: Page) {
  await gotoWorkspace(page, "channels")
  const channel = await seedTestChannel(page, undefined, [], {
    lastUpdated: Date.now(),
  })
  const mock = await mockPosts(page, channel)
  await clearChannelSelection(page)
  await selectChannelsKeyboard(page, [channel])
  await page.locator("#tour-tab-posts").click()
  await expect(page.getByText("the reply")).toBeVisible()
  return mock
}

const highlighted = (page: Page) =>
  page.locator("article[data-highlight]").getAttribute("data-post-key")

test("[ climbs a reply chain through the feed and into the panel; ] comes back", async ({
  page,
}) => {
  await openPosts(page)
  await page.locator("h1").first().click()
  await page.keyboard.press("\\")
  await page.keyboard.press("j")
  expect(await highlighted(page)).toMatch(/_1$/)

  // The parent is in the feed: the Highlight moves onto it.
  await page.keyboard.press("[")
  await expect.poll(() => highlighted(page)).toMatch(/_3$/)

  // Its parent is not: the panel shows it, the Highlight stays.
  await page.keyboard.press("[")
  const panel = page.getByRole("complementary", { name: "Reply chain" })
  await expect(panel.getByText("the root question")).toBeVisible()
  expect(await highlighted(page)).toMatch(/_3$/)

  await page.keyboard.press("]")
  await expect(panel).toHaveCount(0)
  await page.keyboard.press("]")
  await expect.poll(() => highlighted(page)).toMatch(/_1$/)
})

test("a Post that arrives above the reader waits behind the pill", async ({
  page,
}) => {
  const { state, post } = await openPosts(page)
  state.feed = [post(0, "brand new"), ...state.feed]
  // Select all is a rule, which refetches the feed.
  await page.getByRole("button", { name: "Select all", exact: true }).click()
  const pill = page.getByRole("button", { name: "1 new post" })
  await expect(pill).toBeVisible()
  await expect(page.getByText("brand new")).toHaveCount(0)
  await pill.click()
  await expect(page.getByText("brand new")).toBeVisible()
  await expect(pill).toHaveCount(0)
})

test("the first load's skeleton is a grid when the Compact grid is on", async ({
  page,
}) => {
  const { state } = await openPosts(page)
  const compact = page.getByRole("button", { name: "Compact grid" })
  if ((await compact.getAttribute("aria-pressed")) !== "true")
    await compact.click()
  state.delay = 3000
  await page.reload()
  await expect(
    page.locator('.grid [data-slot="skeleton"]').first(),
  ).toBeVisible()
})
