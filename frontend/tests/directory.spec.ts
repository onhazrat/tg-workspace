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
 * columns not read back from storage; the remembered view not adopted.
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
  mine: 6 - i,
  mineLastAt: Date.now() - 3_600_000,
}))

type ListBody = {
  filter?: unknown
  yours?: { source?: string; handles?: string[] }
  referenceKinds?: string[]
  sort?: string
  page?: number
}

async function mockDirectory(page: Page) {
  const lists: ListBody[] = []
  await page.route("**/api/v1/data/directory/list", async (route) => {
    const body = route.request().postDataJSON() as ListBody
    lists.push(body)
    const yours = body.yours ?? {}
    await route.fulfill({
      json: {
        rows: ROWS,
        total: 250,
        languages: [
          { language: "fa", count: 200 },
          { language: "en", count: 50 },
        ],
        yoursSize:
          yours.source === "follows" ? 3 : (yours.handles ?? []).length,
      },
    })
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

const chip = (page: Page, id: string) =>
  page.getByTestId(`directory-filter-chip-${id}`)
const param = (page: Page, key: string) =>
  new URL(page.url()).searchParams.get(key)

test.describe("TG Workspace directory", () => {
  test("browse, filter, sort, share and follow from the Directory", async ({
    page,
  }) => {
    const api = await mockDirectory(page)
    const follows = await mockBulkFollowJob(page)
    await gotoWorkspace(page, "channels")
    await clearScopedStorage(page, [
      "directory.view",
      "directory.ticks",
      "directory.hiddenColumns",
    ])

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

    // Funnel a Language from the facet menu.
    await page.getByTestId("directory-language").click()
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
})
