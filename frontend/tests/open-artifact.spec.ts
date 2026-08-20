import { expect, test } from "@playwright/test"

import { seedArtifacts, WIDE_SUMMARY_ID } from "./utils/seed-artifacts"

/**
 * Opening an artifact from History must actually show it.
 *
 * This shipped broken twice. The first time, History wrote `?summary=` and
 * nothing read it. The second time the id arrived correctly and the *view*
 * still rendered nothing, because the body came from `AIContext`'s streaming
 * buffer — which only generating or pasting ever fills. Deleting the old
 * restore path took both halves with it, and neither loss was a type error.
 *
 * So this asserts the thing a user actually does, end to end, for the two
 * kinds that hold a body: click the row, see the content.
 */

test.beforeEach(async ({ page }) => {
  await seedArtifacts(page)
})

test("opening a summary from History renders its body", async ({ page }) => {
  await page.goto("/summarizer?tab=history")
  const card = page.locator('[data-artifact-id="e2e-open-summary"]')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole("button").first().click()

  await expect(page).toHaveURL(/tab=summary/)
  await expect(page).toHaveURL(/summary=e2e-open-summary/)
  await expect(page.getByText("Three things happened this week")).toBeVisible({
    timeout: 20_000,
  })
})

test("a summary opens from its URL alone", async ({ page }) => {
  await page.goto("/summarizer?tab=summary&summary=e2e-open-summary")
  await expect(page.getByText("Three things happened this week")).toBeVisible({
    timeout: 20_000,
  })
})

test("opening a chat from History renders its transcript", async ({ page }) => {
  await page.goto("/summarizer?tab=history")
  const card = page.locator('[data-artifact-id="e2e-open-chat"]')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole("button").first().click()

  await expect(page).toHaveURL(/tab=chat/)
  await expect(page.getByText("three things")).toBeVisible({ timeout: 20_000 })
})

/**
 * The same list, measured rather than read.
 *
 * `truncate` was on the channel line from the start and did nothing: a grid
 * item defaults to `min-width: auto`, so the track sized to max-content and the
 * card came out 17,374px wide. Nothing in the type system or the class strings
 * says that — only the layout does, which is why this assertion is in a browser
 * and compares numbers.
 */
test("a card with hundreds of channels does not widen the page", async ({
  page,
}) => {
  await page.goto("/summarizer?tab=history")
  const card = page.locator(`[data-artifact-id="${WIDE_SUMMARY_ID}"]`)
  await expect(card).toBeVisible({ timeout: 20_000 })

  const scroller = page.getByTestId("workspace-scroll")
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)

  const cardBox = await card.boundingBox()
  const scrollerBox = await scroller.boundingBox()
  expect(cardBox).not.toBeNull()
  expect(scrollerBox).not.toBeNull()
  expect(cardBox!.width).toBeLessThanOrEqual(scrollerBox!.width)
})
