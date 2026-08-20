import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

import { seedTestChannel } from "./utils/seed-channel"

const TAB_LABELS: Record<string, string> = {
  channels: "Channels",
  posts: "Posts",
  action: "Action",
  summary: "Summary",
  tag: "Tag",
  discover: "Discover",
  chat: "Chat",
  history: "History",
  settings: "Settings",
}

async function gotoSummarizer(page: Page, tab = "channels") {
  await page.goto(`/summarizer?tab=${tab}`)
  const label = TAB_LABELS[tab] ?? tab
  // Role locators are more reliable than `#nav-tab-*` under Playwright Chrome.
  // `link`, not `button`: the workspace tabs navigate to `?tab=`, so they are
  // real anchors.
  await expect(
    page.getByRole("link", { name: label, exact: true }).first(),
  ).toBeVisible()
}

async function openSettingsSection(page: Page, sectionLabel: string) {
  await gotoSummarizer(page, "settings")
  await expect(page.getByTestId("settings-search")).toBeVisible()
  // Nested TOC leaves: expand parent via twistie when children are collapsed.
  const nestedParents: Record<string, string> = {
    Diagnostics: "tools",
    "Network Telemetry": "tools",
    "Runtime Config": "tools",
    Proxy: "network",
    Tor: "network",
    Retention: "data",
    "Setting Groups": "channels-sync",
  }
  const parentId = nestedParents[sectionLabel]
  if (parentId) {
    const child = page.getByRole("button", {
      name: sectionLabel,
      exact: true,
    })
    if (!(await child.isVisible().catch(() => false))) {
      await page.getByTestId(`toc-twistie-${parentId}`).click()
    }
  }
  await page.getByRole("button", { name: sectionLabel, exact: true }).click()
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
    await gotoSummarizer(page, "channels")
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

      const ghost = page.getByRole("button", { name: /^All$/i })
      await expect(ghost).toHaveAttribute("data-slot", "tg-button")
      const ghostClass = (await ghost.getAttribute("class")) ?? ""
      expect(ghostClass).toContain("hover:bg-app-ink/5")
      expect(ghostClass).toContain("focus-visible:ring-2")
    }
  })

  test("channel search muted input and settings field accept input", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    const search = page.getByPlaceholder("Search channels...")
    await expect(search).toHaveAttribute("data-slot", "tg-input")
    await search.fill("alpha")
    await expect(search).toHaveValue("alpha")

    // Channels & Sync exposes TgInput without Advanced Mode / proxy gates.
    await openSettingsSection(page, "Channels & Sync")
    const settingsField = page.locator('[data-slot="tg-input"]').first()
    await expect(settingsField).toBeVisible()
    await settingsField.fill("42")
    await expect(settingsField).toHaveValue("42")
  })

  test("diagnostics panel opens without telemetry tabs", async ({ page }) => {
    await openSettingsSection(page, "Diagnostics")
    // The panel heading matches the nav entry that leads here — it used to read
    // "System Logs", which made navigating to "Diagnostics" look like it had
    // landed somewhere else (D5).
    await expect(page.getByText("Diagnostics").first()).toBeVisible()
    await expect(
      page.locator('[data-slot="tg-segmented-control"]'),
    ).toHaveCount(0)
    await expect(
      page.locator('[data-setting-id="panel-diagnostics"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-setting-id="panel-network-telemetry"]'),
    ).toHaveCount(0)
  })

  test("network telemetry TOC leaf renders telemetry panel", async ({
    page,
  }) => {
    await openSettingsSection(page, "Network Telemetry")
    await expect(page).toHaveURL(/section=network-telemetry/)
    await expect(
      page.locator('[data-setting-id="panel-network-telemetry"]'),
    ).toBeVisible()
  })

  test("logs clear-all uses TgConfirmDialog", async ({ page }) => {
    await openSettingsSection(page, "Diagnostics")

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
    await gotoSummarizer(page, "channels")
    const channelName = await seedTestChannel(page)

    let nativeConfirmOpened = false
    page.on("dialog", async (dialog) => {
      nativeConfirmOpened = true
      await dialog.dismiss()
    })

    const card = page.locator(`[data-channel-name="${channelName}"]`)
    await expect(card).toBeVisible()
    await card.hover()
    const deleteBtn = page.getByRole("button", { name: "Delete Channel" })
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Remove Channel/i)).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).not.toBeVisible()
    await expect(card).toBeVisible()
    expect(nativeConfirmOpened).toBe(false)
  })

  test("sync bulk reset uses inline confirm (not a modal)", async ({
    page,
  }) => {
    await openSettingsSection(page, "Channels & Sync")

    let nativeConfirmOpened = false
    page.on("dialog", async (dialog) => {
      nativeConfirmOpened = true
      await dialog.dismiss()
    })

    const start = page.getByRole("button", {
      name: /Reset & sync all channels/i,
    })
    await expect(start).toBeVisible()
    await start.click()

    await expect(page.getByRole("dialog")).toHaveCount(0)
    const confirm = page.getByRole("button", {
      name: /Confirm reset & sync/i,
    })
    await expect(confirm).toBeVisible()
    await expect(confirm).toHaveAttribute("data-slot", "tg-button")
    await expect(confirm).toHaveAttribute("data-variant", "successSoft")
    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).not.toBeVisible()
    expect(nativeConfirmOpened).toBe(false)
  })

  test("channel card frosted icon buttons expose hover classes", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
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

  test("appearance dense theme control and toggles are keyboard-focusable", async ({
    page,
  }) => {
    await openSettingsSection(page, "Appearance")
    const theme = page.locator('[data-slot="tg-segmented-control"]')
    await expect(theme).toBeVisible()
    const light = theme.getByRole("button", { name: /Light/i })
    await light.focus()
    await expect(light).toBeFocused()
    const lightClass = (await light.getAttribute("class")) ?? ""
    expect(lightClass).toContain("focus-visible:ring-2")

    const toggle = page.locator('[data-slot="tg-toggle"]').first()
    await expect(toggle).toBeVisible()
    await toggle.focus()
    await expect(toggle).toBeFocused()
    const toggleClass = (await toggle.getAttribute("class")) ?? ""
    expect(toggleClass).toContain("focus-visible:ring-2")
  })

  test("channels toolbar controls are tab-focusable with focus-visible rings", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
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

  test("group filter chips and post filter chips use primitives", async ({
    page,
  }) => {
    await gotoSummarizer(page, "channels")
    await seedTestChannel(page)
    const selectionChip = page
      .locator('[data-slot="tg-selection-chip"]')
      .first()
    await expect(selectionChip).toBeVisible()
    // Selection chips carry user-authored tag/group names, so they must render
    // the operator's casing rather than the app's uppercase micro-label style.
    await expect(selectionChip).toHaveCSS("text-transform", "none")
    // Do not click group chips here — toggling a large group can stall the UI.

    // Workspace tabs navigate to `?tab=`, so they are links, not buttons.
    await page.getByRole("link", { name: "Posts" }).click()
    // Quick-range chips have no selected prop; use a post-type chip that does.
    const filterChip = page.getByRole("button", { name: "Original Only" })
    await expect(filterChip).toHaveAttribute("data-slot", "tg-filter-chip")
    await expect(filterChip).toBeVisible()
    await filterChip.click()
    await expect(filterChip).toHaveAttribute("data-selected", "true")
  })

  test("history empty state uses TgHeroEmptyState", async ({ page }) => {
    await gotoSummarizer(page, "history")
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
    await gotoSummarizer(page, "channels")
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
    await expect(syncAll).toHaveAttribute("aria-busy", "true")
    release?.()
  })
})
