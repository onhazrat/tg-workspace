import { expect, test } from "./fixtures.ts"

import {
  clearScopedStorage,
  seedScopedStorage,
} from "./utils/scoped-storage.ts"
import { seedBulkChannels, seedTestChannel } from "./utils/seed-channel"
import {
  clearChannelSelection,
  gotoWorkspace,
  mockBulkFollowJob,
  selectChannelsKeyboard,
  showCards,
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
    // The feed filters server-side, so honour the Post filter the client
    // sends (the real backend does the same) rather than returning the full
    // set regardless. A media Condition on photo is all this spec needs.
    await page.route("**/api/v1/data/posts**", async (route) => {
      // The dropdowns' per-value counts share the prefix.
      if (route.request().url().includes("/posts/facets")) {
        await route.fulfill({
          json: { total: 0, types: [], languages: [], media: [] },
        })
        return
      }
      const body = route.request().postDataJSON() as { filter?: unknown } | null
      const photo = JSON.stringify(body?.filter ?? null).includes(
        '{"type":"media","value":"photo"}',
      )
      const json = photo
        ? mediaPosts.filter((post) => post.media?.kinds?.includes("photo"))
        : mediaPosts
      await route.fulfill({ json })
    })

    await clearScopedStorage(page, ["sync_etag_posts"])

    await selectChannelsKeyboard(page, [channelName])
    await gotoWorkspace(page, "posts")

    // The kinds are funnels in the Media dropdown since PTR-03, and the Post
    // filter they build lives in the URL.
    await page.getByTestId("post-filter-media").click()
    await expect(
      page.getByTestId("post-filter-media-funnel-photo"),
    ).toBeVisible()
    await page.getByTestId("post-filter-media-funnel-photo").click()
    await page.keyboard.press("Escape")

    await expect(page).toHaveURL(/postFilter=media%3Aphoto/)
    await expect(page.getByTestId("post-filter-chip-media-photo")).toBeVisible()

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

    await clearChannelSelection(page)
    await page.getByRole("button", { name: "Select all", exact: true }).click()
    await expect(page.getByText("5 selected")).toBeVisible()

    await page.getByTestId("channel-trim-count").fill("2")
    await page.getByTestId("channel-trim-button").click()

    await expect(page.getByText("2 selected")).toBeVisible()
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
    await expect(page.getByText("2 selected")).toBeVisible()
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
    // Start on cards, which have the checkbox; compact cards are the default.
    await seedScopedStorage(page, { channelCardZoom: "0" })
    await seedBulkChannels(page, 4, prefix)
    // A Sync click must not reach Telegram; refusing the enqueue is enough.
    await page.route("**/api/v1/jobs/sync", (route) => route.abort())

    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(4, { timeout: 30_000 })

    // With nothing selected the grid is in plain sort order. A selected run at
    // the top keeps that order, so these handles stay the on-screen order.
    await clearChannelSelection(page)
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
    const grouping = page.getByRole("button", { name: /Selected first/ })
    await grouping.click()
    await expect(grouping).toHaveAttribute("aria-pressed", "false")
    await shiftRun(checkboxOf, 1)

    const detailed = page.getByRole("button", { name: "Detailed cards" })
    const compact = page.getByRole("button", { name: "Compact cards" })
    const tiles = page.getByRole("button", { name: "Tiles" })
    // Pin cards by handle: selection can reorder the grid, so `first()` and
    // `nth()` would re-resolve to a different card after a toggle.
    const cardNamed = async (index: number) => {
      const name = await cards.nth(index).getAttribute("data-channel-name")
      return page.locator(`[data-channel-name="${name}"]`)
    }
    const first = await cardNamed(0)

    // +1 shows fields the default settings hide, such as Start ID.
    await detailed.click()
    await expect(detailed).toHaveAttribute("aria-pressed", "true")
    await expect(first.getByText("Start ID")).toBeVisible()

    // -1: no checkbox, the body selects, Sync does not. New channels may start
    // selected, so each step asserts a flip rather than a count.
    await compact.click()
    await expect(first.getByText("Start ID")).toHaveCount(0)
    const toggle = first.locator("button[aria-pressed]")
    await expect(toggle).toHaveCount(1)
    const before = await toggle.getAttribute("aria-pressed")
    const after = before === "true" ? "false" : "true"
    await first.click()
    await expect(toggle).toHaveAttribute("aria-pressed", after)
    await first.getByRole("button", { name: "Sync" }).click()
    await expect(toggle).toHaveAttribute("aria-pressed", after)

    // -2: a click on the tile selects, through its selection overlay.
    await tiles.click()
    await expect(tiles).toHaveAttribute("aria-pressed", "true")
    const tileFrame = await cardNamed(1)
    const tile = tileFrame.locator("button[aria-pressed]")
    const tileBefore = await tile.getAttribute("aria-pressed")
    await tileFrame.click()
    await expect(tile).not.toHaveAttribute("aria-pressed", tileBefore ?? "")
    await tileFrame.click()
    await expect(tile).toHaveAttribute("aria-pressed", tileBefore ?? "")

    await page.reload()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    await expect(cards).toHaveCount(4, { timeout: 30_000 })
    await expect(tiles).toHaveAttribute("aria-pressed", "true")
    await expect(grouping).toHaveAttribute("aria-pressed", "false")

    // -2: the tile takes the shift-click, from mid-grid since still ungrouped.
    await clearChannelSelection(page)
    await shiftRun(checkboxOf, 1)
  })

  /**
   * CARD-04: a compact card's photo sits above its selection layer and opens
   * the Posts tab's viewer, whose arrows step to the next Channel's photo.
   */
  test("a Channel photo opens the viewer and steps to the next", async ({
    page,
  }) => {
    const prefix = `photo${Date.now()}`
    const photoBase = "https://photos.e2e.test/"
    // A 1x1 PNG, so no photo request leaves the machine.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    )
    await page.route(`${photoBase}**`, (route) =>
      route.fulfill({ contentType: "image/png", body: png }),
    )
    await gotoWorkspace(page, "summary")
    await seedScopedStorage(page, { channelCardZoom: "-1" })
    await seedBulkChannels(page, 3, prefix, photoBase)

    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(3, { timeout: 30_000 })
    const names = await cards.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-channel-name") ?? ""),
    )
    const first = page.locator(`[data-channel-name="${names[0]}"]`)
    await expect(
      first.getByRole("link", { name: `Open ${names[0]} in Telegram` }),
    ).toHaveAttribute("href", new RegExp(`/s/${names[0]}$`))

    // The click must land on the photo, over the compact card's overlay.
    await first
      .getByRole("button", { name: `View ${names[0]}'s photo` })
      .click()
    const viewer = page.getByRole("dialog", { name: "Channel photo" })
    const label = viewer.getByTestId("photo-viewer-label")
    await expect(label).toContainText(`${names[0]} · 1 / 3`)
    await viewer.getByRole("button", { name: "Next photo" }).click()
    await expect(label).toContainText(`${names[1]} · 2 / 3`)
    await page.keyboard.press("Escape")
    await expect(viewer).toHaveCount(0)
  })

  test("keyboard mode moves through the grid and presses the highlighted card's controls", async ({
    page,
  }) => {
    const prefix = `kbd${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 4, prefix)
    await page.goto("/workspace?tab=channels")
    await showCards(page)
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(4, { timeout: 30_000 })
    await clearChannelSelection(page)
    const names = await cards.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-channel-name") ?? ""),
    )
    const highlighted = page.locator("[data-kbd-selected]")
    const legend = page.locator("kbd")

    await page.getByTestId("channel-keyboard").click()
    await expect(legend).toHaveText(["j / k", "gg / G", ..."xstfobp", "esc"])

    await page.keyboard.press("j")
    await expect(highlighted).toHaveAttribute("data-channel-name", names[0])
    await page.keyboard.press("j")
    await expect(highlighted).toHaveAttribute("data-channel-name", names[1])
    await page.keyboard.press("g")
    await page.keyboard.press("g")
    await expect(highlighted).toHaveAttribute("data-channel-name", names[0])

    await page.keyboard.press("x")
    await expect(
      cards.first().getByRole("button", { name: `Deselect ${names[0]}` }),
    ).toHaveAttribute("aria-pressed", "true")

    // Telegram itself is never reached: the popup's request is answered here.
    await page
      .context()
      .route(`**/s/${names[0]}`, (route) => route.fulfill({ body: "" }))
    const popup = page.waitForEvent("popup")
    await page.keyboard.press("o")
    await expect(await popup).toHaveURL(new RegExp(`/s/${names[0]}$`))
    await (await popup).close()

    // A compact card carries no tag field, freeze or bio, and the legend says so.
    await page.getByRole("button", { name: "Compact cards" }).click()
    await expect(legend).toHaveText(["j / k", "gg / G", ..."xsop", "esc"])
    await page.keyboard.press("Escape")
    await expect(highlighted).toHaveCount(0)
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
    await page.getByRole("button", { name: "Cards", exact: true }).click()
    await expect(cards.first().getByText("Start ID")).toHaveCount(0)
    await expectRowsFlush()
  })

  /**
   * CARD-02: each section of a card starts level with the same section on
   * the cards beside it. Three Channels with no bio, a short one and a long
   * one, and one tag against many, sit in one row; every section's top is
   * compared across the row, at both card sizes that align.
   */
  test("card sections line up across a row whatever the bio", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const prefix = `align${Date.now()}`
    await gotoWorkspace(page, "channels")
    const long = "A bio that runs on and on. ".repeat(12)
    await seedTestChannel(page, `${prefix}a`, ["one"])
    await seedTestChannel(page, `${prefix}b`, [], { bio: "Short." })
    await seedTestChannel(
      page,
      `${prefix}c`,
      ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"],
      { bio: long },
    )
    await showCards(page)
    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(3, { timeout: 30_000 })

    const sections = [
      "h4",
      '[data-card-section="bio"]',
      "[data-stat]",
      '[data-card-section="tags"]',
      '[data-card-section="about"]',
      "[data-last-sync]",
    ]
    const expectAligned = async () => {
      await page.waitForTimeout(300)
      const tops = await cards.evaluateAll((elements, selectors) => {
        const top = (el: Element, selector: string) => {
          const found = el.querySelector(selector)
          return found ? Math.round(found.getBoundingClientRect().top) : null
        }
        return elements.map((card) => ({
          card: Math.round(card.getBoundingClientRect().top),
          sections: selectors.map((selector) => top(card, selector)),
        }))
      }, sections)
      // One row, or the comparison means nothing.
      expect(new Set(tops.map((t) => t.card)).size).toBe(1)
      for (const t of tops) expect(t.sections).toEqual(tops[0].sections)
    }

    await expectAligned()
    // The long bio is cut, and its More is the only one in the row.
    await expect(cards.getByRole("button", { name: "More" })).toHaveCount(1)
    await page.getByRole("button", { name: "Detailed cards" }).click()
    await expect(cards.first().getByText("Start ID")).toBeVisible()
    await expectAligned()
  })

  // CARD-03: the suggestion list is portalled out of the card, so a card's
  // clipped edges never hide it, and every row is the topmost element at its
  // own centre, which fails if another card or bar paints over it. The
  // screenshots are for eyeballing the Cards and Detailed sizes.
  test("the tag field's suggestions are not clipped by the card", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const prefix = `tagpop${Date.now()}`
    const tags = Array.from({ length: 12 }, (_, i) => `${prefix}t${i}`)
    await gotoWorkspace(page, "channels")
    // The tags live on a Channel the search hides, so the suggestions are
    // the only place they show.
    await seedTestChannel(page, `src${Date.now()}`, tags)
    await seedTestChannel(page, `${prefix}a`, [])
    await seedTestChannel(page, `${prefix}b`, [])
    await showCards(page)
    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(2, { timeout: 30_000 })

    const card = page.locator(`[data-channel-name="${prefix}b"]`)
    await card.getByRole("combobox", { name: "Add tag" }).fill(prefix)
    const list = page.getByRole("listbox")
    // The list shows at most eight rows.
    await expect(list.getByRole("option")).toHaveCount(8)
    expect(await card.locator('[role="listbox"]').count()).toBe(0)
    const covered = await list.getByRole("option").evaluateAll(
      (options) =>
        options.filter((option) => {
          const r = option.getBoundingClientRect()
          const top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          )
          return !option.contains(top)
        }).length,
    )
    expect(covered).toBe(0)
    await page.screenshot({ path: testInfo.outputPath("tag-popover.png") })

    await list.getByRole("option", { name: tags[0] }).click()
    await expect(card.getByText(tags[0], { exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await page.screenshot({ path: testInfo.outputPath("cards.png") })
    await page.getByRole("button", { name: "Detailed cards" }).click()
    await expect(cards.first().getByText("Start ID")).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("detailed-cards.png") })
  })

  /**
   * CTB-05: Follow is a paste box. Two new handles, a duplicate and one
   * already followed are pasted; the box marks each, follows the two into the
   * Setting group picked, and reports the job. The follow job is mocked, since
   * the real one asks Telegram, and so is one extra Setting group to pick.
   */
  test("follows two Channels from a paste into a chosen Setting group", async ({
    page,
  }) => {
    const prefix = `paste${Date.now()}`
    await gotoWorkspace(page, "channels")
    const followed = await seedTestChannel(page, `${prefix}_old`)
    const [first, second] = [`${prefix}_one`, `${prefix}_two`]

    await page.route("**/api/v1/data/setting-groups", async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      const groups = await (await route.fetch()).json()
      await route.fulfill({
        json: [
          ...groups,
          { ...groups[0], id: "e2e-pasted", name: "Pasted", isDefault: false },
        ],
      })
    })
    const follow = await mockBulkFollowJob(page)

    await page.goto("/workspace?tab=channels")
    await page.locator("#tour-add-channel").click()
    await page
      .getByLabel("Handles to follow")
      .fill(`@${first}, t.me/s/${second}\nhttps://t.me/${first} ${followed} x`)
    await expect(page.getByTestId("follow-paste-row")).toHaveText([
      `@${first} · will follow`,
      `@${second} · will follow`,
      `@${followed} · already following`,
      "@x · not a handle",
    ])
    await page.getByLabel("Setting group").selectOption({ label: "Pasted" })
    await page.getByTestId("follow-paste-submit").click()

    await expect(page.getByText("Follow finished: 2 added")).toBeVisible()
    expect(follow.getPostBodies()).toEqual([
      expect.objectContaining({
        channels: [{ name: first }, { name: second }],
        settingGroupId: "e2e-pasted",
      }),
    ])
    await expect(page.getByLabel("Handles to follow")).toHaveValue("")
  })

  /**
   * CTB-01: a tag funnel is a Condition in the Channel filter, and the filter
   * lives in the URL, so a reload keeps it. Tags a Channel through the Tags
   * popover and finds the tag through the Tags dropdown's search on the way.
   */
  test("a tag funnel filters the grid and survives a reload", async ({
    page,
  }) => {
    const prefix = `funnel${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 2, prefix)

    await page.goto("/workspace?tab=channels")
    await page.getByRole("button", { name: "Cards", exact: true }).click()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(2, { timeout: 30_000 })
    const [tagged, other] = await cards.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-channel-name") ?? ""),
    )

    await clearChannelSelection(page)
    await page
      .getByRole("button", { name: `Select ${tagged}`, exact: true })
      .click()
    await page.getByTestId("bulk-tags").click()
    await page.getByTestId("bulk-add-tag-input").fill(prefix)
    await page.getByTestId("bulk-add-tag-button").click()
    await page.keyboard.press("Escape")

    await page.getByTestId("channel-tags").click()
    await page.getByPlaceholder("Search tags...").fill(prefix)
    await page.getByTestId(`channel-tags-funnel-${prefix}`).click()
    await page.keyboard.press("Escape")
    await expect(cards).toHaveCount(1)
    await expect(page.locator(`[data-channel-name="${tagged}"]`)).toBeVisible()
    await expect(page.getByTestId("channel-tags")).toContainText(prefix)
    await expect(page).toHaveURL(/channelFilter=/)

    await page.reload()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    await expect(page.getByTestId(`channel-filter-chip-${prefix}`)).toBeVisible(
      { timeout: 30_000 },
    )
    await expect(page.locator(`[data-channel-name="${tagged}"]`)).toBeVisible()
    await expect(page.locator(`[data-channel-name="${other}"]`)).toHaveCount(0)
  })

  /**
   * CTB-02: a Reach bound is a number Condition. The Filters dropdown opens
   * Reach's editor, the bound is added, and the grid drops the Channel under
   * it. Reach is mocked onto the channel stats.
   */
  test("a Reach bound drops the Channels under it", async ({ page }) => {
    const prefix = `reach${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 2, prefix)

    // Stats arrive keyed by Channel name, apart from the channel list.
    const reach: Record<string, number> = {}
    await page.route("**/api/v1/data/channels/stats", async (route) => {
      const response = await route.fetch()
      const stats = await response.json()
      for (const [name, value] of Object.entries(reach)) {
        stats[name] = { count: 10, ...stats[name], reach: value }
      }
      await route.fulfill({ response, json: stats })
    })

    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(2, { timeout: 30_000 })
    const [big, small] = await cards.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-channel-name") ?? ""),
    )
    reach[big] = 5000
    reach[small] = 40
    await page.reload()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    await expect(cards).toHaveCount(2, { timeout: 30_000 })

    await page.getByTestId("channel-filters").click()
    await page.getByPlaceholder("Search criteria...").fill("reach")
    await page.getByTestId("channel-filters-reach").click()
    await page.getByRole("button", { name: "at least" }).click()
    await page.getByRole("spinbutton", { name: "Value" }).fill("1000")
    await page.getByTestId("metric-editor-submit").click()

    await expect(cards).toHaveCount(1)
    await expect(page.locator(`[data-channel-name="${big}"]`)).toBeVisible()
    await expect(page.getByTestId("channel-filter-count")).toContainText(
      /^1 of /,
    )
    await expect(
      page.getByTestId("channel-filter-chip-metric-reach"),
    ).toContainText("Reach ≥ 1K")
    await expect(page.getByTestId("channel-filters")).toHaveAttribute(
      "data-active",
      "true",
    )
    await expect(page).toHaveURL(/channelFilter=reach/)
  })

  /**
   * CTB-03: the row builds the logic by hand. A Reach bound no seeded
   * Channel reaches, OR NOT the tag one of them has, leaves the other one;
   * AND or no NOT would each leave a different set. The filter is the URL,
   * so a reload finds it again.
   */
  test("a hand-built OR with a NOT filters the grid and survives a reload", async ({
    page,
  }) => {
    const prefix = `logic${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 2, prefix)

    await page.goto("/workspace?tab=channels")
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(2, { timeout: 30_000 })
    const [tagged, other] = await cards.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-channel-name") ?? ""),
    )

    await clearChannelSelection(page)
    await page
      .getByRole("button", { name: `Select ${tagged}`, exact: true })
      .click()
    await page.getByTestId("bulk-tags").click()
    await page.getByTestId("bulk-add-tag-input").fill(prefix)
    await page.getByTestId("bulk-add-tag-button").click()
    await page.keyboard.press("Escape")

    const row = page.getByTestId("channel-filter-row")
    const picker = page.getByRole("dialog")
    await row
      .getByRole("button", { name: "Add a condition", exact: true })
      .click()
    await picker.getByRole("button", { name: "Reach", exact: true }).click()
    await picker.getByRole("button", { name: "at least" }).click()
    await picker.getByRole("spinbutton", { name: "Value" }).fill("1000000000")
    await picker.getByTestId("metric-editor-submit").click()
    await expect(cards).toHaveCount(0)

    await row
      .getByRole("button", { name: "Add a condition", exact: true })
      .click()
    await picker.getByRole("button", { name: /^Tag/ }).click()
    await picker.getByPlaceholder("Search tags...").fill(prefix)
    await picker.getByRole("button", { name: prefix, exact: true }).click()
    await row.getByRole("button", { name: "and", exact: true }).click()
    await row.getByRole("button", { name: `Negate ${prefix}` }).click()

    await expect(cards).toHaveCount(1)
    await expect(page.locator(`[data-channel-name="${other}"]`)).toBeVisible()
    await expect(page).toHaveURL(/channelFilter=reach.*or.*not/)

    await page.reload()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    await expect(
      page.getByTestId(`channel-filter-chip-${prefix}`),
    ).toHaveAttribute("data-not", "true", { timeout: 30_000 })
    await expect(
      row.getByRole("button", { name: "or", exact: true }),
    ).toBeVisible()
    await expect(page.locator(`[data-channel-name="${other}"]`)).toBeVisible()
    await expect(page.locator(`[data-channel-name="${tagged}"]`)).toHaveCount(0)
  })
  /**
   * CTB-04: the action limit. Everything is selected, then a tag funnel hides
   * two of three, so row 2 says it is acting on the one shown. Add tag writes
   * only that one; the Posts tab still asks for all three, because the limit
   * never reaches the Scope; and switching to All writes all three.
   */
  test("the action limit keeps bulk edits on the Shown Channels", async ({
    page,
  }) => {
    const prefix = `limit${Date.now()}`
    await gotoWorkspace(page, "summary")
    await seedBulkChannels(page, 3, prefix)

    await page.goto("/workspace?tab=channels")
    await page.getByRole("button", { name: "Cards", exact: true }).click()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    const cards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(cards).toHaveCount(3, { timeout: 30_000 })
    const names = await cards.evaluateAll((elements) =>
      elements.map((el) => el.getAttribute("data-channel-name") ?? ""),
    )
    const shown = names[0]

    const addTag = async (tag: string) => {
      await page.getByTestId("bulk-tags").click()
      await page.getByTestId("bulk-add-tag-input").fill(tag)
      await page.getByTestId("bulk-add-tag-button").click()
      await page.keyboard.press("Escape")
    }
    // The Channels one bulk edit wrote, by the PUT each sends.
    const written = (from: number) =>
      writes.slice(from).filter((name) => name.startsWith(prefix))
    const writes: string[] = []
    page.on("request", (request) => {
      const match = request.url().match(/\/api\/v1\/data\/channels\/([^/?]+)$/)
      if (request.method() === "PUT" && match) writes.push(match[1])
    })

    // Tag one Channel so a funnel can show it alone.
    await clearChannelSelection(page)
    await page
      .getByRole("button", { name: `Select ${shown}`, exact: true })
      .click()
    await addTag(prefix)

    // Select everything, then narrow the filter.
    await clearChannelSelection(page)
    await page.getByRole("button", { name: "Select all", exact: true }).click()
    await expect(page.getByText("3 selected")).toBeVisible()
    await page.getByTestId("channel-tags").click()
    await page.getByPlaceholder("Search tags...").fill(prefix)
    await page.getByTestId(`channel-tags-funnel-${prefix}`).click()
    await page.keyboard.press("Escape")
    await expect(cards).toHaveCount(1)
    await expect(page.getByText("3 selected")).toBeVisible()
    const indicator = page.getByTestId("action-limit-indicator")
    await expect(indicator).toHaveText("acting on 1 shown")

    let from = writes.length
    await addTag(`${prefix}-a`)
    await expect.poll(() => written(from)).toEqual([shown])

    // The Scope is the whole selection whatever the limit says.
    const feed = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/api/v1/data/posts") &&
        names.every((name) =>
          (request.postDataJSON()?.channelNames ?? []).includes(name),
        ),
    )
    await page.goto(`${page.url().replace("tab=channels", "tab=posts")}`)
    await feed
    await page.goBack()
    await page.getByPlaceholder("Search channels...").fill(prefix)
    await expect(cards).toHaveCount(1, { timeout: 30_000 })

    await indicator.click()
    await expect(indicator).toHaveText("2 hidden by filters")
    from = writes.length
    await addTag(`${prefix}-b`)
    await expect.poll(() => written(from).sort()).toEqual([...names].sort())
  })

  /**
   * CARD-06: Sync all asks first, and Stop sync cancels that exact job. The
   * job is mocked so nothing reaches Telegram: its event stream stays open
   * until the cancel arrives, then reports the job cancelled, as the endpoint
   * does for the Channels still queued.
   */
  test("Sync all asks first, and Stop sync ends the job as cancelled", async ({
    page,
  }) => {
    const jobId = `e2e-stop-${Date.now()}`
    await gotoWorkspace(page, "channels")
    await seedTestChannel(page)

    const cancelled = {
      jobId,
      status: "cancelled",
      source: "Manual (Sync All)",
      channels: [],
      createdAt: Date.now(),
      finishedAt: Date.now(),
    }
    let release = () => {}
    const cancelArrived = new Promise<void>((resolve) => {
      release = resolve
    })
    const starts: { syncMode?: string }[] = []
    const cancels: string[] = []
    await page.route("**/api/v1/jobs/sync", async (route) => {
      starts.push(route.request().postDataJSON())
      await route.fulfill({ json: { jobId } })
    })
    await page.route("**/api/v1/jobs/sync/*/cancel", async (route) => {
      cancels.push(route.request().url())
      release()
      await route.fulfill({ json: cancelled })
    })
    await page.route(`**/api/v1/jobs/sync/${jobId}/events`, async (route) => {
      await cancelArrived
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify(cancelled)}\n\n`,
      })
    })

    await page.goto("/workspace?tab=channels")
    const syncAll = page.getByRole("button", { name: "Sync all" })
    await syncAll.click()
    await expect(page.getByRole("dialog")).toContainText(
      /Sync \d+ channels? now\?/,
    )
    expect(starts).toEqual([])
    await page.getByTestId("channel-sync-all-confirm").click()

    const stop = page.getByTestId("channel-sync-all-stop")
    await expect(stop).toBeVisible()
    expect(starts.map((body) => body.syncMode)).toEqual(["sync_all"])
    await stop.click()

    await expect(page.getByText("Sync stopped")).toBeVisible()
    expect(cancels).toHaveLength(1)
    expect(cancels[0]).toContain(`/jobs/sync/${jobId}/cancel`)
    // The stream reports the job cancelled, so the button comes back.
    await expect(syncAll).toBeVisible()
    await expect(stop).toBeHidden()
  })
})
