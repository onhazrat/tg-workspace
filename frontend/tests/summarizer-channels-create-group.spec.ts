/**
 * The Channels tab's Groups dropdown creates a Setting group from its search,
 * against the real backend: the group it lists afterwards is the one the
 * server stored, not one the dropdown made up.
 */
import { expect, test } from "./fixtures.ts"
import { gotoWorkspace } from "./utils/summarizer-helpers.ts"

test("the Groups search creates a group no row has, and lists it", async ({
  page,
}) => {
  const name = `E2E group ${Date.now()}`
  await gotoWorkspace(page, "channels")
  await page.getByTestId("channel-groups").click()
  const search = page.getByPlaceholder("Search groups...")
  const create = page.getByTestId("channel-groups-create")

  await expect(page.getByText("Type a name to create a group")).toBeVisible()
  await search.fill("DEFAULT")
  await expect(create).toHaveCount(0)

  await search.fill(name)
  await expect(create).toHaveText(`Create group "${name}"`)
  await create.click()

  await expect(page.getByText(`Created group "${name}"`)).toBeVisible()
  await expect(search).toHaveValue("")
  await expect(
    page.locator('[data-testid^="channel-groups-row-"]', { hasText: name }),
  ).toBeVisible()

  // TGU-04: its gear opens that group in Settings.
  await page.getByRole("button", { name: `Open ${name}'s settings` }).click()
  await expect(page).toHaveURL(/tab=settings/)
  await expect(
    page.getByRole("button", { name, expanded: true, exact: true }),
  ).toBeVisible()
})
