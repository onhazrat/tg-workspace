import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

import { WORKSPACE_TABS } from "../src/constants"
import {
  seedBulkChannels,
  seedPartialHistoryChannel,
  seedTestChannel,
} from "./utils/seed-channel"

function paletteModifier() {
  return process.platform === "darwin" ? "Meta" : "Control"
}

async function openPaletteKeyboard(page: Page) {
  await page.locator("main").click({ position: { x: 8, y: 8 } })
  await page.keyboard.press(`${paletteModifier()}+Shift+P`)
  await expect(page.getByTestId("command-palette")).toBeVisible()
}

async function runPaletteCommand(page: Page, query: string) {
  await page.getByPlaceholder("Type a command...").fill(query)
  await page.keyboard.press("Enter")
}

const entityChannelInputPlaceholder =
  "Name, display name, tag, #tag, or tag:tag..."

async function pickEntityChannelKeyboard(page: Page, channelName: string) {
  const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
  await entityInput.fill(channelName)
  await entityInput.press("Enter")
}

async function pickEntityFilterKeyboard(page: Page, value: string) {
  const entityInput = page.getByPlaceholder("Filter...")
  await entityInput.fill(value)
  await entityInput.press("Enter")
}

async function enableAdvancedMode(page: Page) {
  await page.goto("/summarizer")
  await page.evaluate(() => {
    localStorage.setItem("advancedMode", "true")
  })
  await page.reload()
  await expect(page.getByTestId("command-palette-button")).toBeVisible()
}

async function closePaletteKeyboard(page: Page) {
  const palette = page.getByTestId("command-palette")
  if (!(await palette.isVisible())) return
  await page.keyboard.press("Escape")
  if (await palette.isVisible()) {
    await page.keyboard.press("Escape")
  }
  await expect(palette).not.toBeVisible()
}

async function selectChannelsKeyboard(page: Page, channelNames: string[]) {
  await openPaletteKeyboard(page)
  await runPaletteCommand(page, "select channel")
  const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
  for (const name of channelNames) {
    await entityInput.fill(name)
    await entityInput.press("Enter")
  }
  await closePaletteKeyboard(page)
}

async function channelHasTag(
  page: Page,
  channelName: string,
  tag: string,
): Promise<boolean> {
  return page.evaluate(
    async ({ name, expectedTag }) => {
      const token = localStorage.getItem("access_token")
      if (!token) return false

      const response = await fetch("/api/v1/data/channels", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) return false

      const channels = (await response.json()) as Array<{
        name: string
        tags?: string[]
      }>
      const channel = channels.find((entry) => entry.name === name)
      return channel?.tags?.includes(expectedTag) ?? false
    },
    { name: channelName, expectedTag: tag },
  )
}

async function gotoSummarizer(page: Page, tab = "summary") {
  await page.goto(`/summarizer?tab=${tab}`)
  await expect(page.getByTestId("command-palette-button")).toBeVisible()
}

