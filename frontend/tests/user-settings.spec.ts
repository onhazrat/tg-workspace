import type { Page } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { expect, test } from "./fixtures.ts"
import { createUser } from "./utils/privateApi.ts"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser, logOutUser } from "./utils/user"

/**
 * The Account topic of the Settings page (SET-03): who is signed in, name and
 * email saved inline like a row, the password form behind a pill, today's
 * usage, and deleting the Account behind a confirmation.
 */
const panel = (page: Page, id: string) =>
  page.locator(`#setting-account-yours-${id}`)

test("/settings lands on Account › Profile and names who is signed in", async ({
  page,
}) => {
  await page.goto("/settings")
  await expect(panel(page, "profile")).toBeVisible()
  await expect(panel(page, "signIn")).toContainText(firstSuperuser)
  await expect(
    panel(page, "signIn").getByRole("button", { name: "Sign out" }),
  ).toBeVisible()
})

test("Usage shows this account's three Budgets as GET /quota/me reports them", async ({
  page,
}) => {
  const labels: Record<string, string> = {
    auto_sync: "Scheduled syncing",
    manual_bulk: "Bulk actions",
    manual_single: "Single-channel syncs",
  }
  const statusText: Record<string, string> = {
    normal: "Normal priority",
    degraded: "Low priority",
    blocked: "Paused until UTC midnight",
  }
  const limit = (value: number | null) =>
    value === null ? "no limit" : String(value)

  const quota = page.waitForResponse(
    (r) => r.url().includes("/api/v1/quota/me") && r.ok(),
  )
  await page.goto("/settings")
  const { budgets } = (await (await quota).json()) as {
    budgets: {
      budget: string
      spent: number
      allowance: number | null
      ceiling: number | null
      status: string
      lifted: boolean
    }[]
  }

  expect(budgets.map((b) => b.budget).sort()).toEqual(Object.keys(labels))
  for (const b of budgets) {
    await expect(
      panel(page, "usage")
        .getByRole("row", { name: new RegExp(labels[b.budget]) })
        .getByRole("cell"),
    ).toHaveText([
      labels[b.budget],
      String(b.spent),
      limit(b.allowance),
      limit(b.ceiling),
      statusText[b.status] + (b.lifted ? " (limit lifted today)" : ""),
    ])
  }
})

test("a superuser is told it cannot delete its own account", async ({
  page,
}) => {
  await page.goto("/settings")
  await expect(panel(page, "delete")).toContainText(
    "cannot delete its own account",
  )
  await expect(
    panel(page, "delete").getByRole("button", { name: "Delete my account" }),
  ).toHaveCount(0)
})

test.describe("an ordinary account", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("deletes itself after confirming, and is signed out", async ({
    page,
  }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/settings")
    await panel(page, "delete")
      .getByRole("button", { name: "Delete my account" })
      .click()
    const confirm = page.getByRole("dialog", { name: "Delete your account?" })
    await expect(confirm).toContainText("cannot be undone")
    await confirm.getByRole("button", { name: "Delete account" }).click()
    await page.waitForURL("/login")
  })
})

test.describe("Edit the profile inline", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeEach(async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)
    await page.goto("/settings")
  })

  test("a name saves on Enter and survives a reload", async ({ page }) => {
    const name = panel(page, "profile").getByLabel("Full name")
    await name.fill("Test User 2")
    await name.press("Enter")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await page.reload()
    await expect(panel(page, "profile").getByLabel("Full name")).toHaveValue(
      "Test User 2",
    )
  })

  test("Escape puts the name back", async ({ page }) => {
    const name = panel(page, "profile").getByLabel("Full name")
    const original = await name.inputValue()
    await name.fill("Never saved")
    await name.press("Escape")
    await expect(name).toHaveValue(original)
  })

  test("an invalid email is refused on the row", async ({ page }) => {
    const field = panel(page, "profile").getByLabel("Email")
    await field.fill("not-an-email")
    await field.press("Enter")
    await expect(
      panel(page, "profile").getByText("Invalid email address"),
    ).toBeVisible()
  })

  test("a valid email saves", async ({ page }) => {
    const updated = randomEmail()
    const field = panel(page, "profile").getByLabel("Email")
    await field.fill(updated)
    await field.press("Enter")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await expect(panel(page, "signIn")).toContainText(updated)
  })
})

test.describe("Change password", () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let email: string
  let password: string

  const form = (page: Page) => page.getByRole("dialog")
  async function change(
    page: Page,
    current: string,
    next: string,
    again = next,
  ) {
    await panel(page, "password")
      .getByRole("button", { name: "Change password" })
      .click()
    await form(page).getByLabel("Current password").fill(current)
    await form(page).getByLabel("New password", { exact: true }).fill(next)
    await form(page).getByLabel("New password again").fill(again)
    await form(page).getByRole("button", { name: "Change" }).click()
  }

  test.beforeEach(async ({ page }) => {
    email = randomEmail()
    password = randomPassword()
    await createUser({ email, password })
    await logInUser(page, email, password)
    await page.goto("/settings")
  })

  test("a new password works at the next sign-in", async ({ page }) => {
    const newPassword = randomPassword()
    await change(page, password, newPassword)
    await expect(page.getByText("Password updated successfully")).toBeVisible()
    await logOutUser(page)
    await logInUser(page, email, newPassword)
  })

  test("a weak password is refused", async ({ page }) => {
    await change(page, password, "weak")
    await expect(
      form(page).getByText("Password must be at least 8 characters"),
    ).toBeVisible()
  })

  test("two different new passwords are refused", async ({ page }) => {
    await change(page, password, randomPassword(), randomPassword())
    await expect(
      form(page).getByText("The passwords don't match"),
    ).toBeVisible()
  })

  test("the current password again is refused by the server", async ({
    page,
  }) => {
    await change(page, password, password)
    await expect(
      form(page).getByText(
        "New password cannot be the same as the current one",
      ),
    ).toBeVisible()
  })
})

/**
 * The theme lives in Settings, Appearance since the template sidebar and its
 * appearance menu left (SET-01).
 */
const APPEARANCE = "/?tab=settings&section=appearance"

async function chooseTheme(page: Page, mode: "Light" | "Dark" | "System") {
  await page
    .getByRole("group", { name: "Color theme" })
    .getByRole("button", { name: mode, exact: true })
    .click()
}

test("User can switch between theme modes", async ({ page }) => {
  await page.goto(APPEARANCE)

  await chooseTheme(page, "Dark")
  await expect(page.locator("html")).toHaveClass(/dark/)

  await chooseTheme(page, "Light")
  await expect(page.locator("html")).toHaveClass(/light/)

  await chooseTheme(page, "System")
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vite-ui-theme")))
    .toBe("system")
})

test("Selected mode is preserved across sessions", async ({ page }) => {
  await page.goto(APPEARANCE)

  // Pick light, then dark, so the stored value changes whatever it was.
  await chooseTheme(page, "Light")
  await expect(page.locator("html")).toHaveClass(/light/)

  await chooseTheme(page, "Dark")
  await expect(page.locator("html")).toHaveClass(/dark/)

  await logOutUser(page)
  await logInUser(page, firstSuperuser, firstSuperuserPassword)

  await expect(page.locator("html")).toHaveClass(/dark/)
})
