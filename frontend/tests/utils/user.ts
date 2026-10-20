import type { Page } from "@playwright/test"
import { seedScopedStorage } from "./scoped-storage.ts"

export async function signUpNewUser(
  page: Page,
  name: string,
  email: string,
  password: string,
) {
  await page.goto("/signup")

  await page.getByTestId("full-name-input").fill(name)
  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByTestId("confirm-password-input").fill(password)
  await page.getByRole("button", { name: "Sign Up" }).click()
  await page.goto("/login")
}

export async function logInUser(page: Page, email: string, password: string) {
  await page.goto("/login")

  await page.getByTestId("email-input").fill(email)
  await page.getByTestId("password-input").fill(password)
  await page.getByRole("button", { name: "Log In" }).click()
  await page.waitForURL(/\/\?.*tab=channels/)
  await seedScopedStorage(page, { hasSeenTour: "true" })
}

export async function logOutUser(page: Page) {
  // Sign out lives in Settings, Account since the template sidebar left (SET-01).
  await page.goto("/settings")
  await page.getByRole("button", { name: "Sign out" }).click()
  await page.waitForURL("/login")
}
