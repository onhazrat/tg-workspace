import type { Page } from "@playwright/test"
import { firstSuperuser, firstSuperuserPassword } from "./config.ts"
import { expect, test } from "./fixtures.ts"
import { createUser } from "./utils/privateApi"
import { randomEmail, randomPassword } from "./utils/random"
import { logInUser } from "./utils/user"

/**
 * The Operator topic of the Settings page (SET-03): users as a table with an
 * Add user form and every row action, quota overrides, and usage with Lift
 * today. Forms open from a pill in a popover; destructive actions confirm.
 */
const users = (page: Page) => page.locator("#setting-operator-deployment-users")
const row = (page: Page, email: string) =>
  page.getByTestId("users-table").getByRole("row").filter({ hasText: email })
const popover = (page: Page) => page.getByRole("dialog")

async function openAddUser(page: Page) {
  await page.goto("/admin")
  await users(page).getByRole("button", { name: "Add user" }).click()
}

async function addUser(
  page: Page,
  email: string,
  password: string,
  fullName?: string,
) {
  await openAddUser(page)
  await popover(page).getByLabel("Email").fill(email)
  if (fullName) await popover(page).getByLabel("Full name").fill(fullName)
  await popover(page).getByLabel("Password", { exact: true }).fill(password)
  await popover(page).getByLabel("Password again").fill(password)
  await popover(page).getByRole("button", { name: "Create user" }).click()
  await expect(page.getByText("User created successfully")).toBeVisible()
  // Closing hands focus back to the Add user pill, which scrolls the page to
  // it; a popover opened before that would be carried off screen with its pill.
  await expect(popover(page)).toHaveCount(0)
  await expect(row(page, email)).toBeVisible()
}

test("/admin lands on Operator › Users", async ({ page }) => {
  await page.goto("/admin")
  await expect(users(page)).toBeVisible()
  await expect(
    users(page).getByRole("button", { name: "Add user" }),
  ).toBeVisible()
  await expect(row(page, firstSuperuser)).toContainText("you")
})

test.describe("Admin user management", () => {
  test("Create a new user", async ({ page }) => {
    const email = randomEmail()
    await addUser(page, email, randomPassword(), "Test User Admin")
    await expect(row(page, email)).toContainText("Test User Admin")
    await expect(row(page, email)).toContainText("Member")
    await expect(row(page, email)).toContainText("Active")
  })

  test("Create an Admin", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()
    await openAddUser(page)
    await popover(page).getByLabel("Email").fill(email)
    await popover(page).getByLabel("Password", { exact: true }).fill(password)
    await popover(page).getByLabel("Password again").fill(password)
    await popover(page).getByRole("button", { name: "Admin" }).click()
    await popover(page).getByRole("button", { name: "Create user" }).click()
    await expect(page.getByText("User created successfully")).toBeVisible()
    await expect(row(page, email)).toContainText("Admin")
  })

  test("Edit a user", async ({ page }) => {
    const email = randomEmail()
    await addUser(page, email, randomPassword(), "Original Name")
    await row(page, email)
      .getByRole("button", { name: `Edit ${email}` })
      .click()
    const name = popover(page).getByLabel("Full name")
    await expect(name).toHaveValue("Original Name")
    await name.fill("Updated Name")
    await popover(page).getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("User updated successfully")).toBeVisible()
    await expect(row(page, email)).toContainText("Updated Name")
  })

  test("Approve an account waiting for approval", async ({ page }) => {
    const email = randomEmail()
    await addUser(page, email, randomPassword())
    // Unapprove it from the edit form, then approve it from its row.
    await row(page, email)
      .getByRole("button", { name: `Edit ${email}` })
      .click()
    await popover(page).getByRole("button", { name: "Approved" }).click()
    await popover(page).getByRole("button", { name: "Save" }).click()
    await expect(row(page, email)).toContainText("Waiting for approval")
    await row(page, email)
      .getByRole("button", { name: `Approve ${email}` })
      .click()
    await expect(row(page, email)).toContainText("Active")
    await expect(
      row(page, email).getByRole("button", { name: `Approve ${email}` }),
    ).toHaveCount(0)
  })

  test("Delete a user, after confirming", async ({ page }) => {
    const email = randomEmail()
    await addUser(page, email, randomPassword())
    await row(page, email)
      .getByRole("button", { name: `Delete ${email}` })
      .click()
    const confirm = page.getByRole("dialog", { name: `Delete ${email}?` })
    await expect(confirm).toContainText("permanently")
    await confirm.getByRole("button", { name: "Delete" }).click()
    await expect(
      page.getByText("The user was deleted successfully"),
    ).toBeVisible()
    await expect(row(page, email)).toHaveCount(0)
  })

  test("Email must be valid", async ({ page }) => {
    await openAddUser(page)
    await popover(page).getByLabel("Email").fill("invalid-email")
    await popover(page).getByRole("button", { name: "Create user" }).click()
    await expect(popover(page).getByText("Invalid email address")).toBeVisible()
  })

  test("Password must be at least 8 characters", async ({ page }) => {
    await openAddUser(page)
    await popover(page).getByLabel("Email").fill(randomEmail())
    await popover(page).getByLabel("Password", { exact: true }).fill("short")
    await popover(page).getByLabel("Password again").fill("short")
    await popover(page).getByRole("button", { name: "Create user" }).click()
    await expect(
      popover(page).getByText("Password must be at least 8 characters"),
    ).toBeVisible()
  })

  test("Passwords must match", async ({ page }) => {
    await openAddUser(page)
    await popover(page).getByLabel("Email").fill(randomEmail())
    await popover(page)
      .getByLabel("Password", { exact: true })
      .fill(randomPassword())
    await popover(page).getByLabel("Password again").fill("different12345")
    await popover(page).getByRole("button", { name: "Create user" }).click()
    await expect(
      popover(page).getByText("The passwords don't match"),
    ).toBeVisible()
  })

  test("Escape closes the form without creating anyone", async ({ page }) => {
    await openAddUser(page)
    await popover(page).getByLabel("Email").fill("test@example.com")
    await page.keyboard.press("Escape")
    await expect(popover(page)).toHaveCount(0)
    await expect(row(page, "test@example.com")).toHaveCount(0)
  })
})

