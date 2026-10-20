import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

// The Settings panels no other spec renders: Publishing, Network, Setting
// groups and Sync (SET-03). Anything that would reach Telegram or Tor, spend
// an AI Key or rewrite the shared e2e corpus is route-mocked; what is left
// writes only rows the test removes again.

async function gotoSection(page: Page, section: string) {
  await page.goto(`/?tab=settings&section=${section}`)
  await expect(page.getByTestId("settings-search")).toBeVisible()
}

/** Fulfil a JSON body and record what the page sent, for the assertions. */
function jsonBody(route: { request(): { postDataJSON(): unknown } }) {
  return route.request().postDataJSON() as Record<string, any>
}

const popover = (page: Page) => page.getByRole("dialog")

test.describe("Settings, Publishing", () => {
  // Not a real token: `looksLikeBotToken` only reads the shape, and the
  // bot-info call is answered below before it can leave the browser.
  const FAKE_TOKEN = "123456789:e2e-fake-token-never-sent-to-telegram"
  const bots = (page: Page) => page.locator("#setting-publishing-yours-bots")
  const destinations = (page: Page) =>
    page.locator("#setting-publishing-yours-destinations")

  test.beforeEach(async ({ page }) => {
    // A getMe or getChat that reached the backend would go on to Telegram.
    // The network and publish logs each call files are caught too, so the
    // shared log tables do not grow by a row per run.
    await page.route("**/api/v1/data/logs/*", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: { upserted: 1 } })
        : route.continue(),
    )
  })

  /** Serve one saved bot and destination, keeping rows out of the database. */
  async function serveSaved(page: Page) {
    await page.route("**/api/v1/data/bot-credentials", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: [
              { id: "e2e-mock-bot", name: "E2E Saved Bot", hasToken: true },
            ],
          })
        : route.continue(),
    )
    await page.route("**/api/v1/data/chat-destinations", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: [{ id: "e2e-dest", name: "E2E Dest", chatId: "@e2e_dest" }],
          })
        : route.continue(),
    )
  }

  test("typing a bot token asks getMe and fills in the bot's name", async ({
    page,
  }) => {
    const sent: Record<string, any>[] = []
    await page.route("**/api/v1/telegram/bot-info", (route) => {
      sent.push(jsonBody(route))
      return route.fulfill({
        json: { ok: true, result: { id: 1, first_name: "E2E Mock Bot" } },
      })
    })

    await gotoSection(page, "publishing")
    await bots(page).getByRole("button", { name: "Add bot" }).click()
    await popover(page).getByLabel("Bot token").fill(FAKE_TOKEN)

    await expect(popover(page).getByLabel("Bot name")).toHaveValue(
      "E2E Mock Bot",
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ method: "getMe", token: FAKE_TOKEN })
    expect(sent[0].credentialId).toBeUndefined()
  })

  test("Check asks getMe through the saved bot and shows the answer", async ({
    page,
  }) => {
    await serveSaved(page)
    const sent: Record<string, any>[] = []
    await page.route("**/api/v1/telegram/bot-info", (route) => {
      sent.push(jsonBody(route))
      // `can_join_groups` false: no photo lookup follows.
      return route.fulfill({
        json: {
          ok: true,
          result: {
            id: 1,
            username: "e2e_bot",
            first_name: "E2E",
            can_join_groups: false,
          },
        },
      })
    })
    // The check stores the username on the credential; keep it off the DB.
    await page.route("**/api/v1/data/bot-credentials/*", (route) =>
      route.fulfill({ json: { id: "e2e-mock-bot", name: "E2E Saved Bot" } }),
    )

    await gotoSection(page, "publishing")
    await bots(page)
      .getByRole("button", { name: "Check E2E Saved Bot" })
      .click()
    await expect(
      bots(page).getByRole("row", { name: /E2E Saved Bot/ }),
    ).toContainText("@e2e_bot (E2E)")
    expect(sent[0]).toMatchObject({
      method: "getMe",
      credentialId: "e2e-mock-bot",
    })
    expect(sent[0].token).toBeUndefined()
  })

  test("typing a chat id asks getChat through the first saved bot", async ({
    page,
  }) => {
    await serveSaved(page)
    const sent: Record<string, any>[] = []
    await page.route("**/api/v1/telegram/bot-info", (route) => {
      sent.push(jsonBody(route))
      return route.fulfill({
        json: {
          ok: true,
          result: { id: -100, title: "E2E Mock Chat", type: "channel" },
        },
      })
    })

    await gotoSection(page, "publishing")
    await destinations(page)
      .getByRole("button", { name: "Add destination" })
      .click()
    await popover(page).getByLabel("Chat id").fill("@e2e_mock_chat")

    await expect(popover(page).getByLabel("Destination name")).toHaveValue(
      "E2E Mock Chat",
    )
    expect(sent.at(-1)).toMatchObject({
      method: "getChat",
      credentialId: "e2e-mock-bot",
      params: { chat_id: "@e2e_mock_chat" },
    })
    expect(sent.at(-1)?.token).toBeUndefined()
  })

  test("Test sends a test message with the first bot", async ({ page }) => {
    await serveSaved(page)
    const sent: Record<string, any>[] = []
    await page.route("**/api/v1/telegram/publish", (route) => {
      sent.push(jsonBody(route))
      return route.fulfill({ json: { success: true, results: [{ ok: true }] } })
    })

    await gotoSection(page, "publishing")
    await destinations(page)
      .getByRole("button", { name: "Send a test message to E2E Dest" })
      .click()
    await expect(page.getByText("Sent with E2E Saved Bot")).toBeVisible()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      credentialId: "e2e-mock-bot",
      chatId: "@e2e_dest",
    })
  })
})

