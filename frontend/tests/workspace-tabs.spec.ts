import type { Page } from "@playwright/test"

import { expect, test } from "./fixtures.ts"
import {
  OPEN_CHAT_ID,
  OPEN_SUMMARY_BODY,
  OPEN_SUMMARY_ID,
  seedArtifacts,
  WIDE_SUMMARY_ID,
} from "./utils/seed-artifacts"

/**
 * The workspace tabs behave like browser tabs (TABS-01).
 *
 * Every rule is pinned in `src/lib/workspace-tabs.test.ts`; this checks the
 * wiring a unit test cannot see: the strip, the URL, storage and History
 * agreeing with the model.
 */

const FIXED = ["channels", "posts", "action"]
const OPEN = `summary:${OPEN_SUMMARY_ID}`
const WIDE = `summary:${WIDE_SUMMARY_ID}`

function strip(page: Page) {
  return page.getByRole("navigation", { name: "Workspace sections" })
}

/** The strip as `kind` or `kind:id`, read off each tab link's href. */
function tabs(page: Page): Promise<string[]> {
  return strip(page)
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => {
        const params = new URL((link as HTMLAnchorElement).href).searchParams
        const id =
          params.get("summary") ??
          params.get("chatSession") ??
          params.get("tagRun") ??
          params.get("report")
        return id ? `${params.get("tab")}:${id}` : String(params.get("tab"))
      }),
    )
}

function tabLink(page: Page, id: string) {
  return strip(page).locator(`a[href*="${id}"]`)
}

/** The menu is modal, so the strip is hidden from the tree until it closes. */
async function openFromPlus(page: Page, kind: string) {
  await page.getByTestId("workspace-tab-add").click()
  await page.getByRole("menuitem", { name: kind }).click()
  await expect(page.getByRole("menu")).toBeHidden()
}

async function openFromHistory(page: Page, id: string) {
  await page.locator("#tour-tab-history").click()
  const card = page.locator(`[data-artifact-id="${id}"]`)
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole("button").first().click()
  await expect(page).toHaveURL(new RegExp(`summary=${id}`))
}

test.beforeEach(async ({ page }) => {
  await seedArtifacts(page)
})

test("each Summary opened from History gets its own tab, once", async ({
  page,
}) => {
  await page.goto("/workspace?tab=history")
  await openFromHistory(page, OPEN_SUMMARY_ID)
  await openFromHistory(page, WIDE_SUMMARY_ID)
  await expect.poll(() => tabs(page)).toEqual([...FIXED, "history", OPEN, WIDE])

  // Opening one that has a tab switches to it instead of opening a second.
  await openFromHistory(page, OPEN_SUMMARY_ID)
  await expect(tabLink(page, OPEN_SUMMARY_ID)).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect.poll(() => tabs(page)).toEqual([...FIXED, "history", OPEN, WIDE])
  await expect(page.getByText(OPEN_SUMMARY_BODY)).toBeVisible()

  // The set survives a reload.
  await page.reload()
  await expect.poll(() => tabs(page)).toEqual([...FIXED, "history", OPEN, WIDE])
})

test("× and middle-click close a tab; a Fixed tab has no ×", async ({
  page,
  context,
}) => {
  await page.goto(`/workspace?tab=summary&summary=${OPEN_SUMMARY_ID}`)
  // Stored once the strip renders it; a reload before then starts without it.
  await expect.poll(() => tabs(page)).toContain(OPEN)
  await page.goto(`/workspace?tab=summary&summary=${WIDE_SUMMARY_ID}`)
  await expect.poll(() => tabs(page)).toContain(WIDE)
  await expect.poll(() => tabs(page)).toContain(OPEN)

  // Closing the active, last tab activates the one to its left.
  await strip(page)
    .getByRole("button", { name: /^Close / })
    .last()
    .click()
  await expect(page).toHaveURL(new RegExp(`summary=${OPEN_SUMMARY_ID}`))
  await expect.poll(() => tabs(page)).not.toContain(WIDE)

  // Middle-click closes without opening a browser tab.
  await tabLink(page, OPEN_SUMMARY_ID).click({ button: "middle" })
  await expect.poll(() => tabs(page)).not.toContain(OPEN)
  expect(context.pages()).toHaveLength(1)

  await expect(
    strip(page).getByRole("button", { name: /^Close Posts$/ }),
  ).toHaveCount(0)
})