test.describe("Quota", () => {
  const overrides = (page: Page) =>
    page.locator("#setting-operator-deployment-quotaOverrides")
  const usage = (page: Page) =>
    page.locator("#setting-operator-deployment-usage")

  test("an override is saved for one account and cleared", async ({ page }) => {
    const email = randomEmail()
    await addUser(page, email, randomPassword())
    await overrides(page).getByRole("button", { name: "Override" }).click()
    await popover(page).getByLabel("Account").selectOption({ label: email })
    await popover(page).getByRole("button", { name: "Bulk actions" }).click()
    await popover(page).getByLabel("Allowance").fill("0")
    await popover(page).getByLabel("Ceiling").fill("500")
    await popover(page).getByRole("button", { name: "Save override" }).click()
    const saved = overrides(page)
      .getByTestId("quota-overrides")
      .getByRole("row")
      .filter({ hasText: email })
    await expect(saved).toHaveCount(1)
    await expect(saved).toContainText("Bulk actions")
    await expect(saved.getByRole("cell").nth(2)).toHaveText("0")
    await expect(saved.getByRole("cell").nth(3)).toHaveText("500")

    await saved
      .getByRole("button", { name: `Clear Bulk actions for ${email}` })
      .click()
    await page
      .getByRole("dialog", { name: "Clear this override?" })
      .getByRole("button", { name: "Clear" })
      .click()
    await expect(saved).toHaveCount(0)
  })

  test("Lift today reaches an account that spent nothing", async ({ page }) => {
    const email = randomEmail()
    await addUser(page, email, randomPassword())
    const account = usage(page)
      .getByTestId("quota-usage")
      .getByRole("row")
      .filter({ hasText: email })
    await account
      .getByRole("button", { name: `Lift today for ${email}` })
      .click()
    await expect(page.getByText("Lifted until UTC midnight")).toBeVisible()
    await expect(account).toContainText("Lifted today")
  })
})

test.describe("Admin page access control", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("an ordinary account sees no Operator panels", async ({ page }) => {
    const email = randomEmail()
    const password = randomPassword()

    await createUser({ email, password })
    await logInUser(page, email, password)

    await page.goto("/admin")

    // /admin lands on the Settings page (SET-01), which shows the Users
    // panel only to an Account holding users:read (SET-02).
    await expect(page).not.toHaveURL(/\/admin/)
    await expect(page.getByTestId("settings-search")).toBeVisible()
    await expect(page.locator("#setting-account-yours-profile")).toBeVisible()
    await expect(users(page)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Add user" })).toHaveCount(0)
  })

  test("the first superuser sees them", async ({ page }) => {
    await logInUser(page, firstSuperuser, firstSuperuserPassword)
    await page.goto("/admin")
    await expect(users(page)).toBeVisible()
  })
})