test.describe("TG Summarizer", () => {
  test("summarizer shell renders workspace tabs", async ({ page }) => {
    await page.goto("/summarizer")

    for (const tab of WORKSPACE_TABS) {
      await expect(page.locator(`#tour-tab-${tab.id}`)).toBeVisible()
    }
  })

  test("settings tab opens Engine Room with network section", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=summary")
    await expect(page.locator("#tour-tab-summary")).toBeVisible()

    await page.locator("#tour-tab-settings").click()
    await page
      .getByRole("button", { name: "Network & Security", exact: true })
      .click()

    await expect(page.getByText("Engine Room")).toBeVisible()
    await expect(page).toHaveURL(/tab=settings/)
    await expect(page).toHaveURL(/section=network/)
  })

  test("summary tab shows Copy Prompt button", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")

    await expect(
      page.locator("button").filter({ hasText: "Copy Prompt" }).first(),
    ).toBeVisible()
    await expect(
      page.locator("button").filter({ hasText: "Generate Summary" }).first(),
    ).toBeVisible()
  })

  test("command palette opens via shortcut and header button", async ({
    page,
  }) => {
    await page.goto("/summarizer")

    const palette = page.getByTestId("command-palette")
    await expect(palette).not.toBeVisible()

    await page.locator("main").click({ position: { x: 8, y: 8 } })
    const modifier = process.platform === "darwin" ? "Meta" : "Control"
    await page.keyboard.press(`${modifier}+Shift+P`)
    await expect(palette).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(palette).not.toBeVisible()

    await page.getByTestId("command-palette-button").click()
    await expect(palette).toBeVisible()
  })

  test("command palette navigates to channels tab", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")
    await page.getByTestId("command-palette-button").click()

    await page.getByPlaceholder("Type a command...").fill("channels")
    await page.getByRole("option", { name: "Go to Channels" }).click()

    await expect(page).toHaveURL(/tab=channels/)
    await expect(page.locator("#tour-tab-channels")).toHaveClass(
      /border-app-ink/,
    )
  })

  test("command palette toggles theme", async ({ page }) => {
    await page.goto("/summarizer")
    await page.evaluate(() =>
      localStorage.setItem("vite-ui-theme", "light"),
    )
    await page.reload()

    const html = page.locator("html")
    await expect(html).toHaveClass(/light/)

    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("toggle theme")
    await page.getByRole("option", { name: "Toggle Theme" }).click()

    await expect(html).toHaveClass(/dark/)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("vite-ui-theme")))
      .toBe("dark")
  })

  test("command palette copies all channel names", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("copy list of all channels")
    await page
      .getByRole("option", { name: "Copy List of All Channels" })
      .click()

    await expect(page.getByText(/Copied \d+ channels?/i)).toBeVisible({
      timeout: 15_000,
    })
  })

  test("command palette export selected channels uses jsonl", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    const channelName = await seedTestChannel(page)

    await page.locator("button.uppercase", { hasText: "None" }).click()
    await page
      .getByRole("button", { name: `Select ${channelName}`, exact: true })
      .click()

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("export list of selected channels")

    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
    await page
      .getByRole("option", { name: "Export List of Selected Channels" })
      .click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.jsonl$/)
  })

  test("import command shows confirmation before file picker", async ({
    page,
  }) => {
    await page.goto("/summarizer")

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("import list of all channels")
    await page
      .getByRole("option", { name: "Import List of All Channels" })
      .click()

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
  })

  test("command palette sync channel opens entity picker", async ({ page }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("sync channel")
    await page
      .getByRole("option", { name: "Sync Channel", exact: true })
      .click()
    await expect(
      page.getByPlaceholder("Name, display name, tag, #tag, or tag:tag..."),
    ).toBeVisible()
  })

  test("command palette delete channel shows confirm after pick", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("delete channel")
    const deleteOption = page.getByRole("option", {
      name: /Delete Channel/,
    })
    await expect(deleteOption).toBeVisible({ timeout: 10_000 })
    if (await deleteOption.isDisabled()) return

    await deleteOption.click()
    const channelOption = page
      .getByRole("option")
      .filter({ hasText: "@" })
      .first()
    if (!(await channelOption.isVisible())) return

    await channelOption.click()
    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await expect(page.getByText(/Delete @/)).toBeVisible()
  })

  test("command palette search posts opens in-palette results", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=posts")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("search posts")
    await page
      .getByRole("option", { name: "Search Posts", exact: true })
      .click()
    await page.getByRole("button", { name: "Apply" }).click()
    await expect(
      page.getByTestId("command-palette-search-results"),
    ).toBeVisible({ timeout: 30_000 })
  })

  test("command palette search summaries opens in-palette results", async ({
    page,
  }) => {
    await gotoSummarizer(page, "summary")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("search summaries")
    await page
      .getByRole("option", { name: "Search Summaries", exact: true })
      .click()
    await page.getByRole("button", { name: "Apply" }).click()
    await expect(
      page.getByTestId("command-palette-search-results"),
    ).toBeVisible({ timeout: 30_000 })
  })

  test("command palette reload channels command is available", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=channels")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("reload channels")
    await expect(
      page.getByRole("option", { name: "Reload Channels", exact: true }),
    ).toBeVisible()
  })

  test("command palette clear post filters command is available", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=posts")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("clear post filters")
    await expect(
      page.getByRole("option", { name: "Clear Post Filters", exact: true }),
    ).toBeVisible()
  })

  test("command palette fix all partial history command is available", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await seedPartialHistoryChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("fix all partial history")
    await expect(
      page.getByRole("option", {
        name: "Fix All Partial History",
        exact: true,
      }),
    ).toBeVisible()
  })

  test("command palette fix partial history opens filtered entity picker", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    const partialChannel = await seedPartialHistoryChannel(page)
    await seedTestChannel(page)

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("fix partial history channel")
    await page
      .getByRole("option", {
        name: "Fix Partial History (Channel)",
        exact: true,
      })
      .click()

    const entityInput = page.getByPlaceholder(entityChannelInputPlaceholder)
    await expect(entityInput).toBeVisible()
    await entityInput.fill(partialChannel)
    await expect(
      page.getByRole("option", { name: new RegExp(`@${partialChannel}`) }),
    ).toBeVisible()
    await expect(page.getByRole("option", { name: /@e2e/ })).not.toBeVisible()
  })

  test("command palette show starred summaries toggles badge", async ({
    page,
  }) => {
    await gotoSummarizer(page, "summary")
    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("show starred summaries")
    const option = page.getByRole("option", {
      name: /Show Starred Summaries Only/,
    })
    await expect(option).toBeVisible()
    await expect(option).toContainText("OFF")
    await option.click()
    await expect(page.getByTestId("command-palette")).not.toBeVisible()
    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("show starred summaries")
    await expect(
      page.getByRole("option", { name: /Show Starred Summaries Only/ }),
    ).toContainText("ON", { timeout: 10_000 })
  })
})

