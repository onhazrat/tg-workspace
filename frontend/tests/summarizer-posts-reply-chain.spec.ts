/**
 * The Reply chain panel (RCH-02), against the real app with the posts reads
 * mocked. The feed shows #5, the reply #4 and #2; #4 answers #3, which
 * answers #2, which answers the top, #1. #3 is older than any window, so it
 * has no Pick box. #2, #3 and #5 have photos.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#888"/></svg>`

async function mockPosts(page: Page, channel: string) {
  const now = Date.now()
  const post = (
    id: number,
    text: string,
    minutesAgo: number,
    { reply, photo }: { reply?: number; photo?: boolean } = {},
  ) => ({
    id,
    channelName: channel,
    text,
    date: new Date(now - minutesAgo * 60_000).toISOString(),
    timestamp: now - minutesAgo * 60_000,
    selected: true,
    ...(reply
      ? {
          replyToPostId: reply,
          replyTo: {
            channel,
            text: `#${reply}…`,
            url: `https://t.me/${channel}/${reply}`,
          },
        }
      : {}),
    ...(photo
      ? { media: { kinds: ["photo"], thumbApiPath: "/api/v1/rch02-photo" } }
      : {}),
  })
  const p = {
    1: post(1, "the root question", 50),
    2: post(2, "the follow-up", 40, { reply: 1, photo: true }),
    3: post(3, "an old reply", 400 * 24 * 60, { reply: 2, photo: true }),
    4: post(4, "the answer", 20, { reply: 3 }),
    5: post(5, "an unrelated photo", 10, { photo: true }),
  }
  const feed = [p[5], p[4], p[2]]
  const chains: Record<number, unknown[]> = {
    4: [p[4], p[3], p[2], p[1]],
    2: [p[2], p[1]],
  }
  const chainBodies: { postId: number; selection?: unknown[] }[] = []
  await page.route("**/api/v1/rch02-photo", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: PHOTO }),
  )
  await page.route("**/api/v1/data/posts**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/data/posts") {
      await route.fallback()
      return
    }
    await route.fulfill({ json: feed })
  })
  await page.route("**/api/v1/data/posts/counts**", (route) =>
    route.fulfill({
      json: { counts: { [channel]: 3 }, selected: {}, tooNewToJudge: 0 },
    }),
  )
  await page.route("**/api/v1/data/posts/chain", (route) => {
    const body = route.request().postDataJSON()
    chainBodies.push(body)
    return route.fulfill({
      json: { posts: chains[body.postId], stop: "notReply" },
    })
  })
  return { channel, chainBodies }
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
  await expect(page.getByText("the answer")).toBeVisible()
  return mock
}

async function keyboardOn(page: Page) {
  await page.locator("h1").first().click()
  await page.keyboard.press("\\")
}

const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Reply chain" })
const chainKeys = (page: Page) =>
  panel(page)
    .locator("[data-chain-key]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-chain-key")))
const ringOn = (page: Page, id: number) =>
  expect(panel(page).locator("> [data-highlight]")).toHaveAttribute(
    "data-chain-key",
    new RegExp(`_${id}$`),
  )
/** [ on the highlighted reply, once the whole chain is in the panel. */
async function bracket(page: Page) {
  await page.keyboard.press("[")
  await expect.poll(() => chainKeys(page)).toHaveLength(4)
}
const feedCard = (page: Page, id: number) =>
  page.locator(`main article[data-post-key$="_${id}"]`)

