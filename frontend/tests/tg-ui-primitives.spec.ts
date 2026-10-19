import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

import { seedTestChannel } from "./utils/seed-channel"
import { clearChannelSelection, showCards } from "./utils/summarizer-helpers.ts"

const TAB_LABELS: Record<string, string> = {
  channels: "Channels",
  posts: "Posts",
  action: "Action",
  summary: "Summary",
  tag: "Tag",
  discover: "Discover",
  chat: "Chat",
  history: "History",
  tools: "Tools",
  settings: "Settings",
}

async function gotoWorkspace(page: Page, tab = "channels") {
  await page.goto(`/?tab=${tab}`)
  const label = TAB_LABELS[tab] ?? tab
  // Role locators are more reliable than `#nav-tab-*` under Playwright Chrome.
  // `link`, not `button`: the workspace tabs navigate to `?tab=`, so they are
  // real anchors.
  await expect(
    page.getByRole("link", { name: label, exact: true }).first(),
  ).toBeVisible()
}

/** The Settings page, scrolled to one topic (SET-02). */
async function openSettingsTopic(page: Page, topic: string) {
  await page.goto(`/?tab=settings&section=${topic}`)
  await expect(page.getByTestId("settings-search")).toBeVisible()
  await expect(page.locator(`#settings-topic-${topic}`)).toBeVisible()
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((next) => {
    localStorage.setItem("vite-ui-theme", next)
  }, theme)
  await page.reload()
  await expect(page.locator("html")).toHaveClass(new RegExp(theme))
}

