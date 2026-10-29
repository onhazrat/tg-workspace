import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { clearScopedStorage } from "./utils/scoped-storage"
import {
  fetchThrough,
  gotoWorkspace,
  mockBulkFollowJob,
} from "./utils/summarizer-helpers.ts"

/**
 * The Directory tab's journey (DIR-02) over a mocked Directory API: the
 * reads are the server's to get right (test_directory_browse.py), so this
 * pins what the tab sends and shows.
 *
 * Watched to fail on: Follow sent without its `directory` source; the
 * switches reading off whatever the filter holds; the ticks and column
 * choices not read back from storage, or a reload asking for a column the
 * Account turned off (DCOL); the remembered view not adopted; the
 * "+" menu returning focus after a tab is chosen (closes the Language
 * dropdown); the Channels list left unmocked (a Channels tab selection on
 * the shared backend turns "your channels" into it); the open panel kept in
 * memory only, not in storage (DIR-03); the list read not handed its abort
 * `signal`, so a superseded search runs on; the search chip's clear doing
 * nothing (DIR-04); a Dismissal that never refreshes the list, or a row
 * whose Dismiss also opens the panel (DIR-06); the live ticked Seeds sent
 * as they were when the Condition was added, not re-resolved per tick
 * (DIR-07); Selected first sent without the ticks; a Tag sent for the
 * unfollowed Ticks only, or an "In the Tag" chip that leaves the request
 * without the Tag's name (DFP-04).
 */

const ROWS = ["a1", "a2", "a3", "a4", "a5", "a6"].map((handle, i) => ({
  handle,
  displayName: i === 0 ? "خبر فوری" : `Channel ${handle}`,
  photoUrl: null as string | null,
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
  dismissed: false,
  citedBy: 40 - i,
  cites: i,
  mine: 6 - i,
  mineLastAt: Date.now() - 3_600_000,
  match: null,
  sharedParents: null as number | null,
  sharedChildren: null,
  tags: [] as string[],
}))

type ListBody = {
  filter?: unknown
  yours?: { source?: string; handles?: string[] }
  referenceKinds?: string[]
  sort?: string
  page?: number
  search?: { text: string; fields?: string[] } | null
  showMatches?: boolean
  selectedFirst?: boolean
  ticked?: string[]
  columns?: string[]
}

/** The catalogue a caller without DATA_ADMIN gets, with the opening defaults. */
const CATALOGUE = [
  ["language", true],
  ["subscribers", true],
  ["reach", true],
  ["posts_per_week", true],
  ["forward_pct", true],
  ["last_post_at", true],
  ["mine", true],
  ["cited_by", true],
  ["cites", true],
  ["created_at", true],
  ["photos", false],
  ["bio", false],
].map(([key, on]) => ({ key, default: on }))

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

