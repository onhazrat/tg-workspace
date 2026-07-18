import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

import { seedTestChannel } from "./utils/seed-channel"

async function gotoSummarizer(page: Page, tab = "channels") {
  await page.goto(`/summarizer?tab=${tab}`)
  await expect(page.locator(`#tour-tab-${tab}`)).toBeVisible()
}

async function openSettingsSection(page: Page, sectionLabel: string) {
  await gotoSummarizer(page, "settings")
  await expect(page.getByText("Engine Room")).toBeVisible()
  await page.getByRole("button", { name: sectionLabel, exact: true }).click()
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((next) => {
    localStorage.setItem("vite-ui-theme", next)
  }, theme)
  await page.reload()
  await expect(page.locator("html")).toHaveClass(new RegExp(theme))
}

test.describe("TG UI primitives", () => {
  test("primary and ghost buttons expose hover/focus classes in light and dark", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme)

      const primary = page.getByRole("button", { name: /Sync All/i })
      await expect(primary).toBeVisible()
      await expect(primary).toHaveAttribute("data-slot", "tg-button")
      await expect(primary).toHaveAttribute("data-variant", "primary")
      const primaryClass = (await primary.getAttribute("class")) ?? ""
      expect(primaryClass).toContain("hover:opacity-90")
      expect(primaryClass).toContain("focus-visible:ring-2")

      const ghost = page.getByRole("button", { name: /^All$/i })
      await expect(ghost).toHaveAttribute("data-slot", "tg-button")
      const ghostClass = (await ghost.getAttribute("class")) ?? ""
      expect(ghostClass).toContain("hover:bg-app-ink/5")
      expect(ghostClass).toContain("focus-visible:ring-2")
    }
  })

  test("channel search muted input and settings field accept input", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    const search = page.getByPlaceholder("Search channels...")
    await expect(search).toHaveAttribute("data-slot", "tg-input")
    await search.fill("alpha")
    await expect(search).toHaveValue("alpha")

    // Scraping & Sync exposes TgInput without Advanced Mode / proxy gates.
    await openSettingsSection(page, "Scraping & Sync")
    const settingsField = page.locator('[data-slot="tg-input"]').first()
    await expect(settingsField).toBeVisible()
    await settingsField.fill("42")
    await expect(settingsField).toHaveValue("42")
  })

  test("diagnostics segmented control switches Logs/Telemetry", async ({
    page,
  }) => {
    await openSettingsSection(page, "Diagnostics")
    const segmented = page.locator('[data-slot="tg-segmented-control"]')
    await expect(segmented).toBeVisible()
    await segmented.getByRole("button", { name: /Network Telemetry/i }).click()
    await expect(
      segmented.getByRole("button", { name: /Network Telemetry/i }),
    ).toHaveAttribute("data-selected", "true")
    await segmented.getByRole("button", { name: /View Logs/i }).click()
    await expect(
      segmented.getByRole("button", { name: /View Logs/i }),
    ).toHaveAttribute("data-selected", "true")
  })

  test("logs clear-all uses TgConfirmDialog", async ({ page }) => {
    await openSettingsSection(page, "Diagnostics")
    const clearButton = page.getByRole("button", { name: /Clear .* Logs/i })
    await expect(clearButton).toBeVisible()
    await clearButton.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Clear all logs/i)).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).not.toBeVisible()
  })

  test("group filter chips and post filter chips use primitives", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)
    const selectionChip = page
      .locator('[data-slot="tg-selection-chip"]')
      .first()
    await expect(selectionChip).toBeVisible()
    // Do not click group chips here — toggling a large group can stall the UI.

    await page.getByRole("button", { name: "Posts" }).click()
    // Quick-range chips have no selected prop; use a post-type chip that does.
    const filterChip = page.getByRole("button", { name: "Original Only" })
    await expect(filterChip).toHaveAttribute("data-slot", "tg-filter-chip")
    await expect(filterChip).toBeVisible()
    await filterChip.click()
    await expect(filterChip).toHaveAttribute("data-selected", "true")
  })

  test("history empty state uses TgHeroEmptyState", async ({ page }) => {
    await gotoSummarizer(page, "history")
    await expect(
      page.locator('[data-slot="tg-hero-empty-state"]'),
    ).toBeVisible()
  })

  test("Sync All shows in-button loading while sync request is in flight", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/v1/jobs/sync**", async (route) => {
      await gate
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "playwright-sync-job" }),
      })
    })

    const syncAll = page.getByRole("button", { name: /Sync All/i })
    await syncAll.click()
    await expect(syncAll).toHaveAttribute("aria-busy", "true")
    release?.()
  })
})
