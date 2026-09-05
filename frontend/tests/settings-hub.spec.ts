import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

async function gotoSettings(page: Page, search = "") {
  const qs = search.startsWith("?") ? search.slice(1) : search
  const url = qs ? `/summarizer?tab=settings&${qs}` : "/summarizer?tab=settings"
  await page.goto(url)
  await expect(page.getByTestId("settings-search")).toBeVisible()
}

async function openTocSection(page: Page, sectionLabel: string) {
  const nestedParents: Record<string, string> = {
    "Setting Groups": "Channels & Sync",
    Proxy: "Network",
    Tor: "Network",
    Retention: "Data",
    Diagnostics: "Tools",
    "Network Telemetry": "Tools",
    "Runtime Config": "Tools",
  }
  const parent = nestedParents[sectionLabel]
  if (parent) {
    const parentId = {
      "Channels & Sync": "channels-sync",
      Network: "network",
      Data: "data",
      Tools: "tools",
    }[parent]
    if (parentId) {
      const twistie = page.getByTestId(`toc-twistie-${parentId}`)
      const childVisible = page.getByRole("button", {
        name: sectionLabel,
        exact: true,
      })
      if (!(await childVisible.isVisible().catch(() => false))) {
        await twistie.click()
      }
    }
  }
  await page.getByRole("button", { name: sectionLabel, exact: true }).click()
}

