import { expect, test } from "@playwright/test"

import { seedTestChannel } from "./utils/seed-channel"
import {
  gotoWorkspace,
  mockBulkFollowJob,
  mockDiscoverForwardPosts,
  openDiscoverWithForwards,
  openPaletteKeyboard,
  pinSelectionToCarrier,
  runPaletteCommand,
  setDiscoverSignal,
  setDiscoverSignals,
} from "./utils/summarizer-helpers.ts"

test.describe("TG Workspace discover", () => {
  test("discover tab opens Discover view", async ({ page }) => {
    await page.goto("/workspace?tab=summary")
    await page.locator("#tour-tab-discover").click()

    await expect(page).toHaveURL(/tab=discover/)
    await expect(page.locator("#tour-tab-discover")).toHaveClass(
      /border-app-ink/,
    )
    await expect(
      page.getByRole("heading", { name: "Channel Candidates" }),
    ).toBeVisible()
  })

  test("discover tab loads from ?tab=discover URL", async ({ page }) => {
    await page.goto("/workspace?tab=discover")

    await expect(page).toHaveURL(/tab=discover/)
    await expect(page.locator("#tour-tab-discover")).toHaveClass(
      /border-app-ink/,
    )
    await expect(
      page.getByRole("heading", { name: "Discovery Scope" }),
    ).toBeVisible()
  })

  test("discover shows forward-only empty guide when only forwards are enabled", async ({
    page,
  }) => {
    // Keep SPA state (filter is in-memory); avoid flaky tab-bar clicks under load.
    test.setTimeout(90_000)

    // The "original only" guide requires a non-empty scope of original posts.
    // Reading that from the shared dev DB is what made this spec unreliable —
    // it reported "no posts in scope" whenever the DB had none in range.
    const stamp = Date.now()
    const carrierName = `dsorig${stamp}`

    await gotoWorkspace(page, "channels")
    await seedTestChannel(page, carrierName)
    await mockDiscoverForwardPosts(page, {
      carrierName,
      unfollowedSources: [],
      originalPostCount: 3,
    })
    await pinSelectionToCarrier(page, carrierName)

    await gotoWorkspace(page, "posts")
    const originalOnly = page.getByRole("button", { name: "Original Only" })
    await originalOnly.click()
    await expect(originalOnly).toHaveClass(/bg-app-ink/)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "Go to Discover")
    await expect(page).toHaveURL(/tab=discover/)

    // Mentions and links stay valid on original posts, so the forward-specific
    // guide only appears once they are switched off.
    await setDiscoverSignals(page, {
      forward: true,
      mention: false,
      link: false,
    })

    // Generating moved to the Action tab. Click through rather than
    // `gotoWorkspace`, which is a full page load and would discard the signal
    // set and post filter this test just configured in memory. The Action card
    // navigates back to Discover once the report exists.
    await page.locator("#tour-tab-action").click()
    await page.getByTestId("action-generate-report").click()
    await expect(page).toHaveURL(/tab=discover/, { timeout: 30_000 })

    await expect(page.getByText(/forward metadata/i)).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Show all posts" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Enable all signals" }),
    ).toBeVisible()

    // Restore, so later specs do not inherit a forward-only signal set.
    await setDiscoverSignals(page, {
      forward: true,
      mention: true,
      link: true,
    })
  })

  test("discover signal toggles persist and filter candidates", async ({
    page,
  }) => {
    await gotoWorkspace(page, "discover")

    // Do not assume the starting state: the preference is schema-backed and
    // outlives whichever spec ran before this one.
    await setDiscoverSignal(page, "mention", true)

    const mentionChip = page.getByTestId("discover-signal-mention")
    await mentionChip.click()
    await expect(mentionChip).toHaveAttribute("aria-pressed", "false")

    // Preference is schema-backed, so it survives a reload.
    await page.reload()
    await expect(page.getByTestId("discover-signal-mention")).toHaveAttribute(
      "aria-pressed",
      "false",
    )

    // Restore, so this spec does not disable mentions for the rest of the run.
    await setDiscoverSignal(page, "mention", true)
  })

  test("discover channel and forwarded-by links use web-view /s/ hrefs", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const followedSource = `dsfoll${stamp}`
    const unfollowedSource = `dsunf${stamp}`

    await gotoWorkspace(page, "channels")
    await seedTestChannel(page, carrierName)
    await seedTestChannel(page, followedSource)

    await openDiscoverWithForwards(page, {
      carrierName,
      followedSource,
      unfollowedSources: [unfollowedSource],
    })

    const channelLink = page.getByTestId(
      `discover-channel-link-${unfollowedSource}`,
    )
    await expect(channelLink).toHaveAttribute(
      "href",
      new RegExp(`/s/${unfollowedSource}`),
    )
    await expect(channelLink).toHaveAttribute("target", "_blank")

    const followedLink = page.getByTestId(
      `discover-channel-link-${followedSource}`,
    )
    await expect(followedLink).toHaveAttribute(
      "href",
      new RegExp(`/s/${followedSource}`),
    )

    const forwardedByLink = page
      .getByTestId(`discover-seen-in-link-${carrierName}`)
      .first()
    await expect(forwardedByLink).toHaveAttribute(
      "href",
      new RegExp(`/s/${carrierName}`),
    )
  })

  test("discover followed row checkbox is checked and disabled", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const followedSource = `dsfoll${stamp}`
    const unfollowedSource = `dsunf${stamp}`

    await gotoWorkspace(page, "channels")
    await seedTestChannel(page, carrierName)
    await seedTestChannel(page, followedSource)

    await openDiscoverWithForwards(page, {
      carrierName,
      followedSource,
      unfollowedSources: [unfollowedSource],
    })

    const followedCheckbox = page.getByTestId(
      `discover-select-${followedSource}`,
    )
    await expect(followedCheckbox).toBeChecked()
    await expect(followedCheckbox).toBeDisabled()

    const unfollowedCheckbox = page.getByTestId(
      `discover-select-${unfollowedSource}`,
    )
    await expect(unfollowedCheckbox).not.toBeChecked()
    await expect(unfollowedCheckbox).toBeEnabled()
  })

  test("discover follow selected sends one bulk-follow POST", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const sources = [`dsunfa${stamp}`, `dsunfb${stamp}`]

    await gotoWorkspace(page, "channels")
    await seedTestChannel(page, carrierName)

    const bulkFollow = await mockBulkFollowJob(page)
    await openDiscoverWithForwards(page, {
      carrierName,
      unfollowedSources: sources,
    })

    for (const source of sources) {
      await page.getByTestId(`discover-select-${source}`).click()
    }
    await expect(page.getByTestId("discover-bulk-bar")).toBeVisible()
    // Scoped to the bulk bar: "2 selected" also appears in the channel scope
    // line ("Channels: 2 selected"), so an unscoped locator matches twice and
    // fails Playwright's strict mode.
    await expect(
      page.getByTestId("discover-bulk-bar").getByText("2 selected"),
    ).toBeVisible()

    const dialogs: string[] = []
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })

    await page.getByTestId("discover-follow-selected").click()

    await expect.poll(() => bulkFollow.getPostCount()).toBe(1)
    expect(dialogs).toHaveLength(0)

    const body = bulkFollow.getPostBodies()[0] as {
      channels: Array<{ name: string }>
    }
    expect(body.channels.map((c) => c.name).sort()).toEqual([...sources].sort())

    await expect(page.getByText(/Follow finished/i)).toBeVisible({
      timeout: 15_000,
    })
  })

  test("discover follow selected confirms when selection is at least 5", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const stamp = Date.now()
    const carrierName = `dscarr${stamp}`
    const sources = Array.from(
      { length: 5 },
      (_, index) => `dsunf${index}${stamp}`,
    )

    await gotoWorkspace(page, "channels")
    await seedTestChannel(page, carrierName)

    const bulkFollow = await mockBulkFollowJob(page)
    await openDiscoverWithForwards(page, {
      carrierName,
      unfollowedSources: sources,
    })

    await page.getByTestId("discover-select-all").click()
    await expect(page.getByText("5 selected")).toBeVisible()

    await page.getByTestId("discover-follow-selected").click()
    const confirmDialog = page.getByRole("dialog")
    await expect(confirmDialog).toBeVisible()
    await expect(confirmDialog.getByText(/Follow 5 channels/)).toBeVisible()
    await confirmDialog.getByRole("button", { name: "Cancel" }).click()
    await expect(confirmDialog).not.toBeVisible()
    await expect.poll(() => bulkFollow.getPostCount()).toBe(0)

    await page.getByTestId("discover-follow-selected").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Follow" })
      .click()
    await expect.poll(() => bulkFollow.getPostCount()).toBe(1)

    const body = bulkFollow.getPostBodies()[0] as {
      channels: Array<{ name: string }>
    }
    expect(body.channels).toHaveLength(5)
  })
})
