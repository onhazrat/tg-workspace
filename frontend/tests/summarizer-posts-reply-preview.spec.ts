/**
 * The Posts tab's reply link previews the parent, against the real app with
 * the posts reads mocked: hovering shows the whole parent, a parent that is
 * itself a reply previews its own, and a narrow screen opens a bottom sheet.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

async function mockPosts(page: Page, channel: string): Promise<string[]> {
  const now = Date.now()
  const at = (id: number) => ({
    id,
    channelName: channel,
    date: new Date(now - id * 60_000).toISOString(),
    timestamp: now - id * 60_000,
  })
  const root = { ...at(1), text: "the root question" }
  const middle = {
    ...at(2),
    text: `the follow-up\n${Array(20).fill("line").join("\n")}\nits last line`,
    replyToPostId: 1,
    replyTo: { channel, text: "the root…", url: `https://t.me/${channel}/1` },
  }
  const reply = {
    ...at(3),
    text: "the answer",
    replyToPostId: 2,
    replyTo: { channel, text: "the follow…", url: `https://t.me/${channel}/2` },
  }
  const looked: string[] = []
  await page.route("**/api/v1/data/posts**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/data/posts") {
      await route.continue()
      return
    }
    await route.fulfill({ json: [reply] })
  })
  await page.route("**/api/v1/data/posts/counts**", (route) =>
    route.fulfill({
      json: {
        counts: { [channel]: 1 },
        selected: { [channel]: 1 },
        tooNewToJudge: 0,
      },
    }),
  )
  await page.route("**/api/v1/data/posts/lookup", (route) => {
    const { posts } = route.request().postDataJSON() as {
      posts: { postId: number }[]
    }
    looked.push(...posts.map((p) => String(p.postId)))
    const byId: Record<number, unknown> = { 1: root, 2: middle }
    return route.fulfill({
      json: posts.map((p) => byId[p.postId]).filter(Boolean),
    })
  })
  return looked
}

async function openReply(page: Page) {
  await gotoWorkspace(page, "channels")
  const channel = await seedTestChannel(page, undefined, [], {
    lastUpdated: Date.now(),
  })
  const looked = await mockPosts(page, channel)
  await clearChannelSelection(page)
  await selectChannelsKeyboard(page, [channel])
  await page.locator("#tour-tab-posts").click()
  await expect(page.getByText("the answer")).toBeVisible()
  return { channel, looked }
}

test("hovering a reply link shows its whole parent, and the parent's own reply link previews the next one up", async ({
  page,
}) => {
  const { channel, looked } = await openReply(page)
  expect(looked).toEqual([]) // nothing is looked up before a hover

  await page.getByTestId(`post-reply-badge-${channel}-3`).hover()
  const card = page.getByTestId("reply-parent-card").first()
  await expect(card).toContainText("its last line")
  await expect(card).not.toContainText("Show More")
  expect(looked).toEqual(["2"])

  await card.getByTestId(`post-reply-badge-${channel}-2`).hover()
  await expect(page.getByTestId("reply-parent-card")).toHaveCount(2)
  await expect(page.getByTestId("reply-parent-card").nth(1)).toContainText(
    "the root question",
  )
})

test("on a narrow screen a tap opens the parent in a bottom sheet", async ({
  page,
}) => {
  const { channel } = await openReply(page)
  // Narrowed after the workspace is set up, so only the preview changes mode.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId(`post-reply-badge-${channel}-3`).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByTestId("reply-parent-card")).toContainText(
    "its last line",
  )
})
