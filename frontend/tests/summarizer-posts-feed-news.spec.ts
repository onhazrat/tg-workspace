/**
 * Held new Posts and the first load's skeleton (RCH-01), against the real app
 * with the posts reads mocked: a refetch that brings a Post in above what is
 * shown holds it behind the pill until a click or `.`, another list is never
 * held, and the skeleton takes the shape of the layout that will load.
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
  const post = (id: number, text: string) => ({
    id,
    channelName: channel,
    text,
    date: new Date(now - id * 60_000).toISOString(),
    timestamp: now - id * 60_000,
  })
  const state = {
    feed: [post(1, "first post"), post(2, "second post")],
    delay: 0,
  }
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
      json: { counts: { [channel]: 2 }, selected: {}, tooNewToJudge: 0 },
    }),
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
  await expect(page.getByText("first post")).toBeVisible()
  return mock
}

/** Select all is a rule, which refetches the same list. */
const refetch = (page: Page) =>
  page.getByRole("button", { name: "Select all", exact: true }).click()

const pill = (page: Page) => page.getByRole("button", { name: /new posts?$/ })
const card = (page: Page, id: number) =>
  page.locator(`article[data-post-key$="_${id}"]`)

test("a Post that arrives above the reader waits behind the pill, which moves nothing", async ({
  page,
}) => {
  const { state, post } = await openPosts(page)
  // A first refetch with nothing new, so the selection bar has settled.
  await refetch(page)
  const box = () => card(page, 1).boundingBox()
  let before = await box()
  await expect
    .poll(async () => {
      const [was, now] = [before, await box()]
      before = now
      return now?.y === was?.y
    })
    .toBe(true)
  state.feed = [post(0, "brand new"), ...state.feed]
  await refetch(page)

  await expect(pill(page)).toHaveText(/1 new post$/)
  // Its row has no height, which must not squash the pill itself.
  expect((await pill(page).boundingBox())?.height).toBeGreaterThan(24)
  // The Channel's avatar: its first letter while it has no photo.
  await expect(pill(page).locator(".size-6")).toHaveCount(1)
  await expect(page.getByText("brand new")).toHaveCount(0)
  expect(await box()).toEqual(before)

  await pill(page).click()
  await expect(page.getByText("brand new")).toBeVisible()
  await expect(pill(page)).toHaveCount(0)
})

test(". shows the held Posts with the Highlight on the first, and says when none wait", async ({
  page,
}) => {
  const { state, post } = await openPosts(page)
  await page.locator("h1").first().click()
  await page.keyboard.press("\\")

  await page.keyboard.press(".")
  await expect(page.getByText("No new posts")).toBeVisible()

  state.feed = [post(-1, "newest"), post(0, "brand new"), ...state.feed]
  await refetch(page)
  await expect(pill(page)).toHaveText(/2 new posts$/)
  await page.keyboard.press(".")
  await expect(page.getByText("brand new")).toBeVisible()
  await expect(pill(page)).toHaveCount(0)
  await expect(page.locator("article[data-highlight]")).toHaveAttribute(
    "data-post-key",
    /_-1$/,
  )
  // The Highlight's keys move through what is shown, the new Posts included.
  await page.keyboard.press("j")
  await expect(page.locator("article[data-highlight]")).toHaveAttribute(
    "data-post-key",
    /_0$/,
  )
})

test("another list is never held: a sort change shows its Posts at once", async ({
  page,
}) => {
  const { state, post } = await openPosts(page)
  state.feed = [post(0, "brand new"), ...state.feed]
  await page.getByRole("button", { name: "Sort descending" }).click()
  await expect(page.getByText("brand new")).toBeVisible()
  await expect(pill(page)).toHaveCount(0)
})

test("the first load's skeleton is a grid in the Compact grid, full cards otherwise", async ({
  page,
}) => {
  const { state } = await openPosts(page)
  const compact = page.getByRole("button", { name: "Compact grid" })
  const setCompact = async (on: boolean) => {
    if ((await compact.getAttribute("aria-pressed")) !== String(on))
      await compact.click()
    await expect(compact).toHaveAttribute("aria-pressed", String(on))
  }
  // The grid's placeholders are compact cards; a full card's avatar is larger.
  const gridCard = page.locator('.grid [data-slot="skeleton"]').first()
  const fullAvatar = page.locator('[data-slot="skeleton"].size-9').first()
  state.delay = 2000

  await setCompact(true)
  await page.reload()
  await expect(gridCard).toBeVisible()
  await expect(fullAvatar).toHaveCount(0)

  await expect(page.getByText("first post")).toBeVisible()
  await setCompact(false)
  await page.reload()
  await expect(fullAvatar).toBeVisible()
  await expect(gridCard).toHaveCount(0)
})
