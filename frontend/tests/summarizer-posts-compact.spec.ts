/**
 * The Compact grid's cards use the height their row already has (PTI-05).
 * Whole lines filling a row height need a real layout engine, which the unit
 * tests' DOM does not have, so this runs the real app with the posts reads
 * mocked.
 */
import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

const LONG = Array.from(
  { length: 40 },
  (_, i) => `Line ${i + 1} of a long post that runs well past its row.`,
).join("\n")
// Past three lines, so the photo card shows "More" until its row grows.
const CAPTION = Array.from(
  { length: 12 },
  (_, i) => `Line ${i + 1} of the photo's caption.`,
).join("\n")
// 300x400, so the photo card's 10rem photo sets the row's height.
const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#888"/></svg>`

async function mockPosts(page: Page, channel: string) {
  const now = Date.now()
  const post = (id: number, text: string, thumb = false) => ({
    id,
    channelName: channel,
    text,
    date: new Date(now - id * 60_000).toISOString(),
    timestamp: now - id * 60_000,
    ...(thumb
      ? { media: { kinds: ["photo"], thumbApiPath: "/api/v1/pti05-photo" } }
      : {}),
  })
  // Photo and long text share the first row; the short one may wrap.
  const posts = [post(1, CAPTION, true), post(2, LONG), post(3, "Short post.")]
  await page.route("**/api/v1/pti05-photo", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: PHOTO }),
  )
  await page.route("**/api/v1/data/posts**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/data/posts") {
      await route.continue()
      return
    }
    await route.fulfill({ json: posts })
  })
  await page.route("**/api/v1/data/posts/counts**", (route) =>
    route.fulfill({
      json: { counts: { [channel]: 3 }, selected: {}, tooNewToJudge: 0 },
    }),
  )
}

const card = (page: Page, id: number) =>
  page.locator(`article[data-post-key$="_${id}"]`)
/** Lines of text the card shows: its text box's height over a line. */
const linesShown = (c: Locator) =>
  c.getByTestId("compact-text").evaluate((el) => {
    const line = Number.parseFloat(getComputedStyle(el).lineHeight)
    return Math.round(el.getBoundingClientRect().height / line)
  })
const height = (c: Locator) =>
  c.evaluate((el) => Math.round(el.getBoundingClientRect().height))
const bottom = (l: Locator) =>
  l.evaluate((el) => Math.round(el.getBoundingClientRect().bottom))
/**
 * How far apart two measures are, polled until they settle within a pixel:
 * a card's height is fractional, so two rounded heights of one row can differ
 * by 1, and the row is still laying out when the first lines show.
 */
const settlesWith = (a: () => Promise<number>, b: () => Promise<number>) =>
  expect
    .poll(async () => Math.abs((await a()) - (await b())))
    .toBeLessThanOrEqual(1)

test("a compact card fills its row in whole lines, then More", async ({
  page,
}) => {
  await gotoWorkspace(page, "channels")
  const channel = await seedTestChannel(page, undefined, [], {
    lastUpdated: Date.now(),
  })
  await mockPosts(page, channel)
  await clearChannelSelection(page)
  await selectChannelsKeyboard(page, [channel])
  await page.locator("#tour-tab-posts").click()
  const compact = page.getByRole("button", { name: "Compact grid" })
  if ((await compact.getAttribute("aria-pressed")) !== "true")
    await compact.click()

  const photo = card(page, 1)
  const long = card(page, 2)
  const short = card(page, 3)
  await expect(photo.getByTestId("post-card-thumb")).toBeVisible()
  await expect(long.getByText("Line 1 of a long post")).toBeVisible()

  // The photo card sets the row; the long text fills it and adds nothing.
  await expect.poll(() => linesShown(long)).toBeGreaterThan(3)
  await settlesWith(
    () => height(long),
    () => height(photo),
  )
  await settlesWith(
    () => bottom(long.locator("footer")),
    () => bottom(photo.locator("footer")),
  )
  await expect(long.getByRole("button", { name: "More" })).toBeVisible()
  await expect(short.getByRole("button", { name: "More" })).toHaveCount(0)

  // The photo sets the row, so its own caption keeps three lines.
  expect(await linesShown(photo)).toBe(3)
  await expect(photo.getByRole("button", { name: "More" })).toBeVisible()

  const before = await height(long)
  await long.getByRole("button", { name: "More" }).click()
  await expect(long.getByRole("button", { name: "Less" })).toBeVisible()
  expect(await height(long)).toBeGreaterThan(before)
  // The expanded card made the row taller: its neighbour shows the whole
  // caption in that room, so it no longer needs "More".
  await expect.poll(() => linesShown(photo)).toBeGreaterThanOrEqual(12)
  await expect(photo.getByRole("button", { name: "More" })).toHaveCount(0)
  await long.getByRole("button", { name: "Less" }).click()
  await expect(long.getByRole("button", { name: "More" })).toBeVisible()
  await expect(photo.getByRole("button", { name: "More" })).toBeVisible()
  await settlesWith(
    () => height(long),
    async () => before,
  )
})
