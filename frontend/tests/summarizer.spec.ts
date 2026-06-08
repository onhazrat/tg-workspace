import { expect, test } from "@playwright/test"

import { WORKSPACE_TABS } from "../src/constants"

test.describe("TG Summarizer", () => {
  test("summarizer shell renders workspace tabs", async ({ page }) => {
    await page.goto("/summarizer")

    for (const tab of WORKSPACE_TABS) {
      await expect(page.getByRole("button", { name: tab.label })).toBeVisible()
    }
  })
})
