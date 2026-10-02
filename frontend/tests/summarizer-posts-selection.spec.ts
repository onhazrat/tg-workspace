/**
 * The Posts tab's filter and selection, end to end, once (PTR-06): the
 * spec's journey. The posts reads and the prompt are mocked, so what is
 * asserted is what each request carries; the server's half is pinned by
 * `test_post_selection.py`. Everything is found by role, label or test id.
 */
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

type Body = Record<string, unknown>
type Step = {
  kind: string
  select: boolean
  not?: boolean
  filter?: { tree: unknown }
  postId?: number
}

async function mockReads(page: Page, channel: string) {
  const feed: Body[] = []
  const prompts: Body[] = []
  const now = Date.now()
  const posts = [1, 2, 3].map((id) => ({
    id,
    channelName: channel,
    text: `post ${id} from ${channel}`,
    date: new Date(now - id * 60_000).toISOString(),
    timestamp: now - id * 60_000,
    language: id === 3 ? "ar" : "fa",
    selected: true,
  }))
  await page.route("**/api/v1/data/posts**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/api/v1/data/posts") {
      feed.push(route.request().postDataJSON())
      await route.fulfill({ json: posts })
    } else if (path === "/api/v1/data/posts/counts") {
      await route.fulfill({
        json: {
          counts: { [channel]: 3 },
          selected: { [channel]: 3 },
          selectedShown: { [channel]: 3 },
          tooNewToJudge: 0,
        },
      })
    } else if (path === "/api/v1/data/posts/facets") {
      await route.fulfill({
        json: {
          total: 3,
          types: [{ value: "original", count: 3, selected: 3 }],
          languages: [
            { value: "fa", count: 2, selected: 2 },
            { value: "ar", count: 1, selected: 1 },
          ],
          media: [{ value: "photo", count: 3, selected: 3 }],
        },
      })
    } else {
      await route.continue()
    }
  })
  await page.route("**/api/v1/ai/summary/prompt", async (route) => {
    prompts.push(route.request().postDataJSON())
    await route.fulfill({ json: { prompt: "summary prompt for e2e" } })
  })
  return { feed, prompts }
}

const steps = (body: Body | undefined) => (body?.selection ?? []) as Step[]

test("a filter with NOT and parentheses, a tick, a Pick, a new window, Selected first, Summarize and a reload", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await gotoWorkspace(page, "channels")
  const channel = await seedTestChannel(page, undefined, [], {
    lastUpdated: Date.now(),
  })
  const { feed, prompts } = await mockReads(page, channel)
  await clearChannelSelection(page)
  await selectChannelsKeyboard(page, [channel])
  await page.locator("#tour-tab-posts").click()
  const last = () => feed[feed.length - 1]

  // ---- A filter: NOT (Persian or Arabic) and Photo ----
  await page.getByTestId("post-filter-language").click()
  await page.getByTestId("post-filter-language-funnel-fa").click()
  await page.getByTestId("post-filter-language-funnel-ar").click()
  await page.keyboard.press("Escape")
  await page.getByTestId("post-filter-media").click()
  await page.getByTestId("post-filter-media-funnel-photo").click()
  await page.keyboard.press("Escape")
  await page.getByLabel("Negate these parentheses").click()
  type Node = { op?: string; not?: boolean; children?: Node[] }
  // The parentheses, negated, and the media Condition beside them.
  await expect
    .poll(() =>
      ((last()?.filter as Node | undefined)?.children ?? []).map((n) => [
        n.op ?? "atom",
        !!n.not,
      ]),
    )
    .toEqual([
      ["or", true],
      ["atom", false],
    ])
  expect(JSON.stringify(last()?.filter)).toContain('"value":"photo"')

  // ---- A tick on Arabic records a Deselect rule ----
  await page.getByTestId("post-filter-language").click()
  await expect(page.getByTestId("post-filter-language-count-ar")).toHaveText(
    "1/1",
  )
  await page.getByTestId("post-filter-language-row-ar").click()
  await page.keyboard.press("Escape")
  const bar = page.getByRole("region", { name: "Post selection" })
  await expect(bar.getByText("Deselect Arabic")).toBeVisible()

  // ---- Unticking one Post records a Pick ----
  await page.getByLabel("Deselect this post").first().click()
  await expect(bar.getByText("−1 post")).toBeVisible()

  // ---- A new window: the rule is applied again there, the Pick stays ----
  const before = JSON.stringify(last()?.window)
  await page.getByRole("button", { name: "Analysis window" }).click()
  const duration = page.getByLabel("Duration", { exact: true })
  await duration.fill("3h")
  await duration.press("Enter")
  await page.keyboard.press("Escape")
  await expect.poll(() => JSON.stringify(last()?.window)).not.toBe(before)
  expect(steps(last()).map((s) => [s.kind, s.select])).toEqual([
    ["rule", true],
    ["rule", false],
    ["pick", false],
  ])
  expect(JSON.stringify(steps(last())[1].filter?.tree)).toContain(
    '"value":"ar"',
  )

  // ---- Selected first asks the server to order them ----
  await bar.getByRole("button", { name: /Selected first/ }).click()
  await expect.poll(() => last()?.selectedFirst).toBe(true)

  // ---- Summarize covers the whole selection, never the filter ----
  await page.locator("#tour-tab-action").click()
  await page.getByRole("button", { name: "Copy summary prompt" }).click()
  await expect.poll(() => prompts.length).toBeGreaterThan(0)
  const scope = prompts[prompts.length - 1].scope as Body
  expect(steps(scope)).toEqual(steps(last()))
  expect(scope.filter).toBeUndefined()

  // ---- A reload keeps the filter in the URL and the selection ----
  await page.locator("#tour-tab-posts").click()
  await expect(page).toHaveURL(/postFilter=/)
  await page.reload()
  await expect(page).toHaveURL(/postFilter=/)
  await expect(page.getByTestId("post-filter-row")).toContainText("Photo")
  await expect(bar.getByText("Deselect Arabic")).toBeVisible()
  await expect(bar.getByText("−1 post")).toBeVisible()
})
