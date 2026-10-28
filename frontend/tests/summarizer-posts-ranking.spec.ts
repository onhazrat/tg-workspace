/**
 * A Ranking on the Posts tab (PRM-01), against the real app with the posts
 * reads, the vector search and the lookup mocked: a find-related's count is
 * its cards, and a meaning search keeps the facets and the window total, and
 * runs once however often the tab is left. Run serially.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

/** The whole Post filter's count, which a Ranking's count must never show. */
const WINDOW = 1234

async function mockReads(page: Page, channel: string) {
  const calls = { search: 0, lookup: 0 }
  const now = Date.now()
  const post = (id: number) => ({
    id,
    channelName: channel,
    text: `post ${id} from ${channel}`,
    date: new Date(now - id * 60_000).toISOString(),
    timestamp: now - id * 60_000,
    language: "fa",
    selected: true,
  })
  const feed = [1, 2, 3, 4, 5].map(post)
  const ranked = [6, 7, 8].map(post)

  // The Semantic search Setting arrives from the embeddings job: turned on
  // here, and its write-back kept off the test server.
  await page.route("**/api/v1/jobs/status", async (route) => {
    const response = await route.fetch()
    const json = response.ok() ? await response.json() : {}
    await route.fulfill({
      response,
      json: { ...json, embeddings: { ...json.embeddings, enabled: true } },
    })
  })
  await page.route("**/api/v1/jobs/embeddings", (route) =>
    route.fulfill({ json: { enabled: true } }),
  )
  await page.route("**/api/v1/rag/search", async (route) => {
    calls.search++
    await route.fulfill({
      json: {
        results: ranked.map((p) => ({
          score: 0.9,
          channelName: p.channelName,
          postId: p.id,
          text: p.text,
          post: p,
        })),
      },
    })
  })
  await page.route("**/api/v1/data/posts**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/v1/data/posts") {
      await route.fulfill({ json: feed })
    } else if (path === "/api/v1/data/posts/lookup") {
      calls.lookup++
      const refs: { postId: number }[] = route.request().postDataJSON().posts
      await route.fulfill({
        json: ranked.filter((p) => refs.some((r) => r.postId === p.id)),
      })
    } else if (path === "/api/v1/data/posts/counts") {
      await route.fulfill({
        json: {
          counts: { [channel]: WINDOW },
          selected: { [channel]: WINDOW },
          selectedShown: { [channel]: WINDOW },
          tooNewToJudge: 0,
        },
      })
    } else if (path === "/api/v1/data/posts/facets") {
      await route.fulfill({
        json: {
          total: WINDOW,
          types: [{ value: "original", count: WINDOW, selected: WINDOW }],
          languages: [{ value: "fa", count: WINDOW, selected: WINDOW }],
          media: [{ value: "photo", count: WINDOW, selected: WINDOW }],
        },
      })
    } else {
      await route.continue()
    }
  })
  return calls
}

/** The workspace with the reads mocked and no Channel selected yet. */
async function setUp(page: Page) {
  await gotoWorkspace(page, "channels")
  const channel = await seedTestChannel(page, undefined, [], {
    lastUpdated: Date.now(),
  })
  const calls = await mockReads(page, channel)
  // Reload so the Settings hydrate through the mocked job status, and wait
  // for the Channels, or there is no selection yet to clear.
  await page.reload()
  await expect(page.getByText(channel).first()).toBeVisible()
  await clearChannelSelection(page)
  return { channel, calls }
}

const cards = (page: Page) => page.locator('[data-testid^="post-id-link-"]')

async function searchMeaning(page: Page, query: string) {
  await page.getByText("Meaning", { exact: true }).click()
  await page.getByLabel("Meaning search").fill(query)
  await page.getByLabel("Meaning search").press("Enter")
}

test("a find-related counts the related Posts it shows", async ({ page }) => {
  const { channel, calls } = await setUp(page)
  await selectChannelsKeyboard(page, [channel])
  await page.locator("#tour-tab-posts").click()
  await expect(page.getByText("1,234 posts")).toBeVisible()
  await expect(cards(page)).toHaveCount(5)

  await page.getByRole("button", { name: "Find Related Posts" }).first().click()

  await expect(cards(page)).toHaveCount(3)
  await expect(page.getByText("3 posts", { exact: true })).toBeVisible()
  expect(calls).toEqual({ search: 1, lookup: 1 })
})

test("a meaning search keeps the facets and the window total, and runs once per query", async ({
  page,
}) => {
  const { channel, calls } = await setUp(page)
  // The search starts before a Channel is selected, so the facets are first
  // read during it: nothing they show is an answer cached before it began.
  await page.locator("#tour-tab-posts").click()
  await expect(page.getByText("0 posts", { exact: true })).toBeVisible()
  await searchMeaning(page, "rates")
  await expect(cards(page)).toHaveCount(3)
  await selectChannelsKeyboard(page, [channel])

  await expect(page.getByText("of 1,234 in window")).toBeVisible()
  await page.getByTestId("post-filter-type").click()
  await expect(page.getByTestId("post-filter-type-count-original")).toHaveText(
    `${WINDOW}/${WINDOW}`,
  )
  await page.keyboard.press("Escape")
  await expect(page.getByText("3 posts", { exact: true })).toBeVisible()
  // One search per query: the first, and again for the Channel selected.
  await expect.poll(() => calls).toEqual({ search: 2, lookup: 2 })

  // Another tab and back: the ranked Posts come from the cache.
  await page.locator("#tour-tab-channels").click()
  await page.locator("#tour-tab-posts").click()
  await expect(cards(page)).toHaveCount(3)
  expect(calls).toEqual({ search: 2, lookup: 2 })
})
