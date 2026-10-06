import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { clearScopedStorage } from "./utils/scoped-storage"
import { gotoWorkspace, mockBulkFollowJob } from "./utils/summarizer-helpers.ts"

/**
 * The Directory tab's journey (DIR-02) over a mocked Directory API: the
 * reads are the server's to get right (test_directory_browse.py), so this
 * pins what the tab sends and shows.
 *
 * Watched to fail on: Follow sent without its `directory` source; the
 * switches reading off whatever the filter holds; the ticks and hidden
 * columns not read back from storage; the remembered view not adopted; the
 * "+" menu returning focus after a tab is chosen (closes the Language
 * dropdown); the Channels list left unmocked (a Channels tab selection on
 * the shared backend turns "your channels" into it); the open panel kept in
 * memory only, not in storage (DIR-03); the list read not handed its abort
 * `signal`, so a superseded search runs on; the search chip's clear doing
 * nothing (DIR-04).
 */

const ROWS = ["a1", "a2", "a3", "a4", "a5", "a6"].map((handle, i) => ({
  handle,
  displayName: i === 0 ? "خبر فوری" : `Channel ${handle}`,
  photoUrl: null,
  language: i % 2 ? "en" : "fa",
  subscribers: 1000 * (i + 1),
  reach: 100 * (i + 1),
  reachEstimated: i === 1,
  postsPerWeek: 3.5,
  forwardShare: 0.2,
  lastPostAt: Date.now() - 86_400_000,
  foundAt: Date.now() - 7 * 86_400_000,
  photos: 1,
  videos: 1,
  files: 0,
  links: 2,
  followable: true,
  followed: false,
  citedBy: 40 - i,
  cites: i,
  mine: 6 - i,
  mineLastAt: Date.now() - 3_600_000,
  match: null,
}))

type ListBody = {
  filter?: unknown
  yours?: { source?: string; handles?: string[] }
  referenceKinds?: string[]
  sort?: string
  page?: number
  search?: { text: string; fields?: string[] } | null
  showMatches?: boolean
}

/** What a search quotes for a1 (DIR-04): a bio and a Post, one word a hit. */
const MATCH = {
  bio: [
    { text: "All about ", hit: false },
    { text: "crypto", hit: true },
  ],
  post: {
    postId: 7,
    timestamp: Date.now() - 3_600_000,
    parts: [
      { text: "Crypto", hit: true },
      { text: " is up today", hit: false },
    ],
  },
}

async function mockDirectory(page: Page) {
  const lists: ListBody[] = []
  await page.route("**/api/v1/data/directory/list", async (route) => {
    const body = route.request().postDataJSON() as ListBody
    lists.push(body)
    const yours = body.yours ?? {}
    // A search answers slowly, so the journey can supersede one in flight.
    if (body.search) await new Promise((r) => setTimeout(r, 1500))
    const rows = body.showMatches
      ? ROWS.map((r, i) => (i === 0 ? { ...r, match: MATCH } : r))
      : ROWS
    // The page may have aborted the read while it waited.
    await route
      .fulfill({
        json: {
          rows,
          total: 250,
          languages: [
            { language: "fa", count: 200 },
            { language: "en", count: 50 },
          ],
          yoursSize:
            yours.source === "follows" ? 3 : (yours.handles ?? []).length,
        },
      })
      .catch(() => {})
  })
  await page.route("**/api/v1/data/directory/count", (route) =>
    route.fulfill({ json: { total: 42 } }),
  )
  await page.route("**/api/v1/data/directory/distribution", (route) =>
    route.fulfill({
      json: {
        scale: "log",
        total: 250,
        noValue: 10,
        min: 10,
        max: 100_000,
        median: 1500,
        bins: [
          { lo: 10, hi: 1000, count: 120 },
          { lo: 1000, hi: 100_000, count: 120 },
        ],
      },
    }),
  )
  await page.route("**/api/v1/data/directory/size", (route) =>
    route.fulfill({ json: { size: 297_345 } }),
  )
  return { lastList: () => lists.at(-1) as ListBody }
}

/** The detail panel's reads (DIR-03, DIR-05), for the row the journey opens. */
async function mockPanel(page: Page) {
  const whys: { handle?: string; days?: number | null }[] = []
  await page.route("**/api/v1/data/directory/a2/entry", (route) =>
    route.fulfill({ json: { ...ROWS[1], bio: "The bio of a2" } }),
  )
  await page.route("**/api/v1/data/directory/a2/posts", (route) =>
    route.fulfill({
      json: [1, 2, 3, 4].map((postId) => ({
        postId,
        text: `sample post ${postId}`,
        timestamp: Date.now() - postId * 3_600_000,
        views: 900,
        capturedAt: Date.now() - 86_400_000,
        hasMedia: false,
        links: [],
      })),
    }),
  )
  await page.route("**/api/v1/data/directory/why", async (route) => {
    whys.push(route.request().postDataJSON())
    await route.fulfill({ json: { posts: [], total: 0 } })
  })
  await page.route("**/api/v1/data/directory/a2/neighbours", (route) =>
    route.fulfill({
      json: {
        citedBy: [
          {
            handle: "src_one",
            displayName: "Source One",
            references: 4,
            kinds: ["forward"],
          },
        ],
        cites: [],
      },
    }),
  )
  return { lastWhy: () => whys.at(-1) }
}

