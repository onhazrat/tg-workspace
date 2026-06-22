import { expect, test } from "@playwright/test"

import { WORKSPACE_TABS } from "../src/constants"

test.describe("TG Summarizer", () => {
  test("summarizer shell renders workspace tabs", async ({ page }) => {
    await page.goto("/summarizer")

    for (const tab of WORKSPACE_TABS) {
      await expect(page.getByRole("button", { name: tab.label })).toBeVisible()
    }
  })

  test("settings tab URL opens Engine Room with network section", async ({
    page,
  }) => {
    await page.goto("/summarizer?tab=settings&section=network")

    await expect(page.getByText("Engine Room")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Network & Security" }),
    ).toBeVisible()
    await expect(page).toHaveURL(/tab=settings/)
    await expect(page).toHaveURL(/section=network/)
  })

  test("summary tab shows Copy Prompt button", async ({ page }) => {
    await page.goto("/summarizer?tab=summary")

    await expect(
      page.getByRole("button", { name: "Copy Prompt" }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Generate Summary" }),
    ).toBeVisible()
  })
})
