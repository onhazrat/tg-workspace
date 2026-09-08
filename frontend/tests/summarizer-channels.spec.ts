import { expect, test } from "@playwright/test"

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
        media: {
          kinds: ["photo"],
          isMediaOnly: true,
          views: "1.2K",
          thumbApiPath: "/api/v1/telegram/post-thumb/demo/2",
        },
      },
    ]
    // The feed filters server-side now, so honour the `media` query param the
    // client sends (the real backend does the same) rather than returning the
    // full set regardless.
    await page.route("**/api/v1/data/posts**", async (route) => {
      // `media` moved from the query string into the request body along with
      // the rest of the scope.
      const body = route.request().postDataJSON() as { media?: string } | null
      const media = body?.media
      const json =
        media === "photo" || media === "media_only"
          ? mediaPosts.filter((post) => post.media?.kinds?.includes("photo"))
          : mediaPosts
      await route.fulfill({ json })
    })

    await clearScopedStorage(page, ["sync_etag_posts"])

    await selectChannelsKeyboard(page, [channelName])
    await gotoWorkspace(page, "posts")

    await expect(page.getByTestId("post-media-filter-photo")).toBeVisible()
    await page.getByTestId("post-media-filter-photo").click()

    await expect
      .poll(() => readScopedStorage(page, "postFilter_media"))
      .toBe("photo")

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

        await Promise.all(
          names.map((name) =>
            fetch(`/api/v1/data/channels/${name}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ id: name, name }),
            }).then(async (response) => {
              if (!response.ok) {
                throw new Error(
                  `trim test seed failed (${response.status}): ${await response.text()}`,
                )
              }
            }),
          ),
        )
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

    await page.locator("button.uppercase", { hasText: "None" }).click()
    await page.locator("button.uppercase", { hasText: "All" }).first().click()
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
})
