import { test as setup } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { seedScopedStorage } from "./utils/scoped-storage.ts"

const authFile = "playwright/.auth/user.json"

setup("authenticate", async ({ page }) => {
  await page.goto("/login")
  await page.getByTestId("email-input").fill(firstSuperuser)
  await page.getByTestId("password-input").fill(firstSuperuserPassword)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL(/\/summarizer/)
  // Namespaced, so the app actually reads them back — and seeded *after* the
  // login, because the namespace is derived from the token the login issued.
  await seedScopedStorage(page, { hasSeenTour: "true", selectedChannels: "[]" })
  await page.context().storageState({ path: authFile })
})