async function mockDirectory(page: Page, shown: typeof ROWS = ROWS) {
  const lists: ListBody[] = []
  await page.route("**/api/v1/data/directory/list", async (route) => {
    const body = route.request().postDataJSON() as ListBody
    lists.push(body)
    const yours = body.yours ?? {}
    // A search answers slowly, so the journey can supersede one in flight.
    if (body.search) await new Promise((r) => setTimeout(r, 1500))
    const rows = body.showMatches
      ? ROWS.map((r, i) => (i === 0 ? { ...r, match: MATCH } : r))
      : shown
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
  await page.route("**/api/v1/data/directory/distribution", (route) => {
    // A zoom (TB-04) bins only its range; the whole spread's fields stay.
    const { lo = 10, hi = 100_000 } = route.request().postDataJSON() as {
      lo?: number
      hi?: number
    }
    const mid = Math.sqrt(lo * hi)
    return route.fulfill({
      json: {
        scale: "log",
        total: 250,
        noValue: 10,
        min: 10,
        max: 100_000,
        median: 1500,
        bins: [
          { lo, hi: mid, count: 120 },
          { lo: mid, hi, count: 120 },
        ],
      },
    })
  })
  await page.route("**/api/v1/data/directory/size", (route) =>
    route.fulfill({ json: { size: 297_345 } }),
  )
  await page.route("**/api/v1/data/directory/columns", (route) =>
    route.fulfill({ json: CATALOGUE }),
  )
  await page.route("**/api/v1/data/tags", (route) =>
    route.fulfill({ json: [] }),
  )
  return { lastList: () => lists.at(-1) as ListBody }
}

/** The detail panel's reads (DIR-03, DIR-05), for the row the journey opens. */
async function mockPanel(page: Page) {
  const whys: Record<string, unknown>[] = []
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
    await route.fulfill({
      json: { posts: [], total: 0, parents: null, children: null },
    })
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

/** A one-pixel PNG, served for a row's public photo address. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

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
      "directory.columns",
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
      .toBe("not is:followed and not is:dismissed and is:followable")
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
    await expect(page.getByTestId("number-bound-submit")).toHaveText(
      /42 channels/,
    )
    await page.getByTestId("number-bound-submit").click()
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

    // Search the Sort and choose the channels selected here.
    await page.getByTestId("directory-sort").click()
    await page.getByPlaceholder("Search sort options...").fill("selected here")
    await page
      .getByRole("radio", { name: /Cited by channels selected here/ })
      .click()
    await expect.poll(() => param(page, "dirYours")).toBe("ticked")
    await expect(
      page.getByText(/No channels are selected here yet/),
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

    // The view survives a reload, and so does the hidden column, which the
    // read no longer asks for.
    const before = page.url()
    await page.reload()
    await expect(chip(page, "measure-subscribers")).toBeVisible()
    expect(page.url()).toBe(before)
    await expect(page.getByRole("columnheader", { name: "Reach" })).toHaveCount(
      0,
    )
    await expect.poll(() => api.lastList().columns).not.toContain("reach")
    expect(api.lastList().columns).toContain("subscribers")

    // Ticking reaches "your channels" as the ticks change.
    await page.getByRole("checkbox", { name: "Select @a1" }).check()
    await expect.poll(() => api.lastList().yours?.handles).toEqual(["a1"])

    // A shared link opens exactly its view.
    await page.goto("/?tab=directory&dirFilter=lang%3Aen&dirSort=reach")
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
      await page.getByRole("checkbox", { name: `Select @${h}` }).check()
    }
    await expect(page.getByText("5 selected")).toBeVisible()
    await page.getByRole("button", { name: "Follow 5" }).click()
    expect(follows.getPostCount()).toBe(0)
    await page.getByTestId("directory-bulk-confirm").click()
    await expect.poll(() => follows.getPostCount()).toBe(1)
    expect(follows.getPostBodies()[0]).toMatchObject({
      channels: ["a1", "a2", "a3", "a4", "a5"].map((name) => ({ name })),
      directory: { yours: { source: "follows" } },
    })

    // A tab opened with no view adopts the last one.
    await page.goto("/?tab=directory")
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
    await page.goto("/?tab=directory")

    // A row opens its panel; a reload keeps it open; Close closes it.
    await page.getByText("Channel a2").click()
    const aside = page.getByTestId("directory-panel")
    await expect(aside.getByText("The bio of a2")).toBeVisible()
    await expect(aside.getByText("sample post 3")).toBeVisible()
    await expect(aside.getByText("sample post 4")).toHaveCount(0)
    await aside.getByRole("button", { name: "Show 1 more post" }).click()
    await expect(aside.getByText("sample post 4")).toBeVisible()
    // No Cited by your channels Condition, so no window (TB-02).
    expect(panel.lastWhy()).toMatchObject({ handle: "a2" })
    expect(Object.keys(panel.lastWhy() ?? {})).not.toContain("start")
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

  test("an old mine:14d link counts Why it's here from 14 days ago (TB-02)", async ({
    page,
  }) => {
    await mockDirectory(page)
    const panel = await mockPanel(page)
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, ["directory.view", "directory.open"])
    await page.goto("/?tab=directory&dirFilter=mine%3A14d")
    await expect(chip(page, "mine")).toContainText(
      "Cited by your channels from 2 weeks ago",
    )
    await page.getByText("Channel a2").click()
    const aside = page.getByTestId("directory-panel")
    await expect(
      aside.getByText("None of your channels cite it from 2 weeks ago."),
    ).toBeVisible()
    expect(panel.lastWhy()).toMatchObject({
      handle: "a2",
      mode: "live",
      start: -14 * 86_400_000,
    })
  })

  test("a link with a filter that no longer reads is reset, and says so", async ({
    page,
  }) => {
    // DPF renamed the day measures; their old text is not a filter any more.
    await mockDirectory(page)
    await gotoWorkspace(page, "channels")
    await page.goto("/?tab=directory&dirFilter=last_post_days%20%3C%3D%207")
    await expect(
      page.getByText("This link's filter could not be read and was reset"),
    ).toBeVisible()
    await expect(chip(page, "flag-followable")).toBeVisible()
    await expect
      .poll(() => param(page, "dirFilter"))
      .toBe("not is:followed and not is:dismissed and is:followable")
  })

  // Its own short test, for the journey's time budget (DIR-06).
  test("dismiss a row, undo, and see it dimmed with Hide dismissed off", async ({
    page,
  }) => {
    await mockDirectory(page)
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    // The Dismissals, kept as the server keeps them, through Discover's routes.
    const dismissed = new Set<string>()
    await page.route("**/api/v1/data/discover/ignored", async (route) => {
      const { handles } = route.request().postDataJSON() as {
        handles: string[]
      }
      const adding = route.request().method() === "POST"
      for (const h of handles) adding ? dismissed.add(h) : dismissed.delete(h)
      await route.fulfill({
        json: adding ? { ignored: handles } : { removed: handles },
      })
    })
    // Registered after `mockDirectory`, so it answers the list instead.
    await page.route("**/api/v1/data/directory/list", async (route) => {
      const hiding = hidesDismissed(route.request().postDataJSON())
      const rows = ROWS.map((r) => ({
        ...r,
        dismissed: dismissed.has(r.handle),
      }))
      await route.fulfill({
        json: {
          rows: hiding ? rows.filter((r) => !r.dismissed) : rows,
          total: 250,
          languages: [],
          yoursSize: 3,
        },
      })
    })
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, ["directory.view", "directory.open"])
    await page.goto("/?tab=directory")

    const row = page.getByTestId("directory-row-a3")
    await expect(row).toBeVisible()
    await page.getByRole("button", { name: "Dismiss @a3" }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByTestId("directory-panel")).toHaveCount(0)
    await expect(page.getByText("Dismissed @a3")).toBeVisible()
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(row).toBeVisible()
    expect(dismissed.has("a3")).toBe(false)

    // Dismissed again, then Hide dismissed off: back, dimmed, Follow withheld.
    await page.getByRole("button", { name: "Dismiss @a3" }).click()
    await expect(row).toHaveCount(0)
    await page.getByTestId("directory-switch-dismissed").click()
    await expect(row).toBeVisible()
    await expect(row).toHaveClass(/opacity-50/)
    await expect(row.getByRole("button", { name: "Follow @a3" })).toHaveCount(0)
    await expect(
      row.getByRole("button", { name: "Take back @a3" }),
    ).toBeVisible()
  })

  // Its own short test, for the journey's time budget (DIR-07).
  test("compare with the channels selected here, live, and open it as a link", async ({
    page,
  }) => {
    await mockDirectory(page)
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    // Registered after `mockDirectory`, so it answers the list instead: the
    // Seeds are never results, and each row carries its shared count.
    const sent: (string[] | undefined)[] = []
    const bodies: ListBody[] = []
    await page.route("**/api/v1/data/directory/list", async (route) => {
      const seeds = parentsSeeds(route.request().postDataJSON())
      sent.push(seeds)
      bodies.push(route.request().postDataJSON())
      const rows = ROWS.filter((r) => !seeds?.includes(r.handle)).map((r) => ({
        ...r,
        sharedParents: seeds ? 2 : null,
      }))
      await route.fulfill({
        json: { rows, total: 250, languages: [], yoursSize: 3 },
      })
    })
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.open",
      "directorySelectedFirst",
    ])
    await page.goto("/?tab=directory")

    // With a tick, the editor starts on the live ticked choice.
    await page.getByRole("checkbox", { name: "Select @a1" }).check()
    await page.getByTestId("directory-filters").click()
    await page.getByPlaceholder("Search conditions...").fill("shared parents")
    await page.getByRole("button", { name: /Shared parents with/ }).click()
    await expect(
      page.getByRole("radio", { name: /selected in this list \(1\)/ }),
    ).toBeChecked()
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(chip(page, "parents-ticked")).toContainText(
      "2+ shared parents with the channels selected here",
    )
    expect(param(page, "dirFilter")).toContain("parents:ticked")
    await expect.poll(() => sent.at(-1)).toEqual(["a1"])
    await expect(
      page.getByRole("columnheader", { name: "Parents" }),
    ).toBeVisible()

    // A Channel ticked while it is on is a Seed now, so it leaves the list.
    // A click, not `check()`: `check()` waits to see the box ticked, and the
    // row it sits in may already be gone, which timed the test out on CI.
    await page.getByRole("checkbox", { name: "Select @a2" }).click()
    await expect.poll(() => sent.at(-1)).toEqual(["a1", "a2"])
    await expect(page.getByTestId("directory-row-a2")).toHaveCount(0)

    // Selected first sends the ticks for the server to order by.
    const selectedFirst = page.getByTestId("directory-switch-selected-first")
    await selectedFirst.click()
    await expect
      .poll(() => bodies.at(-1))
      .toMatchObject({ selectedFirst: true, ticked: ["a1", "a2"] })

    // A shared link counts the receiver's ticks, which start empty; the
    // switch stays on for this browser, and with no ticks it sends nothing.
    const link = page.url()
    await clearScopedStorage(page, ["directory.ticks"])
    await page.goto(link)
    await expect(chip(page, "parents-ticked")).toBeVisible()
    await expect.poll(() => sent.at(-1)).toEqual([])
    await expect(selectedFirst).toHaveAttribute("aria-pressed", "true")
    expect(bodies.at(-1)?.selectedFirst).toBeUndefined()
  })

  // DFP-01: a follow ticks as a Seed, and keyboard mode walks the rows with
  // the panel following the highlight.
  test("tick a follow as a Seed, and walk the rows by keyboard", async ({
    page,
  }) => {
    await mockDirectory(
      page,
      ROWS.map((r) => (r.handle === "a1" ? { ...r, followed: true } : r)),
    )
    await page.route("**/api/v1/data/directory/*/entry", (route) => {
      const handle = new URL(route.request().url()).pathname.split("/").at(-2)
      const entry = ROWS.find((r) => r.handle === handle)
      return route.fulfill({ json: { ...entry, bio: `The bio of ${handle}` } })
    })
    await page.route("**/api/v1/data/directory/*/posts", (route) =>
      route.fulfill({ json: [] }),
    )
    await page.route("**/api/v1/data/directory/*/neighbours", (route) =>
      route.fulfill({ json: { citedBy: [], cites: [] } }),
    )
    await page.route("**/api/v1/data/directory/why", (route) =>
      route.fulfill({
        json: { posts: [], total: 0, parents: null, children: null },
      }),
    )
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.open",
    ])
    await page.goto("/?tab=directory")

    // A followed row ticks; Follow and Dismiss count only the unfollowed.
    await page.getByRole("checkbox", { name: "Select @a1" }).check()
    await page.getByRole("checkbox", { name: "Select @a2" }).check()
    await expect(page.getByText("2 selected")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Follow 1 of 2" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Dismiss 1 of 2" }),
    ).toBeVisible()
    // Both selected, the follow included, are "the channels selected here".
    await page.getByTestId("directory-filters").click()
    await page.getByPlaceholder("Search conditions...").fill("shared parents")
    await page.getByRole("button", { name: /Shared parents with/ }).click()
    await expect(
      page.getByRole("radio", { name: /selected in this list \(2\)/ }),
    ).toBeChecked()
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Clear", exact: true }).click()

    // j highlights the first row, x ticks it, Enter opens its panel, and the
    // panel follows the next j.
    await page.getByRole("button", { name: "Keyboard mode" }).click()
    // ? shows the tab's keys in the corner, Shift first as a browser sends it.
    await page.keyboard.press("Shift+Slash")
    await expect(page.getByText("open or close the panel")).toBeVisible()
    await page.keyboard.press("j")
    const a1 = page.getByTestId("directory-row-a1")
    await expect(a1).toHaveAttribute("data-highlight", "true")
    await page.keyboard.press("x")
    await expect(
      page.getByRole("checkbox", { name: "Select @a1" }),
    ).toBeChecked()
    await page.keyboard.press("Enter")
    const aside = page.getByTestId("directory-panel")
    await expect(aside.getByText("The bio of a1")).toBeVisible()
    await page.keyboard.press("j")
    await expect(page.getByTestId("directory-row-a2")).toHaveAttribute(
      "data-highlight",
      "true",
    )
    await expect(aside.getByText("The bio of a2")).toBeVisible()

    // Enter closes it again; Esc drops the highlight.
    await page.keyboard.press("Enter")
    await expect(aside).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.locator("[data-highlight]")).toHaveCount(0)
  })

  // DFP-02 at iPhone 12 Pro size: rows on the first screen.
  test("tag the Ticks, see the badge, and filter by the Tag", async ({
    page,
  }) => {
    await mockDirectory(page)
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    const filters: unknown[] = []
    // The Tags, kept as the server keeps them.
    const tagged = new Map<string, string[]>()
    const sent: { name: string; handles: string[] }[] = []
    await page.route("**/api/v1/data/tags", (route) =>
      route.fulfill({
        json: [...tagged].map(([name, handles]) => ({
          name,
          channels: handles.length,
        })),
      }),
    )
    await page.route("**/api/v1/data/tags/channels", async (route) => {
      const body = route.request().postDataJSON() as {
        name: string
        handles: string[]
      }
      sent.push(body)
      tagged.set(body.name, body.handles)
      await route.fulfill({ json: { changed: body.handles.length } })
    })
    // TGU-03: the Tags dropdown's read, one Tag's handles and its uses.
    const uses: unknown[] = []
    await page.route("**/api/v1/data/tags/order", (route) => {
      const { selected = [] } = route.request().postDataJSON() as {
        selected?: string[]
      }
      return route.fulfill({
        json: [...tagged].map(([name, handles]) => ({
          name,
          channels: handles.length,
          selected: handles.filter((h) => selected.includes(h)).length,
          score: 0,
          lastUsedAt: null,
        })),
      })
    })
    await page.route("**/api/v1/data/tags/channels?**", (route) =>
      route.fulfill({
        json: {
          handles:
            tagged.get(
              new URL(route.request().url()).searchParams.get("name") ?? "",
            ) ?? [],
        },
      }),
    )
    await page.route("**/api/v1/data/tags/uses", async (route) => {
      uses.push(route.request().postDataJSON())
      await route.fulfill({ json: { changed: 1 } })
    })
    // Registered after `mockDirectory`, so it answers the list instead.
    await page.route("**/api/v1/data/directory/list", async (route) => {
      filters.push((route.request().postDataJSON() as ListBody).filter)
      const rows = ROWS.map((r) => ({
        ...r,
        followed: r.handle === "a1",
        tags: [...tagged].flatMap(([name, handles]) =>
          handles.includes(r.handle) ? [name] : [],
        ),
      }))
      await route.fulfill({
        json: { rows, total: 250, languages: [], yoursSize: 3 },
      })
    })
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.open",
    ])
    await page.goto("/?tab=directory")

    // A followed Tick is tagged too: a Tag sits on any Channel.
    await page.getByRole("checkbox", { name: "Select @a1" }).check()
    await page.getByRole("checkbox", { name: "Select @a2" }).check()
    await page.getByTestId("directory-bulk-tag").click()
    await page.getByTestId("directory-tag-search").fill("World news")
    await page.getByText('Create the Tag "World news"').click()
    await expect
      .poll(() => sent)
      .toEqual([{ name: "World news", handles: ["a1", "a2"] }])
    await expect(
      page.getByTestId("directory-row-a2").getByTestId("directory-tags"),
    ).toHaveText("World news")

    // "In the Tag", from the Filters picker, names the Tag in the request.
    await page.getByTestId("directory-filters").click()
    const picker = page.getByRole("dialog")
    await picker.getByRole("button", { name: /^In the Tag/ }).click()
    await picker.getByRole("button", { name: /^World news/ }).click()
    await expect(chip(page, "tag-World news")).toBeVisible()
    await expect
      .poll(() =>
        JSON.stringify(filters.at(-1) ?? null).includes(
          '{"type":"tag","name":"World news"}',
        ),
      )
      .toBe(true)
    expect(param(page, "dirFilter")).toContain('tag:"World news"')

    // DFP-05: the Tag as the Seeds of Shared parents goes by name too.
    await page.getByTestId("directory-filters").click()
    await page.getByPlaceholder("Search conditions...").fill("shared parents")
    await page.getByRole("button", { name: /Shared parents with/ }).click()
    await page.getByRole("radio", { name: /A Tag/ }).check()
    await page.getByRole("button", { name: "Add", exact: true }).click()
    await expect(chip(page, "parents-tag-World news")).toContainText(
      "2+ shared parents with the Tag World news",
    )
    await expect
      .poll(() =>
        JSON.stringify(filters.at(-1) ?? null).includes(
          '{"type":"parents","tag":"World news","min":2}',
        ),
      )
      .toBe(true)
    expect(param(page, "dirFilter")).toContain('parents:"tag:World news"')

    // TGU-03: the Tags dropdown selects the Tag's Channels; its funnel reads
    // the top-level Tag Condition and takes it off.
    await page
      .getByTestId("directory-bulk-bar")
      .getByRole("button", { name: "Clear" })
      .click()
    await page.getByTestId("directory-tags-facet").click()
    await expect(
      page.getByTestId("directory-tags-facet-count-World news"),
    ).toHaveText("0/2")
    await page.getByTestId("directory-tags-facet-row-World news").click()
    await expect(page.getByText("2 selected")).toBeVisible()
    await page.getByTestId("directory-tags-facet-funnel-World news").click()
    await expect(chip(page, "tag-World news")).toHaveCount(0)
    expect(uses).toContainEqual({ tab: "directory", name: "World news" })
  })

  test("the Groups dropdown selects a Setting group, funnels by it and opens it (TGU-04)", async ({
    page,
  }) => {
    await mockDirectory(page)
    const filters: unknown[] = []
    await page.route("**/api/v1/data/directory/list", async (route) => {
      filters.push((route.request().postDataJSON() as ListBody).filter)
      await route.fulfill({
        json: { rows: ROWS, total: 6, languages: [], yoursSize: 0 },
      })
    })
    await page.route("**/api/v1/data/tags", (route) =>
      route.fulfill({ json: [] }),
    )
    await page.route("**/api/v1/data/setting-groups", async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      const groups = await (await fetchThrough(route)).json()
      await route.fulfill({
        json: [
          ...groups,
          { ...groups[0], id: "e2e-slow", name: "Slow", isDefault: false },
        ],
      })
    })
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.open",
    ])
    // Registered once the Channels tab is gone: a1 is the one follow in Slow.
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({
        json: [{ id: "a1", name: "a1", settingGroupId: "e2e-slow", tags: [] }],
      }),
    )
    await page.goto("/?tab=directory")

    await page.getByTestId("directory-groups-facet").click()
    await expect(
      page.getByTestId("directory-groups-facet-count-e2e-slow"),
    ).toHaveText("0/1")
    await page.getByTestId("directory-groups-facet-row-e2e-slow").click()
    await expect(page.getByText("1 selected")).toBeVisible()
    await page.getByTestId("directory-groups-facet-funnel-e2e-slow").click()
    await expect
      .poll(() =>
        JSON.stringify(filters.at(-1) ?? null).includes(
          '{"type":"group","name":"Slow"}',
        ),
      )
      .toBe(true)
    expect(param(page, "dirFilter")).toContain("group:Slow")
    await page.getByRole("button", { name: "Open Slow's settings" }).click()
    await expect(page).toHaveURL(/settingGroup=e2e-slow/)
  })

  test("tick all that match, then act on all matching (ADR-031)", async ({
    page,
  }) => {
    await mockDirectory(page)
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    await page.route("**/api/v1/data/tags", (route) =>
      route.fulfill({ json: [] }),
    )
    let total = 250
    await page.route("**/api/v1/data/directory/list", (route) =>
      route.fulfill({
        json: { rows: ROWS, total, languages: [], yoursSize: 0 },
      }),
    )
    const matching = Array.from({ length: 250 }, (_, i) => `m${i}`)
    await page.route("**/api/v1/data/directory/handles", (route) =>
      route.fulfill({ json: { handles: matching } }),
    )
    const sent: Record<string, unknown>[] = []
    await page.route("**/api/v1/data/tags/channels", async (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({ json: { changed: 3 } })
    })
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.open",
    ])
    await page.goto("/?tab=directory")

    // At most 10,000: every match becomes a Tick, and a Tag carries them all.
    await page
      .getByRole("checkbox", { name: "Select every channel on this page" })
      .check()
    await page
      .getByRole("button", { name: "Select all 250 that match" })
      .click()
    const bar = page.getByTestId("directory-bulk-bar")
    await expect(bar).toContainText("All 250 matching are selected.")
    await expect(bar).toContainText("256 selected")
    await page.getByTestId("directory-bulk-tag").click()
    await page.getByTestId("directory-tag-search").fill("Wide")
    await page.getByText('Create the Tag "Wide"').click()
    await expect
      .poll(() => (sent.at(-1)?.handles as string[] | undefined)?.length)
      .toBe(256)

    // Over 10,000: All matching sends the view, and Follow is off.
    await bar.getByRole("button", { name: "Clear" }).click()
    total = 48_210
    await page.getByRole("button", { name: "Next page" }).click()
    await page.getByRole("button", { name: "Previous page" }).click()
    await page
      .getByRole("checkbox", { name: "Select every channel on this page" })
      .check()
    await page
      .getByRole("button", { name: "Act on all 48,210 matching" })
      .click()
    await expect(bar).toContainText("All 48,210 matching.")
    await expect(bar.getByRole("button", { name: "Follow" })).toBeDisabled()
    await page.getByTestId("directory-bulk-tag").click()
    await page.getByTestId("directory-tag-search").fill("Huge")
    await page.getByText('Create the Tag "Huge"').click()
    await expect.poll(() => sent.at(-1)?.name).toBe("Huge")
    expect(sent.at(-1)).toHaveProperty("view")
    expect(sent.at(-1)).not.toHaveProperty("handles")

    // A hand-made tick ends it, and leaves the page ticked minus that row.
    await page.getByRole("checkbox", { name: "Select @a1" }).uncheck()
    await expect(bar).toContainText("5 selected")
    await expect(bar).not.toContainText("matching.")
  })

  test("a row's photo opens the viewer, steps to the next row's, and lands there (KM-01)", async ({
    page,
  }) => {
    // Forty rows, three with a public photo: the first, one with a long
    // name, and the last, well below the fold. Rows without one are skipped.
    const photoUrl = (handle: string) => `https://photos.test/${handle}.png`
    const pictured = new Set(["p00", "p01", "p39"])
    const rows = Array.from({ length: 40 }, (_, i) => {
      const handle = `p${String(i).padStart(2, "0")}`
      return {
        ...ROWS[i % ROWS.length],
        handle,
        displayName:
          i === 1
            ? "A Channel whose name runs on well past the width of any phone"
            : `Channel ${handle}`,
        photoUrl: pictured.has(handle) ? photoUrl(handle) : null,
      }
    })
    await mockDirectory(page, rows)
    await page.route("https://photos.test/**", (route) =>
      route.fulfill({ contentType: "image/png", body: PIXEL }),
    )
    await page.route("**/api/v1/data/directory/p00/entry", (route) =>
      route.fulfill({ json: { ...rows[0], bio: "The bio of p00" } }),
    )
    await page.route("**/api/v1/data/directory/p00/posts", (route) =>
      route.fulfill({ json: [] }),
    )
    await page.route("**/api/v1/data/directory/p00/neighbours", (route) =>
      route.fulfill({ json: { citedBy: [], cites: [] } }),
    )
    await page.route("**/api/v1/data/directory/why", (route) =>
      route.fulfill({
        json: { posts: [], total: 0, parents: null, children: null },
      }),
    )
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, ["directory.view", "directory.open"])
    await page.goto("/?tab=directory")

    // The avatar opens the viewer, not the panel, on the photo clicked.
    const viewer = page.getByTestId("photo-viewer")
    const caption = page.getByTestId("photo-viewer-label")
    const aside = page.getByTestId("directory-panel")
    await page.getByRole("button", { name: "View Channel p00's photo" }).click()
    await expect(caption).toContainText("Channel p00 · 1 / 3")
    await expect(aside).toHaveCount(0)

    // The arrows step through the rows' photos; closing lands on the last.
    await page.keyboard.press("ArrowRight")
    await page.keyboard.press("ArrowRight")
    await expect(caption).toContainText("Channel p39 · 3 / 3")
    await expect(page.getByTestId("directory-row-p39")).not.toBeInViewport()
    await page.keyboard.press("Escape")
    await expect(viewer).toHaveCount(0)
    await expect(aside).toHaveCount(0)
    await expect(page.getByTestId("directory-row-p39")).toBeInViewport()

    // The panel's photo opens alone. In keyboard mode, the Escape that
    // closes the viewer leaves the Highlight and the panel as they were.
    // With no closing animation the viewer is gone before the page hears
    // that Escape, so only the key's being taken can tell the page.
    await page.addStyleTag({
      content: "*, *::before { animation: none !important; }",
    })
    await page.getByRole("button", { name: "Keyboard mode" }).click()
    await page.keyboard.press("g")
    await page.keyboard.press("g")
    await page.keyboard.press("Enter")
    await expect(aside.getByText("The bio of p00")).toBeVisible()
    await aside
      .getByRole("button", { name: "View Channel p00's photo" })
      .click()
    await expect(caption).toHaveText(/^Channel p00 · scroll/)
    await expect(page.getByRole("button", { name: "Next photo" })).toHaveCount(
      0,
    )
    await page.keyboard.press("Escape")
    await expect(viewer).toHaveCount(0)
    await expect(aside.getByText("The bio of p00")).toBeVisible()
    await expect(page.getByTestId("directory-row-p00")).toHaveAttribute(
      "data-highlight",
      "true",
    )

    // p opens the Highlight's photo and closes it again.
    await page.keyboard.press("p")
    await expect(caption).toContainText("Channel p00 · 1 / 3")
    await page.keyboard.press("p")
    await expect(viewer).toHaveCount(0)

    // On a phone a long name never squeezes the avatar.
    await page.setViewportSize({ width: 390, height: 844 })
    const avatar = page
      .getByTestId("directory-card-p01")
      .getByRole("button", { name: /^View A Channel whose name/ })
    await expect(avatar).toBeVisible()
    expect((await avatar.boundingBox())?.width).toBe(28)
  })

  test("on a phone: the controls sheet, cards, and a bottom-sheet panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockDirectory(page)
    await page.route("**/api/v1/data/directory/*/entry", (route) => {
      const handle = new URL(route.request().url()).pathname.split("/").at(-2)
      const entry = ROWS.find((r) => r.handle === handle)
      return route.fulfill({ json: { ...entry, bio: `The bio of ${handle}` } })
    })
    await page.route("**/api/v1/data/directory/*/posts", (route) =>
      route.fulfill({ json: [] }),
    )
    await page.route("**/api/v1/data/directory/*/neighbours", (route) =>
      route.fulfill({ json: { citedBy: [], cites: [] } }),
    )
    await page.route("**/api/v1/data/directory/why", (route) =>
      route.fulfill({
        json: { posts: [], total: 0, parents: null, children: null },
      }),
    )
    await page.route("**/api/v1/data/channels", (route) =>
      route.fulfill({ json: [] }),
    )
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.open",
    ])
    await page.goto("/?tab=directory")

    // The controls fold behind one button that counts the Conditions; no
    // Keyboard switch.
    const button = page.getByTestId("directory-controls-button")
    await expect(button).toHaveText("3")
    await expect(page.getByTestId("directory-filters")).toBeHidden()
    await expect(
      page.getByRole("button", { name: "Keyboard", exact: true }),
    ).toBeHidden()

    // The sheet holds every control; a control's popover opens above it.
    await button.click()
    const sheet = page.getByRole("dialog", { name: "Filters and sort" })
    await expect(sheet.getByTestId("directory-filters")).toBeVisible()
    await expect(
      sheet.getByTestId("directory-search-field-posts"),
    ).toBeVisible()
    await sheet.getByTestId("directory-filters").click()
    await page.getByPlaceholder("Search conditions...").click()
    await page.keyboard.press("Escape")
    await sheet.getByRole("button", { name: "Done" }).click()
    await expect(sheet).toHaveCount(0)

    // Cards, not the table; a card's tick ticks without opening the panel,
    // and the bulk bar stays one line.
    await expect(page.getByTestId("directory-row-a1")).toHaveCount(0)
    await expect(page.getByTestId("directory-card-a1")).toBeVisible()
    await page.getByRole("checkbox", { name: "Select @a1" }).check()
    const aside = page.getByTestId("directory-panel")
    await expect(aside).toHaveCount(0)
    const bulk = page.getByTestId("directory-bulk-bar")
    await expect(bulk).toHaveCSS("flex-wrap", "nowrap")

    // A card opens a bottom sheet; another card above it switches it.
    await page.getByTestId("directory-card-a2").click()
    await expect(aside.getByText("The bio of a2")).toBeVisible()
    const box = await aside.boundingBox()
    expect(box?.y).toBeGreaterThan(844 * 0.4)
    await page.getByTestId("directory-card-a1").click()
    await expect(aside.getByText("The bio of a1")).toBeVisible()
    // The last card scrolls clear of the sheet.
    await page.getByTestId("directory-card-a6").click({ timeout: 5000 })
    await expect(aside.getByText("The bio of a6")).toBeVisible()
  })
})

/** The handles a list body sends as the Shared parents Seeds, if any. */
function parentsSeeds(body: {
  filter?: { children?: { cond?: { type?: string; handles?: string[] } }[] }
}): string[] | undefined {
  return (body.filter?.children ?? []).find((c) => c.cond?.type === "parents")
    ?.cond?.handles
}

/** The list body's filter holds `not is:dismissed` on its top-level AND. */
function hidesDismissed(body: {
  filter?: { children?: { not?: boolean; cond?: { value?: string } }[] }
}): boolean {
  return (body.filter?.children ?? []).some(
    (c) => c.not === true && c.cond?.value === "dismissed",
  )
}
