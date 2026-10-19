import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

/**
 * SET-01: the workspace lives at `/`, every old address lands somewhere in
 * it, and the tools have a tab of their own.
 */

function strip(page: Page) {
  return page.getByRole("navigation", { name: "Workspace sections" })
}

test.describe("the workspace at /", () => {
  test("/workspace and /summarizer keep their query string", async ({
    page,
  }) => {
    await page.goto("/workspace?tab=posts")
    await expect(page).toHaveURL(/^[^?]*\/\?tab=posts$/)
    await page.goto("/summarizer?tab=history")
    await expect(page).toHaveURL(/^[^?]*\/\?tab=history$/)
  })

  test("/settings opens Settings on Account › Profile", async ({ page }) => {
    await page.goto("/settings")
    await expect(page).toHaveURL(/tab=settings/)
    await expect(page).toHaveURL(/setting=account\.yours\.profile/)
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible()
  })

  test("/admin opens Settings on Operator › Users", async ({ page }) => {
    await page.goto("/admin")
    await expect(page).toHaveURL(/tab=settings/)
    await expect(page).toHaveURL(/setting=operator\.deployment\.users/)
    await expect(page.getByTestId("users-table")).toBeVisible()
  })
})

test.describe("the Tools tab", () => {
  test("opens from +, once, and closes", async ({ page }) => {
    await page.goto("/?tab=channels")
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("workspace-tab-add").click()
      await page.getByRole("menuitem", { name: "Tools" }).click()
      await expect(page.getByRole("menu")).toBeHidden()
    }
    await expect(page).toHaveURL(/tab=tools/)
    await expect(strip(page).locator('a[href*="tab=tools"]')).toHaveCount(1)

    await strip(page).getByRole("button", { name: "Close Tools" }).click()
    await expect(strip(page).locator('a[href*="tab=tools"]')).toHaveCount(0)
  })

  test("an Operator gets every tool", async ({ page }) => {
    await page.goto("/?tab=tools")
    for (const tool of [
      "logs",
      "quick-message",
      "network-telemetry",
      "database",
    ]) {
      await expect(page.getByTestId(`tool-${tool}`)).toBeVisible()
    }
  })

  test.describe("a plain Account", () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test("gets Logs and Quick message and nothing gated", async ({ page }) => {
      const email = randomEmail()
      const password = randomPassword()
      await createUser({ email, password })
      await logInUser(page, email, password)

      // The gated tools show once their first read succeeds, so wait for both
      // refusals before asserting they stayed hidden.
      const refused = (path: string) =>
        page.waitForResponse(
          (r) => r.url().includes(path) && r.status() === 403,
        )
      const stats = refused("/api/v1/data/stats")
      const networkLogs = refused("/api/v1/data/logs/network")
      await page.goto("/?tab=tools")
      await Promise.all([stats, networkLogs])
      await expect(page.getByTestId("tool-logs")).toBeVisible()
      await expect(page.getByTestId("tool-quick-message")).toBeVisible()
      await expect(page.getByTestId("tool-network-telemetry")).toHaveCount(0)
      await expect(page.getByTestId("tool-database")).toHaveCount(0)
    })
  })
})
