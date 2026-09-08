import { expect, test } from "@playwright/test"

import {
  seedPartialHistoryChannel,
  seedTestChannel,
} from "./utils/seed-channel"
import {
  entityChannelInputPlaceholder,
  gotoWorkspace,
} from "./utils/summarizer-helpers.ts"

test.describe("TG Workspace palette", () => {
  test("command palette opens via shortcut and header button", async ({
    page,
  }) => {
    await page.goto("/workspace")

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
    await page.goto("/workspace?tab=summary")
    await page.getByTestId("command-palette-button").click()

    await page.getByPlaceholder("Type a command...").fill("channels")
    await page.getByRole("option", { name: "Go to Channels" }).click()

    await expect(page).toHaveURL(/tab=channels/)
    await expect(page.locator("#tour-tab-channels")).toHaveClass(
      /border-app-ink/,
    )
  })

  test("command palette toggles theme", async ({ page }) => {
    await page.goto("/workspace")
    await page.evaluate(() => localStorage.setItem("vite-ui-theme", "light"))
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
    await gotoWorkspace(page, "channels")
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
    await gotoWorkspace(page, "channels")
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
    await page.goto("/workspace")

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
    await gotoWorkspace(page, "channels")
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
    await gotoWorkspace(page, "channels")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("delete channel")
    const deleteOption = page.getByRole("option", {
      name: /Remove Channel/,
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
    await expect(page.getByText(/Remove @/)).toBeVisible()
  })

  test("command palette search posts opens in-palette results", async ({
    page,
  }) => {
    await page.goto("/workspace?tab=posts")
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
    await gotoWorkspace(page, "summary")
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
    await page.goto("/workspace?tab=channels")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("reload channels")
    await expect(
      page.getByRole("option", { name: "Reload Channels", exact: true }),
    ).toBeVisible()
  })

  test("command palette clear post filters command is available", async ({
    page,
  }) => {
    await page.goto("/workspace?tab=posts")
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("clear post filters")
    await expect(
      page.getByRole("option", { name: "Clear Post Filters", exact: true }),
    ).toBeVisible()
  })

  test("command palette fix all partial history command is available", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
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
    await gotoWorkspace(page, "channels")
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
    await gotoWorkspace(page, "summary")
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
