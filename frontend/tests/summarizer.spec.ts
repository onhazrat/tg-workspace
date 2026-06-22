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
})