test.describe("Settings, Network", () => {
  const tor = (page: Page) =>
    page.locator("#setting-network-deployment-torActions")

  test("Tor's Test shows the exit IP and Rotate asks for a new circuit", async ({
    page,
  }) => {
    await page.route("**/api/v1/network/tor-status", (route) =>
      route.fulfill({
        json: {
          running: true,
          socksInUse: true,
          controlInUse: true,
          autoSpawned: false,
        },
      }),
    )
    await page.route("**/api/v1/network/tor-ip", (route) =>
      route.fulfill({ json: { ip: "203.0.113.7" } }),
    )
    const rotated: unknown[] = []
    await page.route("**/api/v1/network/tor-new-identity", (route) => {
      rotated.push(jsonBody(route))
      return route.fulfill({ json: { success: true } })
    })
    await page.route("**/api/v1/data/logs/*", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: { upserted: 1 } })
        : route.continue(),
    )

    await gotoSection(page, "tor")
    await tor(page).getByRole("button", { name: "Test" }).click()
    await expect(tor(page)).toContainText("203.0.113.7")
    await tor(page).getByRole("button", { name: "Rotate" }).click()
    await expect(page.getByText(/New circuit requested/)).toBeVisible()
    expect(rotated).toHaveLength(1)
  })

  test("the proxy pool masks credentials until they are revealed", async ({
    page,
  }) => {
    // Served and swallowed, so the test never writes the deployment's real
    // proxy list: the settings store writes a section back once it loads.
    const network = {
      key: "network",
      value: {
        proxyEnabled: true,
        defaultProxyUrls: "socks5h://e2euser:e2esecret@proxy.test:1080",
        proxyDefaultConcurrency: 2,
        proxyConcurrencyOverrides: {},
      },
    }
    await page.route("**/api/v1/data/settings/network", (route) =>
      route.fulfill({ json: network }),
    )
    const pool = page
      .locator("#setting-network-deployment-proxies")
      .getByTestId("proxy-pool")

    await gotoSection(page, "proxy")
    await expect(pool).toContainText("proxy.test:1080")
    await expect(pool).not.toContainText("e2esecret")
    await page.getByRole("button", { name: "Show credentials" }).click()
    await expect(pool).toContainText("e2esecret")
  })
})

