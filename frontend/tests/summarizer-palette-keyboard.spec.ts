import { expect, test } from "@playwright/test"

import {
  seedPartialHistoryChannel,
  seedTestChannel,
} from "./utils/seed-channel"
import {
  channelHasTag,
  closePaletteKeyboard,
  entityChannelInputPlaceholder,
  gotoWorkspace,
  openPaletteKeyboard,
  pickEntityChannelKeyboard,
  pickEntityFilterKeyboard,
  runPaletteCommand,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

test.describe("command palette keyboard", () => {
  test("K1: opens and closes via keyboard shortcut", async ({ page }) => {
    await page.goto("/workspace")
    const palette = page.getByTestId("command-palette")
    await expect(palette).not.toBeVisible()

    await openPaletteKeyboard(page)
    await page.keyboard.press("Escape")
    await expect(palette).not.toBeVisible()
  })

  test("K2: navigates to channels tab via type and Enter", async ({ page }) => {
    await page.goto("/workspace?tab=summary")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "channels")
    await expect(page).toHaveURL(/tab=channels/)
  })

  test("K3: toggles theme via type and Enter", async ({ page }) => {
    await page.goto("/workspace")
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "light"))
    await page.reload()

    const html = page.locator("html")
    await expect(html).toHaveClass(/light/)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "toggle theme")

    await expect(html).toHaveClass(/dark/)
  })

  test("K4: sync channel entity pick via keyboard", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const channelName = await seedTestChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "sync channel")
    await page
      .getByPlaceholder("Name, display name, tag, #tag, or tag:tag...")
      .fill(channelName)
    await page.keyboard.press("Enter")

    await expect(page.getByText(/sync/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test("K5: multi-pick select channel stays open", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const first = await seedTestChannel(page)
    const second = await seedTestChannel(page)

    await page.getByPlaceholder("Search channels...").fill("")

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear selection")
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("command-palette")).not.toBeVisible()

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "select channel")

    const entityInput = page.getByPlaceholder(
      "Name, display name, tag, #tag, or tag:tag...",
    )
    const pickChannel = async (name: string) => {
      await entityInput.fill(name)
      await entityInput.press("Enter")
    }

    await pickChannel(first)
    await expect(page.getByTestId("command-palette")).toBeVisible()

    await pickChannel(second)

    const palette = page.getByTestId("command-palette")
    if (await palette.isVisible()) {
      await page.keyboard.press("Escape")
      if (await palette.isVisible()) {
        await page.keyboard.press("Escape")
      }
    }
    await expect(palette).not.toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${first}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${second}"] button[aria-pressed="true"]`,
      ),
    ).toBeVisible()
  })

  test("K6: add channel editor apply via Enter", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const channelName = `kbd${Date.now()}`

    await page.route("**/api/v1/telegram/channel-info", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ displayName: channelName, telemetry: {} }),
      })
    })

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "add channel")
    const channelHandle = page.getByLabel(/Channel handle/i)
    await channelHandle.fill(channelName)
    await channelHandle.press("Enter")

    await expect(page.getByTestId("command-palette")).toBeVisible()
    await expect(
      page.locator("#tour-channel-grid").getByText(`@${channelName}`),
    ).toBeVisible({
      timeout: 15_000,
    })
  })

  test("K7: search posts opens results and picks via keyboard", async ({
    page,
  }) => {
    await page.goto("/workspace?tab=posts")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "search posts")
    await page.getByLabel(/Search posts/i).fill("test")
    await page.keyboard.press("Enter")

    const results = page.getByTestId("command-palette-search-results")
    await expect(results).toBeVisible({ timeout: 30_000 })

    const firstResult = page.getByRole("option").first()
    if (!(await firstResult.isVisible())) return

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("command-palette")).not.toBeVisible()
    await expect(page).toHaveURL(/tab=posts/)
  })

  test("K8: delete channel confirm dismisses via Escape", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const channelName = await seedTestChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "delete channel")
    await page
      .getByPlaceholder("Name, display name, tag, #tag, or tag:tag...")
      .fill(channelName)
    await page.keyboard.press("Enter")

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("command-palette-confirm")).not.toBeVisible()
    await expect(
      page.locator("#tour-channel-grid").getByText(`@${channelName}`),
    ).toBeVisible()
  })

  // Was "clear cache" until PR #94 (A4) deleted the IndexedDB layer and the
  // command with it. The query then matched nothing and the test had been red
  // ever since — invisibly, because CI is disabled. The subject is the confirm
  // dialog's keyboard path, not the command, so it now uses one that exists and
  // destroys nothing when it proceeds.
  test("K9: a confirm proceeds via Tab and Enter", async ({ page }) => {
    await page.goto("/workspace")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "restart tor")

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("command-palette")).not.toBeVisible({
      timeout: 15_000,
    })
  })

  test("K10: entity view Backspace on empty filter returns to root", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await seedTestChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "sync channel")
    await expect(
      page.getByPlaceholder("Name, display name, tag, #tag, or tag:tag..."),
    ).toBeVisible()

    await page.keyboard.press("Backspace")
    await expect(page.getByPlaceholder("Type a command...")).toBeVisible()
  })

  test("K12: add tag chain via keyboard", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const channelName = await seedTestChannel(page)
    const tagName = `tag${Date.now()}`

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "add tag")
    await pickEntityChannelKeyboard(page, channelName)

    const tagInput = page.locator("#command-palette-editor")
    await expect(tagInput).toBeVisible()
    await tagInput.fill(tagName)
    await tagInput.press("Enter")

    await expect(page.getByTestId("command-palette")).not.toBeVisible({
      timeout: 15_000,
    })
    await expect
      .poll(() => channelHasTag(page, channelName, tagName))
      .toBe(true)
    await expect(
      page.locator(`[data-channel-name="${channelName}"]`).getByText(tagName),
    ).toBeVisible({ timeout: 15_000 })
  })

  test("K13: remove tag chain via keyboard", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const tagName = `rm${Date.now()}`
    const channelName = await seedTestChannel(page, undefined, [tagName])

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "remove tag")
    await pickEntityChannelKeyboard(page, channelName)

    const tagFilter = page.getByPlaceholder("Filter...")
    await expect(tagFilter).toBeVisible()
    await tagFilter.fill(tagName)
    await tagFilter.press("Enter")

    await expect(page.getByTestId("command-palette")).not.toBeVisible({
      timeout: 15_000,
    })
    await expect
      .poll(() => channelHasTag(page, channelName, tagName))
      .toBe(false)
    await expect(
      page.locator(`[data-channel-name="${channelName}"]`).getByText(tagName),
    ).not.toBeVisible()
  })

  test("K14: search-results back preserves editor query", async ({ page }) => {
    const searchQuery = `kbdquery${Date.now()}`
    await page.goto("/workspace?tab=posts")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "search posts")

    const editorInput = page.locator("#command-palette-editor")
    await editorInput.fill(searchQuery)
    await editorInput.press("Enter")

    await expect(
      page.getByTestId("command-palette-search-results"),
    ).toBeVisible({ timeout: 30_000 })

    const resultsFilter = page.getByPlaceholder("Filter results...")
    await resultsFilter.fill("")
    await resultsFilter.press("Backspace")

    await expect(editorInput).toBeVisible()
    await expect(editorInput).toHaveValue(searchQuery)
  })

  test("K11: offline mode skips disabled sync all", async ({ page }) => {
    await page.route("**/api/v1/utils/health-check/**", (route) =>
      route.abort("failed"),
    )
    await page.goto("/workspace")
    await expect(page.getByText("Server offline.")).toBeVisible({
      timeout: 15_000,
    })

    await openPaletteKeyboard(page)
    await page.getByPlaceholder("Type a command...").fill("sync all")

    const syncAll = page.locator(
      '[data-slot="command-item"][data-value="sync-all"]',
    )
    await expect(syncAll).toBeVisible()
    await expect(syncAll).toHaveAttribute("aria-disabled", "true")
    await page.keyboard.press("ArrowDown")
    await expect(syncAll).not.toHaveAttribute("data-selected", "true")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("command-palette")).toBeVisible()
  })

  // Same A4 fallout as K9: the command is "Clear Database Table" now, and
  // "indexeddb" survives only as a keyword on Refresh Database Stats — an
  // action, not an entity root — so the old query opened a flow with no filter
  // to type into. This cancels at the confirm, so no table is truncated.
  test("K15: clear database table confirm cancel via keyboard", async ({
    page,
  }) => {
    await gotoWorkspace(page, "summary")

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear database table")
    await pickEntityFilterKeyboard(page, "translations")

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("command-palette-confirm")).not.toBeVisible()
    await expect(page.getByPlaceholder("Filter...")).toBeVisible()
  })

  test("K16: deselect channel multi-pick via keyboard", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const first = await seedTestChannel(page)
    const second = await seedTestChannel(page)

    await selectChannelsKeyboard(page, [first, second])

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "deselect channel")

    const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
    for (const name of [first, second]) {
      await entityInput.fill(name)
      await entityInput.press("Enter")
      await expect(page.getByTestId("command-palette")).toBeVisible()
    }

    await closePaletteKeyboard(page)
    await expect(
      page.locator(
        `[data-channel-name="${first}"] button[aria-pressed="true"]`,
      ),
    ).not.toBeVisible()
    await expect(
      page.locator(
        `[data-channel-name="${second}"] button[aria-pressed="true"]`,
      ),
    ).not.toBeVisible()
  })

  test("K17: freeze and unfreeze channel via keyboard", async ({ page }) => {
    await gotoWorkspace(page, "channels")
    const channelName = await seedTestChannel(page)
    const card = page.locator(`[data-channel-name="${channelName}"]`)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "freeze channel")
    await pickEntityChannelKeyboard(page, channelName)
    await closePaletteKeyboard(page)

    await expect(card.getByText("Frozen", { exact: true })).toBeVisible({
      timeout: 15_000,
    })

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "unfreeze channel")
    await pickEntityChannelKeyboard(page, channelName)
    await closePaletteKeyboard(page)

    await expect(card.getByText("Frozen", { exact: true })).not.toBeVisible()
  })

  test("K18: fix partial history channel stays open after confirm", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    const first = await seedPartialHistoryChannel(page)
    const second = await seedPartialHistoryChannel(page)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "fix partial history channel")

    const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
    for (const name of [first, second]) {
      await entityInput.fill(name)
      await entityInput.press("Enter")
      await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
      await page.getByTestId("command-palette-confirm-confirm").click()
      await expect(page.getByTestId("command-palette")).toBeVisible()
      await expect(entityInput).toBeVisible()
    }

    await closePaletteKeyboard(page)
  })
})
