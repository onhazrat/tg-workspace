import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

import { WORKSPACE_TABS } from "../src/constants"

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

    await page.getByTitle("Settings & Engine Room").click()
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

    const html = page.locator("html")
    const initialHasDark = await html.evaluate((node) =>
      node.classList.contains("dark"),
    )

    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("toggle theme")
    await page.getByRole("option", { name: "Toggle Theme" }).click()

    await expect
      .poll(async () =>
        html.evaluate((node) => node.classList.contains("dark")),
      )
      .not.toBe(initialHasDark)
  })

  test("command palette copies all channel names", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await gotoSummarizer(page, "channels")

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("copy list of all channels")
    await page
      .getByRole("option", { name: "Copy List of All Channels" })
      .click()

    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()), {
        timeout: 15_000,
      })
      .not.toBe("")
  })

  test("command palette export selected channels uses jsonl", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")

    const selectChannel = page.getByRole("button", { name: /^Select / }).first()
    if (await selectChannel.isVisible()) {
      await selectChannel.click()
    }

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
    await page.goto("/summarizer?tab=channels")
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