test.describe("Settings Hub (VS Code-style)", () => {
  test("flatten search shows cross-group results", async ({ page }) => {
    await gotoSettings(page)
    await page.getByTestId("settings-search").fill("proxy")
    const results = page.getByTestId("settings-search-results")
    await expect(results).toBeVisible({ timeout: 5_000 })
    await expect(results.getByText(/result/i)).toBeVisible()
    // Flattened catalog rows / panel hits — not a single TOC browse section.
    await expect(
      results.locator("[data-setting-id], button").first(),
    ).toBeVisible()
  })

  test("deep-link ?setting= focuses a catalog row", async ({ page }) => {
    // Any catalog-rendered row in `channels-sync` does; this was
    // `syncConcurrency` until ADR-012 deleted that setting and left the spec
    // deep-linking to an id nothing renders.
    await gotoSettings(page, "setting=syncFailureBackoffMinutes")
    await expect(page).toHaveURL(/setting=syncFailureBackoffMinutes/)
    const row = page.locator('[data-setting-id="syncFailureBackoffMinutes"]')
    await expect(row).toBeVisible({ timeout: 5_000 })
    await expect(row).toHaveAttribute("id", "setting-syncFailureBackoffMinutes")
  })

  test("deep-link ?setting= focuses custom panel knobs", async ({ page }) => {
    await gotoSettings(page, "setting=theme")
    const theme = page.locator('[data-setting-id="theme"]')
    await expect(theme).toBeVisible({ timeout: 5_000 })
    await expect(theme).toHaveAttribute("id", "setting-theme")

    await gotoSettings(page, "setting=proxyEnabled")
    const proxy = page.locator('[data-setting-id="proxyEnabled"]')
    await expect(proxy).toBeVisible({ timeout: 5_000 })
    await expect(proxy).toHaveAttribute("id", "setting-proxyEnabled")
    await expect(page.getByText("Network & Proxy").first()).toBeVisible()

    await gotoSettings(page, "setting=postRetentionDays")
    const retention = page.locator('[data-setting-id="postRetentionDays"]')
    await expect(retention).toBeVisible({ timeout: 5_000 })
    await expect(retention).toHaveAttribute("id", "setting-postRetentionDays")
    await expect(page.getByText("Data Retention").first()).toBeVisible()
  })

  test("Setting Groups TOC leaf opens the groups panel", async ({ page }) => {
    await gotoSettings(page)
    await openTocSection(page, "Setting Groups")
    await expect(page).toHaveURL(/section=setting-groups/)
    await expect(
      page.getByRole("heading", { name: /Setting Groups/i }).first(),
    ).toBeVisible()
    await expect(
      page.getByText(/Channel Setting Groups/i).first(),
    ).toBeVisible()
  })

  test("Network TOC exposes Proxy and Tor panels", async ({ page }) => {
    await gotoSettings(page)
    await openTocSection(page, "Proxy")
    await expect(page).toHaveURL(/section=proxy/)
    await expect(page.getByText("Network & Proxy").first()).toBeVisible()
    await expect(page.getByText("TOR Network")).toHaveCount(0)

    await openTocSection(page, "Tor")
    await expect(page).toHaveURL(/section=tor/)
    await expect(page.getByText("TOR Network").first()).toBeVisible()
  })

  test("Data Retention TOC leaf shows retention controls", async ({ page }) => {
    await gotoSettings(page)
    await openTocSection(page, "Retention")
    await expect(page).toHaveURL(/section=retention/)
    await expect(page.getByText("Data Retention").first()).toBeVisible()
    await expect(page.getByText("Post Retention").first()).toBeVisible()
    await expect(page.getByText("Log Retention").first()).toBeVisible()
  })

  test("TOC twistie expands children without selecting parent", async ({
    page,
  }) => {
    await gotoSettings(page, "section=commonly-used")
    const networkTwistie = page.getByTestId("toc-twistie-network")
    await expect(networkTwistie).toHaveAttribute("aria-expanded", "false")
    await expect(
      page.getByRole("button", { name: "Proxy", exact: true }),
    ).toHaveCount(0)

    await networkTwistie.click()
    await expect(networkTwistie).toHaveAttribute("aria-expanded", "true")
    await expect(
      page.getByRole("button", { name: "Proxy", exact: true }),
    ).toBeVisible()
    await expect(page).toHaveURL(/section=commonly-used/)

    await page.getByRole("button", { name: "Proxy", exact: true }).click()
    await expect(page).toHaveURL(/section=proxy/)
  })

  test("Diagnostics and Network Telemetry are separate searchable panels", async ({
    page,
  }) => {
    await gotoSettings(page)
    await page.getByTestId("settings-search").fill("LLM logs")
    const results = page.getByTestId("settings-search-results")
    await expect(results).toBeVisible({ timeout: 5_000 })
    await results.getByText("Diagnostics", { exact: true }).first().click()
    await expect(page).toHaveURL(/section=diagnostics/)
    // The panel is titled "Diagnostics", matching the nav entry that leads
    // here — see the comment in `LogsHeader.tsx`. It read "System Logs" when
    // this assertion was written, and there is no System log tab any more.
    await expect(
      page.locator('[data-setting-id="panel-diagnostics"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-setting-id="panel-network-telemetry"]'),
    ).toHaveCount(0)

    await page.getByTestId("settings-search").fill("network telemetry")
    await expect(results).toBeVisible({ timeout: 5_000 })
    await results
      .getByText("Network Telemetry", { exact: true })
      .first()
      .click()
    await expect(page).toHaveURL(/section=network-telemetry/)
    await expect(
      page.locator('[data-setting-id="panel-network-telemetry"]'),
    ).toBeVisible()
  })

  test("Advanced Mode toggle is gone", async ({ page }) => {
    await gotoSettings(page)
    await expect(page.getByText(/Advanced Mode/i)).toHaveCount(0)
    await page.getByTestId("command-palette-button").click()
    await page.getByPlaceholder("Type a command...").fill("advanced mode")
    await expect(
      page.getByRole("option", { name: /Advanced Mode/i }),
    ).toHaveCount(0)
    await page.keyboard.press("Escape")
  })

  test("modified badge and reset on Commonly Used row", async ({ page }) => {
    await gotoSettings(page, "section=commonly-used")
    const row = page.locator('[data-setting-id="proxyEnabled"]')
    await expect(row).toBeVisible()

    // Ensure we start from default (off) so the toggle creates a modified state.
    const modified = await row.getAttribute("data-modified")
    if (modified === "true") {
      await row.getByRole("button", { name: /Options for Proxy/i }).click()
      await page.getByRole("button", { name: /Reset to default/i }).click()
      await expect(row).not.toHaveAttribute("data-modified", "true")
    }

    await row.getByRole("switch", { name: "Proxy" }).click()
    await expect(row).toHaveAttribute("data-modified", "true")
    await expect(row.getByText("Modified")).toBeVisible()

    await row.getByRole("button", { name: /Options for Proxy/i }).click()
    await page.getByRole("button", { name: /Reset to default/i }).click()
    await expect(row).not.toHaveAttribute("data-modified", "true")
  })
})
