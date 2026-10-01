/**
 * The Posts tab's Sort menu and Channel spotlight (PTR-04), against the real
 * app with the posts reads mocked: what the feed request carries is what is
 * asserted, since the server's half is pinned by the route tests.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

type FeedBody = Record<string, unknown>

async function mockPosts(page: Page, channel: string): Promise<FeedBody[]> {
  const bodies: FeedBody[] = []
  const now = Date.now()
  const posts = [1, 2].map((id) => ({
    id,
    channelName: channel,
    text: `post ${id} from ${channel}`,
    date: new Date(now - id * 60_000).toISOString(),
    timestamp: now - id * 60_000,
  }))
  await page.route("**/api/v1/data/posts**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/data/posts") {
      await route.continue()
      return
    }
    bodies.push(route.request().postDataJSON())
    await route.fulfill({ json: posts })
  })
  await page.route("**/api/v1/data/posts/counts**", (route) =>
    route.fulfill({
      json: {
        counts: { [channel]: 2 },
        selected: { [channel]: 2 },
        tooNewToJudge: 0,
      },
    }),
  )
  return bodies
}

test("Sort picks a measure and a direction; a spotlight narrows the feed and Escape restores it", async ({
  page,
}) => {
  await gotoWorkspace(page, "channels")
  const channel = await seedTestChannel(page, undefined, [], {
    lastUpdated: Date.now(),
  })
  const bodies = await mockPosts(page, channel)
  await clearChannelSelection(page)
  await selectChannelsKeyboard(page, [channel])
  await page.locator("#tour-tab-posts").click()
  const last = () => bodies[bodies.length - 1]

  await page.getByTestId("post-sort").click()
  await page.getByRole("radio", { name: "○ Estimated views" }).click()
  await expect.poll(() => last()?.sort).toBe("most_views")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Sort descending" }).click()
  await expect.poll(() => last()?.sort).toBe("fewest_views")
  expect(last()?.viewMeasure).toBeUndefined() // estimated is the default

  // The name opens the spotlight on its Channel, filters dropped.
  await page.getByTitle(`Show only posts from ${channel}`).first().click()
  const banner = page.getByTestId("channel-spotlight")
  await expect(banner).toContainText("every post in this window")
  await expect
    .poll(() => JSON.stringify(last()?.filter ?? null))
    .toContain(`"value":"${channel}"`)
  expect(last()?.channelNames).toEqual([channel])
  await expect(page.getByTestId("post-filter-row")).toContainText(`@${channel}`)

  await page.keyboard.press("Escape")
  await expect(banner).toHaveCount(0)
  // The feed it left is still cached, so the row is the evidence.
  await expect(page.getByTestId("post-filter-row")).toHaveCount(0)
  await expect(page.getByText(`post 1 from ${channel}`)).toBeVisible()
})