test.describe("TG UI primitives", () => {
  test("primary and ghost buttons expose hover/focus classes in light and dark", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await seedTestChannel(page)

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme)

      const primary = page.getByRole("button", { name: /Sync All/i })
      await expect(primary).toBeVisible()
      await expect(primary).toHaveAttribute("data-slot", "tg-button")
      await expect(primary).toHaveAttribute("data-variant", "primary")
      const primaryClass = (await primary.getAttribute("class")) ?? ""
      expect(primaryClass).toContain("hover:opacity-90")
      expect(primaryClass).toContain("focus-visible:ring-2")

      // Row 2's ghost button with nothing selected (CTB-04 moved Invert into
      // Adjust selection, which only a selection shows).
      await clearChannelSelection(page)
      const ghost = page.getByRole("button", {
        name: "Select all",
        exact: true,
      })
      await expect(ghost).toHaveAttribute("data-slot", "tg-button")
      const ghostClass = (await ghost.getAttribute("class")) ?? ""
      expect(ghostClass).toContain("hover:bg-app-ink/5")
      expect(ghostClass).toContain("focus-visible:ring-2")
    }
  })

  test("channel search muted input and settings field accept input", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    const search = page.getByPlaceholder("Search channels...")
    await expect(search).toHaveAttribute("data-slot", "tg-input")
    await search.fill("alpha")
    await expect(search).toHaveValue("alpha")

    // A number Setting is a plain field; Escape undoes the draft unsaved.
    await openSettingsTopic(page, "sync")
    const settingsField = page.getByRole("textbox", {
      name: "Dynamic sync expected Posts",
    })
    await expect(settingsField).toBeVisible()
    const before = await settingsField.inputValue()
    await settingsField.fill("42")
    await expect(settingsField).toHaveValue("42")
    await settingsField.press("Escape")
    await expect(settingsField).toHaveValue(before)
  })

  test("the Tools tab's logs open without telemetry tabs", async ({ page }) => {
    await gotoWorkspace(page, "tools")
    // The panel heading matches the nav entry that used to lead here — it read
    // "System Logs", which made "Diagnostics" look like it had landed
    // somewhere else (D5).
    const logs = page.getByTestId("tool-logs")
    await expect(logs.getByText("Diagnostics").first()).toBeVisible()
    await expect(
      logs.locator('[data-slot="tg-segmented-control"]'),
    ).toHaveCount(0)
  })

  test("the Tools tab shows network telemetry to an Operator", async ({
    page,
  }) => {
    await gotoWorkspace(page, "tools")
    await expect(page.getByTestId("tool-network-telemetry")).toBeVisible()
  })

  test("logs clear-all uses TgConfirmDialog", async ({ page }) => {
    await gotoWorkspace(page, "tools")

    let nativeConfirmOpened = false
    page.on("dialog", async (dialog) => {
      nativeConfirmOpened = true
      await dialog.dismiss()
    })

    const clearButton = page.getByRole("button", { name: /Clear .* Logs/i })
    await expect(clearButton).toBeVisible()
    await clearButton.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Clear all logs/i)).toBeVisible()
    await expect(
      dialog.locator('[data-slot="tg-button"]').first(),
    ).toBeVisible()

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).not.toBeVisible()
    expect(nativeConfirmOpened).toBe(false)

    await clearButton.click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Clear all" })
      .click()
    await expect(page.getByRole("dialog")).not.toBeVisible()
    expect(nativeConfirmOpened).toBe(false)
  })

  test("channel delete confirm opens TgConfirmDialog and cancel is a no-op", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await showCards(page)
    const channelName = await seedTestChannel(page)

    let nativeConfirmOpened = false
    page.on("dialog", async (dialog) => {
      nativeConfirmOpened = true
      await dialog.dismiss()
    })

    const card = page.locator(`[data-channel-name="${channelName}"]`)
    await expect(card).toBeVisible()
    await card.hover()
    const deleteBtn = page.getByRole("button", { name: "Remove Channel" })
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Remove Channel\?/i)).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).not.toBeVisible()
    await expect(card).toBeVisible()
    expect(nativeConfirmOpened).toBe(false)
  })

  test("sync bulk reset asks in the app's own dialog", async ({ page }) => {
    await openSettingsTopic(page, "sync")

    let nativeConfirmOpened = false
    page.on("dialog", async (dialog) => {
      nativeConfirmOpened = true
      await dialog.dismiss()
    })

    await page
      .locator("#setting-sync-yours-resyncAll")
      .getByRole("button", { name: "Reset and sync all channels" })
      .click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole("button", { name: "Reset and sync" })
    await expect(confirm).toHaveAttribute("data-slot", "tg-button")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).not.toBeVisible()
    expect(nativeConfirmOpened).toBe(false)
  })

  test("channel card frosted icon buttons expose hover classes", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await showCards(page)
    await seedTestChannel(page)

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme)
      const frosted = page
        .locator('[data-slot="tg-icon-button"][data-variant="frosted"]')
        .first()
      await expect(frosted).toBeAttached()
      const frostedClass = (await frosted.getAttribute("class")) ?? ""
      expect(frostedClass).toContain("bg-app-bg/90")
      expect(frostedClass).toContain("hover:bg-app-bg")
      expect(frostedClass).toContain("focus-visible:ring-2")
    }
  })

  test("appearance theme choice and toggles are keyboard-focusable", async ({
    page,
  }) => {
    await openSettingsTopic(page, "appearance")
    const theme = page.getByRole("group", { name: "Color theme" })
    await expect(theme).toBeVisible()
    const light = theme.getByRole("button", { name: "Light", exact: true })
    await light.focus()
    await expect(light).toBeFocused()

    const toggle = page
      .locator("#settings-topic-appearance")
      .getByRole("button", { name: "On", exact: true })
      .first()
    await toggle.focus()
    await expect(toggle).toBeFocused()
  })

  test("channels toolbar controls are tab-focusable with focus-visible rings", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await seedTestChannel(page)

    const syncAll = page.getByRole("button", { name: /Sync All/i })
    await syncAll.focus()
    await expect(syncAll).toBeFocused()
    expect((await syncAll.getAttribute("class")) ?? "").toContain(
      "focus-visible:ring-2",
    )

    await page.keyboard.press("Tab")
    const focused = page.locator(":focus")
    await expect(focused).toBeVisible()
  })

  /**
   * The arrow's classes came from the Radix tooltip, which places the arrow on
   * the popup's edge itself. Base UI only sets its offset along the edge, so
   * the arrow sat inside the popup and a dark diamond covered the text.
   */
  test("a tooltip's arrow sits on the edge facing its trigger", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await page.getByRole("button", { name: "Compact cards" }).hover()

    const popup = page.locator('[data-slot="tooltip-content"]')
    await expect(popup).toHaveText("Compact cards")
    const side = await popup.getAttribute("data-side")
    const arrow = popup.locator("[data-side]")
    await expect(arrow).toBeVisible()
    const box = await popup.boundingBox()
    const tip = await arrow.boundingBox()
    if (!box || !tip) throw new Error("tooltip or arrow has no box")

    // The arrow's centre is on the popup's edge, give or take a pixel.
    const centre = { x: tip.x + tip.width / 2, y: tip.y + tip.height / 2 }
    const edge = {
      top: box.y + box.height,
      bottom: box.y,
      left: box.x + box.width,
      right: box.x,
    }[side ?? ""]
    expect(edge, `unexpected side ${side}`).toBeDefined()
    const onAxis = side === "top" || side === "bottom" ? centre.y : centre.x
    expect(Math.abs(onAxis - (edge ?? 0))).toBeLessThanOrEqual(1.5)
  })

  test("the Groups dropdown keeps a group's casing, and a post filter pill fills when set", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await seedTestChannel(page)
    await page.getByTestId("channel-groups").click()
    const groupRow = page
      .locator('[data-testid^="channel-groups-row-"]')
      .first()
    await expect(groupRow).toBeVisible()
    // A row carries a user-authored group name, so it must render the
    // operator's casing rather than an uppercase micro-label style.
    await expect(groupRow).toHaveCSS("text-transform", "none")
    // Do not tick a group here, since toggling a large group can stall the UI.
    await page.keyboard.press("Escape")

    // Workspace tabs navigate to `?tab=`, so they are links, not buttons.
    await page.getByRole("link", { name: "Posts" }).click()
    // The Type dropdown funnels into the Post filter (PTR-03): the trigger
    // names what it funnels and fills, and the filter is in the URL.
    const typeMenu = page.getByTestId("post-filter-type")
    await expect(typeMenu).toBeVisible()
    await typeMenu.click()
    await page.getByTestId("post-filter-type-funnel-original").click()
    await expect(typeMenu).toContainText("Original")
    await expect(typeMenu).toHaveClass(/bg-app-ink/)
    await expect(page).toHaveURL(/postFilter=type%3Aoriginal/)
    // Put it back, so later specs in this worker start unfiltered.
    await page.getByTestId("post-filter-type-funnel-original").click()
    await expect(page).not.toHaveURL(/postFilter=/)
    await page.keyboard.press("Escape")
  })

  test("history empty state uses TgHeroEmptyState", async ({ page }) => {
    await gotoWorkspace(page, "history")
    // Search for something nothing can match, rather than assuming the
    // database is empty. It used to be a safe assumption because History
    // listed only summaries; now it lists every artifact kind, so any tag run
    // left behind by another spec would render a populated list here.
    await page.getByLabel("Search history").fill("zzz-no-such-artifact-zzz")
    await expect(
      page.locator('[data-slot="tg-hero-empty-state"]'),
    ).toBeVisible()
  })

  test("Sync All shows in-button loading while sync request is in flight", async ({
    page,
  }) => {
    await gotoWorkspace(page, "channels")
    await seedTestChannel(page)

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/v1/jobs/sync**", async (route) => {
      await gate
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "playwright-sync-job" }),
      })
    })

    const syncAll = page.getByRole("button", { name: /Sync All/i })
    await syncAll.click()
    // Sync All asks first; nothing is sent until it is confirmed.
    await page.getByTestId("channel-sync-all-confirm").click()
    await expect(syncAll).toHaveAttribute("aria-busy", "true")
    release?.()
  })
})