test('"+" opens an empty tab, so a closed Summary stays put away', async ({
  page,
}) => {
  await page.goto(`/workspace?tab=summary&summary=${OPEN_SUMMARY_ID}`)
  await expect(page.getByText(OPEN_SUMMARY_BODY)).toBeVisible({
    timeout: 20_000,
  })
  await strip(page)
    .getByRole("button", { name: /^Close / })
    .last()
    .click()
  await expect.poll(() => tabs(page)).not.toContain(OPEN)

  await openFromPlus(page, "Summary")

  await expect(page).toHaveURL(/tab=summary/)
  await expect(page).not.toHaveURL(/summary=/)
  await expect(page.getByText("No summary open")).toBeVisible()
  await expect.poll(() => tabs(page)).toContain("summary")

  // "+" again for the same kind focuses that empty tab rather than a second.
  await openFromPlus(page, "Summary")
  await expect
    .poll(async () => (await tabs(page)).filter((tab) => tab === "summary"))
    .toHaveLength(1)
})

test("a deep link opens its Artifact in a tab", async ({ page }) => {
  await page.goto(`/workspace?tab=chat&chatSession=${OPEN_CHAT_ID}`)
  await expect(page.getByText("three things")).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => tabs(page)).toContain(`chat:${OPEN_CHAT_ID}`)
  await expect(tabLink(page, OPEN_CHAT_ID)).toHaveAttribute(
    "aria-current",
    "page",
  )
})

/** Two Summary tabs, OPEN then WIDE; returns a reader for their order. */
async function openTwoSummaries(page: Page) {
  await page.goto(`/workspace?tab=summary&summary=${OPEN_SUMMARY_ID}`)
  await expect.poll(() => tabs(page)).toContain(OPEN)
  await page.goto(`/workspace?tab=summary&summary=${WIDE_SUMMARY_ID}`)
  const summaries = async () =>
    (await tabs(page)).filter((tab) => tab.startsWith("summary:"))
  await expect.poll(summaries).toEqual([OPEN, WIDE])
  return summaries
}

test("dragging a tab past another reorders it, and the order is kept", async ({
  page,
}) => {
  const summaries = await openTwoSummaries(page)

  // The mouse sensor waits for a 5px move, so a click stays a click.
  const from = await tabLink(page, WIDE_SUMMARY_ID).boundingBox()
  const to = await tabLink(page, OPEN_SUMMARY_ID).boundingBox()
  if (!from || !to) throw new Error("tabs not laid out")
  // The drop's click once fell through to the anchor and reloaded the page.
  await page.evaluate(() => {
    document.body.dataset.sameDocument = "yes"
  })
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 - 10, from.y + from.height / 2)
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect.poll(summaries).toEqual([WIDE, OPEN])
  expect((await tabs(page)).slice(0, 3)).toEqual(FIXED)
  await expect(page.locator("body")).toHaveAttribute(
    "data-same-document",
    "yes",
  )

  await page.reload()
  await expect.poll(summaries).toEqual([WIDE, OPEN])
})

test("Space picks a tab up and the arrow keys move it", async ({ page }) => {
  const summaries = await openTwoSummaries(page)

  // Each step is announced by the tabs' labels, never their keys, and the
  // strip is measured between steps.
  const live = page.locator("[id^=DndLiveRegion]")
  // Named "Summary" until the History lookup names its Artifact.
  await expect(tabLink(page, OPEN_SUMMARY_ID)).toHaveAttribute("title", / · /)
  const openLabel = await tabLink(page, OPEN_SUMMARY_ID).getAttribute("title")
  await tabLink(page, WIDE_SUMMARY_ID).focus()
  await page.keyboard.press("Space")
  // Picked up, then at once "moved beside" itself.
  await expect(live).toContainText("moved beside")
  await page.keyboard.press("ArrowLeft")
  await expect(live).toContainText(`moved beside ${openLabel}`)
  await page.keyboard.press("Space")
  await expect(live).toContainText("dropped")
  await expect(live).not.toContainText("summary:")

  await expect.poll(summaries).toEqual([WIDE, OPEN])
  // The moved tab keeps focus, and then Enter still follows a link rather
  // than picking its tab up.
  await expect(tabLink(page, WIDE_SUMMARY_ID)).toBeFocused()
  await tabLink(page, OPEN_SUMMARY_ID).focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`summary=${OPEN_SUMMARY_ID}`))
})
