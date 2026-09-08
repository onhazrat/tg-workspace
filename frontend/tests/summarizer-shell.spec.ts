import { expect, test } from "@playwright/test"

import { WORKSPACE_TABS } from "../src/constants"
import { seedTestChannel } from "./utils/seed-channel"
import {
  channelHasTag,
  closePaletteKeyboard,
  gotoWorkspace,
  openPaletteKeyboard,
  runPaletteCommand,
  selectChannelsKeyboard,
} from "./utils/summarizer-helpers.ts"

test.describe("TG Workspace shell", () => {
  test("legacy /summarizer redirects to /workspace", async ({ page }) => {
    await page.goto("/summarizer?tab=posts")
    await expect(page).toHaveURL(/\/workspace\?.*tab=posts/)
  })

  test("workspace shell renders workspace tabs", async ({ page }) => {
    await page.goto("/workspace")

    for (const tab of WORKSPACE_TABS) {
      await expect(page.locator(`#tour-tab-${tab.id}`)).toBeVisible()
    }
  })

  /**
   * A chat begins with a question, so the Action tab asks for one.
   *
   * The assertion stops at the user's turn on purpose. Whether the model
   * answers depends on a provider being configured, but the wiring under test
   * is everything up to the request: the draft becomes the first message, the
   * view hops to Chat, and the transcript starts empty rather than inheriting
   * whatever conversation was last open.
   */
  test("the Action tab starts a chat from its own input", async ({ page }) => {
    await page.goto("/workspace?tab=action")

    const input = page.getByTestId("action-chat-input")
    await expect(input).toBeVisible({ timeout: 15_000 })
    await input.fill("what changed in the last week?")
    await page.getByTestId("action-start-chat").click()

    await expect(page).toHaveURL(/tab=chat/, { timeout: 15_000 })
    await expect(page.getByText("what changed in the last week?")).toBeVisible({
      timeout: 15_000,
    })
  })

  test("the model and language selectors live above every action", async ({
    page,
  }) => {
    await page.goto("/workspace?tab=action")

    const bar = page.getByTestId("action-run-settings")
    await expect(bar.getByLabel("Inference model")).toBeVisible({
      timeout: 15_000,
    })
    await expect(bar.getByLabel("Output language")).toBeVisible()

    // One of each on the page — they used to be inside the Summary card, and
    // a second copy would mean two controls writing one setting.
    await expect(page.getByLabel("Inference model")).toHaveCount(1)
    await expect(page.getByLabel("Output language")).toHaveCount(1)
  })

  test("tag tab opens Tag view", async ({ page }) => {
    await page.goto("/workspace?tab=summary")
    await page.locator("#tour-tab-tag").click()

    await expect(page).toHaveURL(/tab=tag/)
    await expect(page.locator("#tour-tab-tag")).toHaveClass(/border-app-ink/)
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible()
  })

  test("tag tab loads from ?tab=tag URL", async ({ page }) => {
    await page.goto("/workspace?tab=tag")

    await expect(page).toHaveURL(/tab=tag/)
    await expect(page.locator("#tour-tab-tag")).toHaveClass(/border-app-ink/)
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible()
  })

  test("tag tab paste applies tags for all selected channels", async ({
    page,
  }) => {
    test.setTimeout(90_000)

    await gotoWorkspace(page, "channels")
    const first = await seedTestChannel(page)
    const second = await seedTestChannel(page)
    const third = await seedTestChannel(page)
    const tagName = `bulk${Date.now()}`

    await page.route("**/api/v1/ai/tag/prompt", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prompt: "tag prompt for e2e" }),
      })
    })

    await page.getByPlaceholder("Search channels...").fill("")
    await openPaletteKeyboard(page)
    await runPaletteCommand(page, "clear selection")
    await closePaletteKeyboard(page)
    await selectChannelsKeyboard(page, [first, second, third])

    for (const name of [first, second, third]) {
      await expect(
        page.locator(
          `[data-channel-name="${name}"] button[aria-pressed="true"]`,
        ),
      ).toBeVisible()
    }

    // The tag create controls — Copy Prompt, Generate, Paste Response — moved
    // to the Action tab. The Tag tab shows the preview and the applied result.
    await page.locator("#tour-tab-action").click()
    // The count lives in the workspace header now — the Tag card used to print
    // its own copy of the same number, which is one more thing to keep in step.
    await expect(page.getByTestId("header-active-channels")).toHaveText("3", {
      timeout: 15_000,
    })
    await expect(page.getByText(/batch/i)).not.toBeVisible()

    await page.getByRole("button", { name: "Copy Tag Prompt" }).click()
    await expect(
      page.getByText(/tag prompt copied/i, { exact: false }),
    ).toBeVisible({ timeout: 15_000 })

    const pastePayload = JSON.stringify({
      [`@${first}`]: [tagName],
      [second]: [tagName],
      [third]: [tagName],
    })

    await page.getByRole("button", { name: "Paste Response" }).click()
    // Named, not `locator("textarea")`: the Action tab has a chat composer of
    // its own now, so a bare tag selector matches two elements.
    await page.getByTestId("paste-tags-response").fill(pastePayload)
    await page.getByRole("button", { name: "Save Response" }).click()
    // Saving hands off to the Tag tab, which is where the suggestions render.
    await expect(page).toHaveURL(/tab=tag/, { timeout: 15_000 })
    await expect(
      page.getByText(/Parsed tag suggestions for 3 channel/i),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("(3 channels with suggestions)")).toBeVisible()
    // Selection and preview agree here, so no divergence note is warranted.
    await expect(page.getByTestId("tag-preview-scope-note")).not.toBeVisible()

    await page.getByRole("button", { name: "Apply" }).click()
    await expect(page.getByText(/Added .* tags to 3 channels/i)).toBeVisible({
      timeout: 15_000,
    })

    for (const name of [first, second, third]) {
      await expect.poll(() => channelHasTag(page, name, tagName)).toBe(true)
    }
  })

  test("settings tab opens Settings hub with network section", async ({
    page,
  }) => {
    await page.goto("/workspace?tab=summary")
    // Prefer role locators: `#nav-tab-*` CSS ids are flaky under Playwright
    // Chrome (document ID map sometimes misses React-assigned ids).
    //
    // The workspace tabs are `link`, not `button`: they navigate to `?tab=`, so
    // they are real anchors now. The settings sidebar below is still buttons.
    await expect(
      page.getByRole("link", { name: "Summary", exact: true }).first(),
    ).toBeVisible()

    await page
      .getByRole("link", { name: "Settings", exact: true })
      .first()
      .click()
    await page.getByRole("button", { name: "Network", exact: true }).click()

    await expect(page.getByTestId("settings-search")).toBeVisible()
    await expect(page).toHaveURL(/tab=settings/)
    await expect(page).toHaveURL(/section=network/)
  })

  test("action tab shows the summary create controls", async ({ page }) => {
    // They were on the Summary tab until Action became the one place work
    // starts; the feature tabs render results only now.
    await page.goto("/workspace?tab=action")

    await expect(
      page.locator("button").filter({ hasText: "Copy Summary Prompt" }).first(),
    ).toBeVisible()
    await expect(
      page.locator("button").filter({ hasText: "Generate Summary" }).first(),
    ).toBeVisible()
  })
})
