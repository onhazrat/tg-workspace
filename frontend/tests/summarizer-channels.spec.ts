import { expect, test } from "./fixtures.ts"

import {
  clearScopedStorage,
  readScopedStorage,
  seedScopedStorage,
} from "./utils/scoped-storage.ts"
import { seedBulkChannels, seedTestChannel } from "./utils/seed-channel"
import {
  gotoWorkspace,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

test.describe("TG Workspace channels and posts", () => {
  test("channel grid loads more cards on first visit when scrolling", async ({
    page,
  }) => {
    const prefix = `scroll${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 25, prefix)

    await page.goto("/workspace?tab=channels")
    await expect(page.getByTestId("command-palette-button")).toBeVisible()
    await page.getByPlaceholder("Search channels...").fill(prefix)

    const seededCards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(seededCards).toHaveCount(20, { timeout: 30_000 })

    // The grid must say it is showing a slice. Without this the user cannot tell
    // 20 rendered cards from 20 existing channels. Both the filtered and
    // unfiltered labels open with this phrase.
    await expect(page.getByTestId("channel-grid-count")).toContainText(
      "Showing 20 of 25 channels",
    )

    const scrollContainer = page.getByTestId("workspace-scroll")
    await scrollContainer.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    await expect(seededCards).toHaveCount(25, { timeout: 10_000 })
  })

  /**
   * Regression guard for a defect that shipped past the test above.
   *
   * That test seeds 25 channels and asserts a *single* load (20 → 25). Twenty-five
   * cards fit entirely inside the virtualizer's overscan, so it never exercises
   * windowing, and one load never exercises the second. Both holes were real: the
   * grid shipped stuck on the first 20 of ~1,150 channels, and this suite stayed
   * green.
   *
   * Seeding 70 forces genuine windowing and three consecutive loads.
   */
  test("channel grid keeps loading past the first page when virtualized", async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const prefix = `deep${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 70, prefix)

    await page.goto("/workspace?tab=channels")
    await expect(page.getByTestId("command-palette-button")).toBeVisible()
    await page.getByPlaceholder("Search channels...").fill(prefix)

    const countLabel = page.getByTestId("channel-grid-count")
    await expect(countLabel).toContainText("Showing 20 of 70 channels", {
      timeout: 30_000,
    })

    const scrollContainer = page.getByTestId("workspace-scroll")
    const scrollToEnd = async () => {
      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
    }

    // Each pass must advance the loaded count, not just the scroll position.
    await scrollToEnd()
    await expect(countLabel).toContainText("Showing 40 of 70 channels", {
      timeout: 15_000,
    })

    await scrollToEnd()
    await expect(countLabel).toContainText("Showing 60 of 70 channels", {
      timeout: 15_000,
    })

    await scrollToEnd()
    await expect(countLabel).toContainText("70 channels", { timeout: 15_000 })

    // And windowing must actually be doing its job at that size: with 70 loaded,
    // the DOM must hold materially fewer than all of them.
    const cardsInDom = await page
      .locator("[data-channel-name]")
      .count()
      .catch(() => -1)
    expect(cardsInDom).toBeGreaterThan(0)
    expect(cardsInDom).toBeLessThan(70)
  })

  test("posts media filter controls persist and filter rendered cards", async ({
    page,
  }) => {
    const channelName = `media${Date.now()}`
    const now = Date.now()

    await gotoWorkspace(page, "channels")
    await seedTestChannel(page, channelName)

    await page.route("**/api/v1/data/sync-meta**", async (route) => {
      await route.fulfill({
        json: {
          channels: {
            etag: "playwright-channels",
            updatedAt: new Date().toISOString(),
          },
          posts: {
            etag: "playwright-posts",
            updatedAt: new Date().toISOString(),
          },
        },
      })
    })

    const mediaPosts = [
      {
        id: 1,
        channelName,
        text: "Caption only",
        date: new Date(now).toISOString(),
        timestamp: now,
      },
      {
        id: 2,
        channelName,
        text: "[photo]",
        date: new Date(now - 1000).toISOString(),
        timestamp: now - 1000,
        viewsCount: 1_200,
        media: {
          kinds: ["photo"],
          isMediaOnly: true,
          thumbApiPath: "/api/v1/telegram/post-thumb/demo/2",
        },
      },
    ]
    // The feed filters server-side now, so honour the `media` query param the
    // client sends (the real backend does the same) rather than returning the
    // full set regardless.
    await page.route("**/api/v1/data/posts**", async (route) => {
      // The Media pill's per-kind counts (PFB-02) share the prefix.
      if (route.request().url().includes("/posts/facets")) {
        await route.fulfill({ json: { languages: [], media: [] } })
        return
      }
      // `media` moved from the query string into the request body along with
      // the rest of the scope.
      // `media` is a set of kinds since PFB-01; empty or absent is any media.
      const body = route.request().postDataJSON() as {
        media?: string[]
      } | null
      const media = body?.media ?? []
      const json =
        media.includes("photo") || media.includes("media_only")
          ? mediaPosts.filter((post) => post.media?.kinds?.includes("photo"))
          : mediaPosts
      await route.fulfill({ json })
    })

    await clearScopedStorage(page, ["sync_etag_posts"])

    await selectChannelsKeyboard(page, [channelName])
    await gotoWorkspace(page, "posts")

    // The kinds are a checklist behind the Media pill since PFB-02.
    await page.getByTestId("post-filter-pill-media").click()
    await expect(page.getByTestId("post-media-filter-photo")).toBeVisible()
    await page.getByTestId("post-media-filter-photo").click()
    await page.keyboard.press("Escape")

    await expect
      .poll(() => readScopedStorage(page, "postFilter_media"))
      .toBe(JSON.stringify(["photo"]))

    await expect(page.getByTestId("post-card-media-badge-photo")).toBeVisible()
    await expect(page.getByText("Caption only")).not.toBeVisible()
  })

  test("trim channel selection keeps first N by activity rate sort", async ({
    page,
  }) => {
    test.setTimeout(90_000)

    const prefix = `trimtest${Date.now()}`
    const channelNames = Array.from(
      { length: 5 },
      (_, index) => `${prefix}${index}`,
    )

    await gotoWorkspace(page, "channels")

    await page.evaluate(
      async ({ names }) => {
        const token = localStorage.getItem("access_token")
        if (!token) {
          throw new Error("trim test: missing access_token")
        }

        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        }

        // Sequential — same touch_sync row-lock contention as seedBulkChannels.
        for (const name of names) {
          const response = await fetch(`/api/v1/data/channels/${name}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ id: name, name }),
          })
          if (!response.ok) {
            throw new Error(
              `trim test seed failed (${response.status}): ${await response.text()}`,
            )
          }
        }
      },
      { names: channelNames },
    )

    await page.route("**/api/v1/data/channels**", async (route) => {
      const response = await route.fetch()
      const body = await response.json()

      const augmentChannel = (channel: {
        name: string
        stats?: Record<string, unknown>
      }) => {
        const index = channelNames.indexOf(channel.name)
        if (index === -1) return channel
        return {
          ...channel,
          stats: {
            count: 10,
            minId: 1,
            maxId: 10,
            velocity: index + 1,
          },
        }
      }

      const json = Array.isArray(body)
        ? body.map(augmentChannel)
        : augmentChannel(body)

      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        json,
      })
    })

    await seedScopedStorage(page, {
      channelGrid_sortBy: "activity_rate",
      channelGrid_sortDirection: "asc",
    })
    await clearScopedStorage(page, ["sync_etag_channels"])

    await page.reload()
    await expect(page.getByTestId("command-palette-button")).toBeVisible()

    await page.getByPlaceholder("Search channels...").fill(prefix)
    for (const name of channelNames) {
      await expect(page.locator(`[data-channel-name="${name}"]`)).toBeVisible({
        timeout: 15_000,
      })
    }

    await page.getByRole("button", { name: "None", exact: true }).click()
    await page.getByRole("button", { name: "All", exact: true }).click()
    await expect(page.getByText("5 Selected")).toBeVisible()

    await page.getByTestId("channel-trim-count").fill("2")
    await page.getByTestId("channel-trim-button").click()

    await expect(page.getByText("2 Selected")).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${channelNames[0]}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${channelNames[1]}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${channelNames[2]}"] button[aria-pressed="true"]`,
      ),
    ).not.toBeVisible()

    await page.getByTestId("channel-trim-count").fill("5")
    await page.getByTestId("channel-trim-button").click()
    await expect(page.getByText(/Already 2 or fewer selected/i)).toBeVisible()
    await expect(page.getByText("2 Selected")).toBeVisible()
  })

  /**
   * ZOOM-01: the card zoom buttons step through four levels, the compact
   * levels select on a body click, Sync never selects, and the level survives
   * a reload. ZOOM-02: shift-click selects a run and a second shift-click
   * deselects it, on the checkbox at 0 and on the tile at -2. The rules live in
   * `lib/channels/card-zoom.ts` and `range-select.ts` and are unit-tested
   * there; this pins the wiring they cannot see.
   */
  test("channel card zoom levels select on click and survive a reload", async ({
    page,
  }) => {
    const prefix = `zoom${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 4, prefix)
    // A Sync click must not reach Telegram; refusing the enqueue is enough.
    await page.route("**/api/v1/jobs/sync", (route) => route.abort())

    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(4, { timeout: 30_000 })

    // With nothing selected the grid is in plain sort order. A selected run at
    // the top keeps that order, so these handles stay the on-screen order.
    const none = page.getByRole("button", { name: "None", exact: true })
    await none.click()
    await expect(
      page.locator(`[data-channel-name^="${prefix}"] [aria-pressed="true"]`),
    ).toHaveCount(0)
    const names = await cards.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-channel-name") ?? ""),
    )
    const expectSelected = async (
      toggleOf: (name: string) => ReturnType<typeof page.locator>,
      selected: boolean[],
    ) => {
      for (const [i, name] of names.entries()) {
        await expect(toggleOf(name)).toHaveAttribute(
          "aria-pressed",
          String(selected[i]),
        )
      }
    }
    // Selects the three Channels from `start` with a click and a shift-click,
    // then deselects them with a shift-click back on `start`.
    const shiftRun = async (
      toggleOf: (name: string) => ReturnType<typeof page.locator>,
      start = 0,
    ) => {
      await toggleOf(names[start]).click()
      await toggleOf(names[start + 2]).click({ modifiers: ["Shift"] })
      await expectSelected(
        toggleOf,
        names.map((_, i) => i >= start && i <= start + 2),
      )
      await toggleOf(names[start]).click({ modifiers: ["Shift"] })
      await expectSelected(
        toggleOf,
        names.map(() => false),
      )
    }
    const checkboxOf = (name: string) =>
      page.locator(`[data-channel-name="${name}"] button[aria-pressed]`)

    // 0: the checkbox takes the shift-click.
    await shiftRun(checkboxOf)

    // Grouped, a click lifts its card to the top, so a run from mid-grid
    // would reach the top. Ungrouped, nothing moves and the run stays put.
    // The grid stays ungrouped from here, so the reload below checks it is
    // remembered.
    const grouping = page.getByRole("button", {
      name: "Group selected and frozen channels",
    })
    await grouping.click()
    await expect(grouping).toHaveAttribute("aria-pressed", "false")
    await shiftRun(checkboxOf, 1)

    const zoomIn = page.getByRole("button", { name: "Detailed cards" })
    const zoomOut = page.getByRole("button", { name: "Compact cards" })
    // Pin cards by handle: selection can reorder the grid, so `first()` and
    // `nth()` would re-resolve to a different card after a toggle.
    const cardNamed = async (index: number) => {
      const name = await cards.nth(index).getAttribute("data-channel-name")
      return page.locator(`[data-channel-name="${name}"]`)
    }
    const first = await cardNamed(0)

    // +1 shows fields the default settings hide, such as Start ID.
    await zoomIn.click()
    await expect(zoomIn).toBeDisabled()
    await expect(first.getByText("Start ID")).toBeVisible()

    // -1: no checkbox, the body selects, Sync does not. New channels may start
    // selected, so each step asserts a flip rather than a count.
    await zoomOut.click()
    await zoomOut.click()
    await expect(first.getByText("Start ID")).toHaveCount(0)
    const toggle = first.locator("button[aria-pressed]")
    await expect(toggle).toHaveCount(1)
    const before = await toggle.getAttribute("aria-pressed")
    const after = before === "true" ? "false" : "true"
    await first.click()
    await expect(toggle).toHaveAttribute("aria-pressed", after)
    await first.getByRole("button", { name: "Sync" }).click()
    await expect(toggle).toHaveAttribute("aria-pressed", after)

    // -2: the tile is the toggle.
    await zoomOut.click()
    await expect(zoomOut).toBeDisabled()
    const tile = await cardNamed(1)
    const tileBefore = await tile.getAttribute("aria-pressed")
    await tile.click()
    await expect(tile).not.toHaveAttribute("aria-pressed", tileBefore ?? "")
    await tile.click()
    await expect(tile).toHaveAttribute("aria-pressed", tileBefore ?? "")

    await page.reload()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    await expect(cards).toHaveCount(4, { timeout: 30_000 })
    await expect(
      page.getByRole("button", { name: "Compact cards" }),
    ).toBeDisabled()
    await expect(grouping).toHaveAttribute("aria-pressed", "false")

    // -2: the tile takes the shift-click, from mid-grid since still ungrouped.
    await none.click()
    await shiftRun((name) => page.locator(`[data-channel-name="${name}"]`), 1)
  })

  /**
   * Regression guard: zooming from +1 back to 0 left rows at the grid's
   * starting estimate, so tall cards overlapped the row below and short ones
   * left gaps. `measure()` clears every row height, and a row is measured again
   * only when it mounts or its ResizeObserver reports a change. A plain card is
   * the same height at +1 and 0, so its row never reported one. -1 to 0 hid the
   * bug because every row changes height there.
   */
  test("rows sit flush after zooming into +1 and back to normal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const prefix = `rowfit${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 16, prefix)

    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(16, { timeout: 30_000 })

    // Each row must start exactly where the one above it ends.
    const expectRowsFlush = async () => {
      await page.waitForTimeout(500)
      const rows = await page
        .locator("#tour-channel-grid > [data-index]")
        .evaluateAll((elements) =>
          elements.map((el) => ({
            top: new DOMMatrix(getComputedStyle(el).transform).m42,
            height: (el as HTMLElement).offsetHeight,
          })),
        )
      expect(rows.length).toBeGreaterThan(2)
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].top).toBeCloseTo(rows[i - 1].top + rows[i - 1].height, 0)
      }
    }

    await page.getByRole("button", { name: "Detailed cards" }).click()
    await expect(cards.first().getByText("Start ID")).toBeVisible()
    await expectRowsFlush()
    await page.getByRole("button", { name: "Compact cards" }).click()
    await expect(cards.first().getByText("Start ID")).toHaveCount(0)
    await expectRowsFlush()
  })
})