test.describe("command palette keyboard", () => {
  test("K1: opens and closes via keyboard shortcut", async ({ page }) => {
    await page.goto("/summarizer")
    const palette = page.getByTestId("command-palette")
    await expect(palette).not.toBeVisible()

    await openPaletteKeyboard(page)
    await page.keyboard.press("Escape")
    await expect(palette).not.toBeVisible()
  })

  test("K2: navigates to channels tab via type and Enter", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "channels")
    await expect(page).toHaveURL(/tab=channels/)
  })

  test("K3: toggles theme via type and Enter", async ({ page }) => {
    await page.goto("/summarizer")
    await page.evaluate(() =>
      localStorage.setItem("vite-ui-theme", "light"),
    )
    await page.reload()

    const html = page.locator("html")
    await expect(html).toHaveClass(/light/)

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "toggle theme")

    await expect(html).toHaveClass(/dark/)
  })

  test("K4: sync channel entity pick via keyboard", async ({ page }) => {
    await gotoSummarizer(page, "channels")
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
    await gotoSummarizer(page, "channels")
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
    await gotoSummarizer(page, "channels")
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
    await page.goto("/summarizer?tab=posts")
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
    await gotoSummarizer(page, "channels")
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

  test("K9: clear cache confirm proceeds via Tab and Enter", async ({
    page,
  }) => {
    await page.goto("/summarizer")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear cache")

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
    await gotoSummarizer(page, "channels")
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
    await gotoSummarizer(page, "channels")
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
    await gotoSummarizer(page, "channels")
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
    await page.goto("/summarizer?tab=posts")
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
    await page.goto("/summarizer")
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

  test("K15: clear indexeddb table confirm cancel via keyboard", async ({
    page,
  }) => {
    await enableAdvancedMode(page)
    await gotoSummarizer(page, "summary")

    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear indexeddb")
    await pickEntityFilterKeyboard(page, "translations")

    await expect(page.getByTestId("command-palette-confirm")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("command-palette-confirm")).not.toBeVisible()
    await expect(page.getByPlaceholder("Filter...")).toBeVisible()
  })

  test("K16: deselect channel multi-pick via keyboard", async ({ page }) => {
    await gotoSummarizer(page, "channels")
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
    await gotoSummarizer(page, "channels")
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
    await gotoSummarizer(page, "channels")
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

  test("channel grid loads more cards on first visit when scrolling", async ({
    page,
  }) => {
    const prefix = `scroll${Date.now()}`
    await gotoSummarizer(page, "summary")
    await seedBulkChannels(page, 25, prefix)

    await page.goto("/summarizer?tab=channels")
    await expect(page.getByTestId("command-palette-button")).toBeVisible()
    await page.getByPlaceholder("Search channels...").fill(prefix)

    const seededCards = page.locator(`[data-channel-name^="${prefix}"]`)
    await expect(seededCards).toHaveCount(20, { timeout: 30_000 })

    const scrollContainer = page.getByTestId("workspace-scroll")
    await scrollContainer.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    await expect(seededCards).toHaveCount(25, { timeout: 10_000 })
  })
})
