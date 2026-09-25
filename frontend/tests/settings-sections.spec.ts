import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

// Three Settings sections no other spec renders: Publishing, Setting Groups
// and Sync. Anything that would reach Telegram, spend an AI Key or rewrite the
// shared e2e corpus is route-mocked; what is left writes only rows the test
// removes again.

async function gotoSection(page: Page, section: string) {
  await page.goto(`/workspace?tab=settings&section=${section}`)
  await expect(page.getByTestId("settings-search")).toBeVisible()
}

/** Fulfil a JSON body and record what the page sent, for the assertions. */
function jsonBody(route: { request(): { postDataJSON(): unknown } }) {
  return route.request().postDataJSON() as Record<string, any>
}

test.describe("Settings, Publishing", () => {
  // Not a real token: `looksLikeBotToken` only reads the shape, and the
  // bot-info call is answered below before it can leave the browser.
  const FAKE_TOKEN = "123456789:e2e-fake-token-never-sent-to-telegram"

  test.beforeEach(async ({ page }) => {
    // A getMe or getChat that reached the backend would go on to Telegram.
    // The network log each call files is caught too, so the shared log table
    // does not grow by a row per run.
    await page.route("**/api/v1/data/logs/network", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ json: { upserted: 1 } })
        : route.continue(),
    )
  })

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
    await expect(page.getByText("Bot & Destination Management")).toBeVisible()

    await page.getByPlaceholder("Bot token (from @BotFather)").fill(FAKE_TOKEN)

    await expect(
      page.getByPlaceholder("Bot name (auto-filled or custom)"),
    ).toHaveValue("E2E Mock Bot")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ method: "getMe", token: FAKE_TOKEN })
    expect(sent[0].credentialId).toBeUndefined()
  })

  test("typing a chat id asks getChat through the first saved bot", async ({
    page,
  }) => {
    // `canLookUpChat` needs a saved bot. Serving one keeps a credential row out
    // of the shared database.
    await page.route("**/api/v1/data/bot-credentials", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: [
              { id: "e2e-mock-bot", name: "E2E Saved Bot", hasToken: true },
            ],
          })
        : route.continue(),
    )
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
    await expect(page.getByText("E2E Saved Bot")).toBeVisible()

    await page
      .getByPlaceholder("Chat id (e.g. @mychannel or -100…)")
      .fill("@e2e_mock_chat")

    await expect(
      page.getByPlaceholder("Destination name (auto-filled or custom)"),
    ).toHaveValue("E2E Mock Chat")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      method: "getChat",
      credentialId: "e2e-mock-bot",
      params: { chat_id: "@e2e_mock_chat" },
    })
    expect(sent[0].token).toBeUndefined()
  })
})

test.describe("Settings, Setting Groups", () => {
  const prefix = "e2e-group-"

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

  test("a custom group can be edited, saved and deleted", async ({ page }) => {
    const name = `${prefix}${Date.now()}`
    const renamed = `${name}-renamed`
    const groupButton = (label: string) =>
      page.getByRole("button", { name: new RegExp(`^${label}\\b`) })

    await gotoSection(page, "setting-groups")
    await expect(page.getByText("Channel Setting Groups")).toBeVisible()

    await page.getByPlaceholder("Group name").fill(name)
    await page.getByRole("button", { name: "Create group" }).click()
    await expect(page.getByText(`Created group "${name}"`)).toBeVisible()
    await groupButton(name).click()
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name)

    // handleSave
    await page.getByLabel("Name", { exact: true }).fill(renamed)
    await page.getByLabel("Regular interval (min)").fill("90")
    await page.getByRole("button", { name: "Save group" }).click()
    await expect(page.getByText(`Updated group "${renamed}"`)).toBeVisible()
    await expect(groupButton(renamed)).toBeVisible()

    // Saved on the server, not only in the draft.
    await page.reload()
    await groupButton(renamed).click()
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(renamed)
    await expect(page.getByLabel("Regular interval (min)")).toHaveValue("90")

    // handleDelete
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(page.getByText(`Deleted group "${renamed}"`)).toBeVisible()
    await expect(groupButton(renamed)).toHaveCount(0)
  })

  test("a reserved group offers no Delete", async ({ page }) => {
    await gotoSection(page, "setting-groups")
    await page.getByRole("button", { name: /\(default\)/ }).click()
    await expect(page.getByRole("button", { name: "Save group" })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
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

    await gotoSection(page, "channels-sync")
    const row = page
      .locator("div")
      .filter({ has: page.getByText("Auto Sync", { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Run" }) })
      .last()
    await row.getByRole("button", { name: "Run" }).click()

    await expect(page.getByText("Triggered Auto Sync")).toBeVisible()
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
      .getByRole("button", { name: "Reset & sync all channels" })
      .click()
    // The first click only asks.
    expect(sent).toHaveLength(0)

    await page.getByRole("button", { name: "Confirm reset & sync" }).click()
    await expect(
      page.getByText("Reset 7 channel(s); deleted 42 post(s). 1 error(s)."),
    ).toBeVisible()
    expect(sent).toEqual([{ confirm: true }])
    // Back to the unarmed button, so a second click asks again.
    await expect(
      page.getByRole("button", { name: "Reset & sync all channels" }),
    ).toBeVisible()
  })
})