test.describe("Settings, Setting groups", () => {
  const prefix = "e2e-group-"
  const groups = (page: Page) =>
    page.locator("#setting-sync-yours-settingGroups")

  // Runs even when an assertion failed halfway, so a broken run cannot leave a
  // group behind for the next one to trip over.
  test.afterEach(async ({ page }) => {
    await page.evaluate(async (namePrefix) => {
      const headers = {
        Authorization: `Bearer ${localStorage.getItem("access_token")}`,
      }
      const response = await fetch("/api/v1/data/setting-groups", { headers })
      if (!response.ok) return
      const groups = (await response.json()) as { id: string; name: string }[]
      for (const group of groups) {
        if (!group.name.startsWith(namePrefix)) continue
        await fetch(`/api/v1/data/setting-groups/${group.id}`, {
          method: "DELETE",
          headers,
        })
      }
    }, prefix)
  })

  test("a custom group can be created, edited, saved and deleted", async ({
    page,
  }) => {
    const name = `${prefix}${Date.now()}`
    const renamed = `${name}-renamed`
    const groupRow = (label: string) =>
      groups(page).getByRole("button", { name: new RegExp(`^${label}\\b`) })

    await gotoSection(page, "setting-groups")
    await groups(page).getByRole("button", { name: "New group" }).click()
    await popover(page).getByLabel("New group name").fill(name)
    await popover(page).getByRole("button", { name: "Create group" }).click()
    await expect(page.getByText(`Created group "${name}"`)).toBeVisible()
    // A new group opens straight into its editor.
    await expect(groups(page).getByLabel("Group name")).toHaveValue(name)

    await groups(page).getByLabel("Group name").fill(renamed)
    await groups(page).getByLabel("Sync every (minutes)").fill("90")
    await groups(page).getByRole("button", { name: "Save group" }).click()
    await expect(page.getByText(`Updated group "${renamed}"`)).toBeVisible()
    await expect(groupRow(renamed)).toBeVisible()

    // Saved on the server, not only in the draft.
    await page.reload()
    await groupRow(renamed).click()
    await expect(groups(page).getByLabel("Group name")).toHaveValue(renamed)
    await expect(groups(page).getByLabel("Sync every (minutes)")).toHaveValue(
      "90",
    )

    await groups(page)
      .getByRole("button", { name: `Delete group ${renamed}` })
      .click()
    await page
      .getByRole("dialog", { name: `Delete group "${renamed}"?` })
      .getByRole("button", { name: "Delete" })
      .click()
    await expect(page.getByText(`Deleted group "${renamed}"`)).toBeVisible()
    await expect(groupRow(renamed)).toHaveCount(0)
  })

  test("a reserved group keeps its name and offers no Delete", async ({
    page,
  }) => {
    await gotoSection(page, "setting-groups")
    await groups(page)
      .getByRole("button", { name: /default/ })
      .first()
      .click()
    await expect(
      groups(page).getByRole("button", { name: "Save group" }),
    ).toBeVisible()
    await expect(groups(page).getByLabel("Group name")).toBeDisabled()
    await expect(
      groups(page).getByRole("button", { name: /^Delete group/ }),
    ).toHaveCount(0)
  })
})

test.describe("Settings, Sync", () => {
  test("Run on a scheduled job triggers it and says so", async ({ page }) => {
    // A real trigger starts an auto-sync pass against Telegram from the local
    // worker. The request is answered here and the spec asserts it was made.
    const triggered: string[] = []
    await page.route("**/api/v1/jobs/*/trigger", (route) => {
      triggered.push(new URL(route.request().url()).pathname)
      return route.fulfill({ json: { enabled: true, lastStatus: "running" } })
    })

    await gotoSection(page, "jobs")
    const row = page
      .locator("div")
      .filter({ has: page.getByText("Auto sync", { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Run now" }) })
      .last()
    await row.getByRole("button", { name: "Run now" }).click()

    await expect(page.getByText("Triggered Auto sync")).toBeVisible()
    expect(triggered).toEqual(["/api/v1/jobs/auto_sync/trigger"])
  })

  test("Reset & sync all channels asks first, then reports the reset", async ({
    page,
  }) => {
    // The real endpoint deletes every Post in the shared e2e database and
    // enqueues a Telegram sync for every Channel.
    const sent: Record<string, any>[] = []
    await page.route("**/api/v1/data/channels/bulk-reset-sync", (route) => {
      sent.push(jsonBody(route))
      return route.fulfill({
        json: {
          channelsReset: 7,
          postsDeleted: 42,
          jobId: null,
          errors: [{ channelId: "c1", channelName: "c1", error: "boom" }],
        },
      })
    })

    await gotoSection(page, "channels-sync")
    await page
      .locator("#setting-sync-yours-resyncAll")
      .getByRole("button", { name: "Reset and sync all channels" })
      .click()
    // The first click only asks.
    expect(sent).toHaveLength(0)

    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reset and sync" })
      .click()
    await expect(
      page.getByText("Reset 7 channel(s); deleted 42 post(s). 1 error(s)."),
    ).toBeVisible()
    expect(sent).toEqual([{ confirm: true }])
    // Back to the unarmed button, so a second click asks again.
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
})