const chip = (page: Page, id: string) =>
  page.getByTestId(`directory-filter-chip-${id}`)
const param = (page: Page, key: string) =>
  new URL(page.url()).searchParams.get(key)

test.describe("TG Workspace directory", () => {
  test("browse, filter, sort, share and follow from the Directory", async ({
    page,
  }) => {
    // Five page loads on CI's Vite dev server: it reached its last step at
    // 26.6 s of the default 30 s (run 37417123209).
    test.slow()
    const api = await mockDirectory(page)
    const follows = await mockBulkFollowJob(page)
    // No Channels, so no Channels tab selection: "your channels" is every
    // follow whatever the shared backend holds.
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.hiddenColumns",
      "directory.open",
    ])

    // Animations slowed, as a slow CI runner gets them, so the "+" menu is
    // still closing when the Language pill is clicked below.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Animation.enable")
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.05 })
    const menu = page.locator("[role=menu]")

    // The tab opens on the opening view, written into the URL.
    await page.getByTestId("workspace-tab-add").click()
    await page.getByRole("menuitem", { name: "Directory" }).click()
    await expect(page.getByTestId("directory-view")).toBeVisible()
    await expect
      .poll(() => param(page, "dirFilter"))
      .toBe("not is:followed and is:followable")
    await expect(page.getByText("خبر فوری")).toHaveAttribute("dir", "auto")

    // A row's handle is Telegram's web view, in a new tab.
    const link = page.getByTestId("directory-channel-link-a1")
    await expect(link).toHaveAttribute("href", /\/s\/a1$/)
    await expect(link).toHaveAttribute("target", "_blank")

    // Funnel a Language from the facet menu. The closing "+" menu's focus
    // return, once it lands, must not close the dropdown opened after it.
    await expect(menu).toHaveCount(1)
    await page.getByTestId("directory-language").click()
    await expect(menu).toHaveCount(0)
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 })
    await page.getByTestId("directory-language-funnel-fa").click()
    await page.keyboard.press("Escape")
    await expect(chip(page, "language-fa")).toBeVisible()

    // A switch off drops its chip; on brings it back.
    await page.getByTestId("directory-switch-followed").click()
    await expect(chip(page, "flag-followed")).toHaveCount(0)
    await page.getByTestId("directory-switch-followed").click()
    await expect(chip(page, "flag-followed")).toBeVisible()

    // A bound through the Filters picker, with its count preview.
    await page.getByTestId("directory-filters").click()
    await page.getByPlaceholder("Search conditions...").fill("subs")
    await page.getByRole("button", { name: "Subscribers" }).click()
    await page.getByRole("spinbutton", { name: "Value" }).fill("1000")
    await expect(page.getByTestId("directory-bound-submit")).toHaveText(
      /42 channels/,
    )
    await page.getByTestId("directory-bound-submit").click()
    await expect(chip(page, "measure-subscribers")).toBeVisible()
    expect(param(page, "dirFilter")).toContain("subscribers >= 1000")

    // A search (DIR-04): a chip, Relevance, the URL, and a1's quoted matches.
    const box = page.getByLabel("Search the Directory")
    await box.fill("crypto")
    const row = page.getByTestId("directory-filter-row")
    await expect(row.getByText('"crypto"')).toBeVisible()
    await expect.poll(() => param(page, "dirQ")).toBe("crypto")
    expect(param(page, "dirSort")).toBe("relevance")
    await expect
      .poll(() => api.lastList())
      .toMatchObject({
        search: { text: "crypto", fields: ["name", "bio", "posts"] },
        sort: "relevance",
        showMatches: true,
      })
    const quote = page.getByTestId("directory-match-a1")
    await expect(quote.locator("mark").first()).toHaveText("crypto")
    await expect(page.getByTestId("directory-match-post-a1")).toHaveAttribute(
      "href",
      /\/s\/a1\/7$/,
    )

    // Show matches off drops the quotes and asks for none.
    await page.getByTestId("directory-switch-matches").click()
    await expect(quote).toHaveCount(0)
    expect(param(page, "dirMatches")).toBe("off")
    await expect.poll(() => api.lastList().showMatches).toBe(false)
    await page.getByTestId("directory-switch-matches").click()

    // Narrowing the fields sends a new search; clearing it from the chip
    // while that is in flight aborts it, empties the box and puts the sort back.
    const narrowed = page.waitForRequest(
      (r) =>
        r.url().endsWith("/directory/list") &&
        (r.postDataJSON() as ListBody).search?.fields?.length === 2,
    )
    await page.getByTestId("directory-search-field-bio").click()
    const superseded = await narrowed
    expect(param(page, "dirIn")).toBe("name,posts")
    const aborted = page.waitForEvent("requestfailed", (r) => r === superseded)
    await row.getByRole("button", { name: "Clear the search" }).click()
    await aborted
    await expect(box).toHaveValue("")
    await expect(row.getByText('"crypto"')).toHaveCount(0)
    expect(param(page, "dirQ")).toBeNull()
    expect(param(page, "dirSort")).toBeNull()
    await expect.poll(() => api.lastList().search ?? null).toBeNull()

    // Search the Sort and choose the channels ticked here.
    await page.getByTestId("directory-sort").click()
    await page.getByPlaceholder("Search sort options...").fill("ticked")
    await page
      .getByRole("radio", { name: /Cited by channels ticked here/ })
      .click()
    await expect.poll(() => param(page, "dirYours")).toBe("ticked")
    await expect(
      page.getByText(/No channels are ticked here yet/),
    ).toBeVisible()

    // Search the Reference kinds and keep forwards only.
    await page.getByTestId("directory-kinds").click()
    await page.getByPlaceholder("Search reference kinds...").fill("for")
    await page.getByRole("checkbox", { name: "forward" }).check()
    await page.keyboard.press("Escape")
    await expect.poll(() => param(page, "dirKinds")).toBe("forward")
    expect(api.lastList().referenceKinds).toEqual(["forward"])

    // Search the Columns and hide Reach.
    await page.getByTestId("directory-columns").click()
    await page.getByPlaceholder("Search columns...").fill("median")
    await page.getByRole("checkbox", { name: /^Reach/ }).uncheck()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("columnheader", { name: "Reach" })).toHaveCount(
      0,
    )

    // The view survives a reload, and so does the hidden column.
    const before = page.url()
    await page.reload()
    await expect(chip(page, "measure-subscribers")).toBeVisible()
    expect(page.url()).toBe(before)
    await expect(page.getByRole("columnheader", { name: "Reach" })).toHaveCount(
      0,
    )

    // Ticking reaches "your channels" as the ticks change.
    await page.getByRole("checkbox", { name: "Tick @a1" }).check()
    await expect.poll(() => api.lastList().yours?.handles).toEqual(["a1"])

    // A shared link opens exactly its view.
    await page.goto(
      "/workspace?tab=directory&dirFilter=lang%3Aen&dirSort=reach",
    )
    await expect(chip(page, "language-en")).toBeVisible()
    await expect(chip(page, "language-fa")).toHaveCount(0)
    await expect
      .poll(() => api.lastList())
      .toMatchObject({
        sort: "reach",
        filter: { children: [{ cond: { type: "language", value: "en" } }] },
      })

    // Tick five and confirm a bulk follow; discovered-via rides along.
    for (const h of ["a2", "a3", "a4", "a5"]) {
      await page.getByRole("checkbox", { name: `Tick @${h}` }).check()
    }
    await expect(page.getByText("5 ticked")).toBeVisible()
    await page.getByRole("button", { name: "Follow 5" }).click()
    expect(follows.getPostCount()).toBe(0)
    await page.getByTestId("directory-bulk-confirm").click()
    await expect.poll(() => follows.getPostCount()).toBe(1)
    expect(follows.getPostBodies()[0]).toMatchObject({
      channels: ["a1", "a2", "a3", "a4", "a5"].map((name) => ({ name })),
      directory: { yours: { source: "follows" } },
    })

    // A tab opened with no view adopts the last one.
    await page.goto("/workspace?tab=directory")
    await expect(chip(page, "language-en")).toBeVisible()
    await expect.poll(() => param(page, "dirSort")).toBe("reach")
  })

  // Its own test: as the journey's tail it ran the journey past 30 s on CI.
  test("open a row's panel, keep it over a reload, filter by a neighbour", async ({
    page,
  }) => {
    await mockDirectory(page)
    const panel = await mockPanel(page)
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, ["directory.view", "directory.open"])
    await page.goto("/workspace?tab=directory")

    // A row opens its panel; a reload keeps it open; Close closes it.
    await page.getByText("Channel a2").click()
    const aside = page.getByTestId("directory-panel")
    await expect(aside.getByText("The bio of a2")).toBeVisible()
    await expect(aside.getByText("sample post 3")).toBeVisible()
    await expect(aside.getByText("sample post 4")).toHaveCount(0)
    await aside.getByRole("button", { name: "Show 1 more post" }).click()
    await expect(aside.getByText("sample post 4")).toBeVisible()
    expect(panel.lastWhy()).toMatchObject({ handle: "a2", days: null })
    await page.reload()
    await expect(aside.getByText("The bio of a2")).toBeVisible()
    await aside.getByRole("button", { name: "Close" }).click()
    await expect(aside).toHaveCount(0)

    // DIR-05: a neighbour is one click from a Condition, and the panel
    // closes on the narrowed list.
    await page.getByText("Channel a2").click()
    await aside
      .getByRole("button", { name: 'Filter by "Cited by @src_one"' })
      .click()
    await expect(aside).toHaveCount(0)
    await expect(chip(page, "citedby-src_one")).toBeVisible()
    expect(param(page, "dirFilter")).toContain("citedby:src_one")
  })
})