test("[ opens the whole chain on the parent, the keys move in it, and ] puts the Highlight back", async ({
  page,
}) => {
  const { channel } = await openPosts(page)
  await keyboardOn(page)
  await page.keyboard.press("j")
  await page.keyboard.press("j")
  await bracket(page)

  await expect(panel(page)).toBeVisible()
  expect(await chainKeys(page)).toEqual(
    [1, 2, 3, 4].map((id) => `${channel}_${id}`),
  )
  await ringOn(page, 3)
  // The panel holds the Highlight: the feed shows no ring, and dots its start.
  await expect(page.locator("main article[data-highlight]")).toHaveCount(0)
  await expect(feedCard(page, 4)).toHaveAttribute("data-chain-origin", "")
  // The other cards are muted in Keyboard mode.
  await expect(panel(page).locator("> .opacity-70")).toHaveCount(3)

  await page.keyboard.press("k")
  await ringOn(page, 2)
  // The feed's copy of the highlighted Post is dashed, never ringed.
  await expect(feedCard(page, 2)).toHaveAttribute("data-chain-marked", "")
  await expect(page.locator("main article[data-highlight]")).toHaveCount(0)
  await page.keyboard.press("g")
  await page.keyboard.press("g")
  await ringOn(page, 1)
  await page.keyboard.press("Shift+G")
  await ringOn(page, 4)
  await expect(feedCard(page, 2)).not.toHaveAttribute("data-chain-marked", "")
  await page.keyboard.press("2")
  await page.keyboard.press("k")
  await ringOn(page, 2)
  // [ while open does nothing.
  await page.keyboard.press("[")
  await ringOn(page, 2)

  // The corner guide lists the panel's keys.
  await page.keyboard.press("Shift+Slash")
  await expect(page.getByText("close the chain")).toBeVisible()

  await page.keyboard.press("]")
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator("main article[data-highlight]")).toHaveAttribute(
    "data-post-key",
    `${channel}_4`,
  )
})

test("a card key acts on the highlighted chain Post, one its card lacks does nothing, and Esc closes", async ({
  page,
}) => {
  const { chainBodies } = await openPosts(page)
  await keyboardOn(page)
  await page.keyboard.press("j")
  await page.keyboard.press("j")
  await bracket(page)
  await ringOn(page, 3)
  // #3 is outside the window: no Pick box, so x does nothing.
  await expect(
    panel(page).locator("> [data-highlight] input[type=checkbox]"),
  ).toHaveCount(0)
  await page.keyboard.press("x")
  await page.keyboard.press("k")
  await ringOn(page, 2)
  await page.keyboard.press("x")
  // The Pick of #2 alone, and the chain read again under it.
  await expect
    .poll(() => JSON.stringify(chainBodies.at(-1)?.selection ?? []))
    .toMatch(/"postId":2/)
  expect(JSON.stringify(chainBodies.at(-1)?.selection)).not.toMatch(
    /"postId":3/,
  )

  await page.keyboard.press("Escape")
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator("main article[data-highlight]")).toHaveAttribute(
    "data-post-key",
    /_4$/,
  )
})

test("p steps through the chain's photos only", async ({ page }) => {
  await openPosts(page)
  await keyboardOn(page)
  await page.keyboard.press("j")
  await page.keyboard.press("j")
  await bracket(page)
  await page.keyboard.press("k")
  await ringOn(page, 2)
  await page.keyboard.press("p")
  // #2 and #3, never the feed's #5.
  const viewer = page.getByRole("dialog")
  await expect(viewer.getByText(/ · 1 \/ 2 · /)).toBeVisible()
  await viewer.getByRole("button", { name: "Next photo" }).click()
  await expect(viewer.getByText(/ · 2 \/ 2 · /)).toBeVisible()
  await expect(
    viewer.getByRole("button", { name: "Next photo" }),
  ).toBeDisabled()
})

test("a sort change closes the panel", async ({ page }) => {
  const { channel } = await openPosts(page)
  await page.getByTestId(`post-reply-badge-${channel}-4`).click()
  await expect(panel(page)).toBeVisible()
  await page.getByRole("button", { name: "Sort descending" }).click()
  await expect(panel(page)).toHaveCount(0)
})

test("on a phone a tap opens the chain full screen, nothing muted, and a reply link moves within it", async ({
  page,
}) => {
  const { channel, chainBodies } = await openPosts(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId(`post-reply-badge-${channel}-4`).click()

  await expect(panel(page)).toBeVisible()
  const box = await panel(page).boundingBox()
  expect(box?.width).toBe(390)
  const close = panel(page).getByRole("button", {
    name: "Close the reply chain",
  })
  await expect(close).toBeInViewport()
  await ringOn(page, 3)
  await expect(panel(page).locator("> .opacity-70")).toHaveCount(0)

  // #3's own reply link moves the ring to #2, reading nothing new.
  const reads = chainBodies.length
  await panel(page).getByTestId(`post-reply-badge-${channel}-3`).click()
  await ringOn(page, 2)
  expect(chainBodies.length).toBe(reads)
  await expect(close).toBeInViewport()

  await close.click()
  await expect(panel(page)).toHaveCount(0)
})
