import { expect, test } from "@playwright/test"

import { WORKSPACE_TABS } from "../src/constants"

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

    const modifier = process.platform === "darwin" ? "Meta" : "Control"
    await page.keyboard.press(`${modifier}+Shift+KeyP`)
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
    await page.goto("/summarizer?tab=channels")

    await page.getByTestId("command-palette-button").click()
    await page
      .getByPlaceholder("Type a command...")
      .fill("copy list of all channels")
    await page
      .getByRole("option", { name: "Copy List of All Channels" })
      .click()

    await expect
      .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
      .not.toBe("")
  })

  test("command palette export selected channels uses jsonl", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=channels")

    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    if (await firstCheckbox.isVisible()) {
      await firstCheckbox.check()
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
    await page.goto("/summarizer?tab=channels")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("delete channel")
    const deleteOption = page.getByRole("option", {
      name: "Delete Channel",
      exact: true,
    })
    await expect(deleteOption).toBeVisible()
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
    ).toBeVisible()
  })

  test("command palette search summaries opens in-palette results", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=history")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("search summaries")
    await page
      .getByRole("option", { name: "Search Summaries", exact: true })
      .click()
    await page.getByRole("button", { name: "Apply" }).click()
    await expect(
      page.getByTestId("command-palette-search-results"),
    ).toBeVisible()
  })
})
