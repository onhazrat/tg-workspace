import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { readScopedStorage, seedScopedStorage } from "./utils/scoped-storage"

// AI preferences follow the Account (SET-05). The e2e Account is shared by
// every spec, so its `ai_prefs` row is route-mocked: the page sees an Account
// with none, and nothing written here reaches the database.

const AI_PREFS = "**/api/v1/data/settings/ai_prefs"
const SEEDED = {
  selectedModel: "e2e/seeded-model",
  aiLanguage: "Persian",
  aiTemperature: "0.3",
}

/** Serve `held` as the Account's row and record every write to it. */
async function serveAiPrefs(page: Page, held: Record<string, unknown>) {
  const writes: Record<string, unknown>[] = []
  await page.route(AI_PREFS, (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>
      writes.push(body)
      Object.assign(held, body)
    }
    return route.fulfill({ json: { key: "ai_prefs", value: held } })
  })
  return writes
}

test("an older browser's AI preferences are uploaded once to an Account with none", async ({
  page,
}) => {
  const held: Record<string, unknown> = {}
  const writes = await serveAiPrefs(page, held)

  await page.goto("/")
  await seedScopedStorage(page, SEEDED)
  await page.reload()

  // The browser stops keeping them once the Account has them.
  await expect.poll(() => readScopedStorage(page, "selectedModel")).toBeNull()
  expect(writes).toEqual([
    {
      selectedModel: "e2e/seeded-model",
      aiLanguage: "Persian",
      aiTemperature: 0.3,
    },
  ])
  expect(await readScopedStorage(page, "aiLanguage")).toBeNull()
  expect(await readScopedStorage(page, "aiTemperature")).toBeNull()

  // A second load, or a second browser still holding other values, finds the
  // Account's and writes nothing.
  await seedScopedStorage(page, { ...SEEDED, aiLanguage: "German" })
  const loaded = page.waitForResponse((r) =>
    r.url().endsWith("/data/settings/ai_prefs"),
  )
  await page.reload()
  await loaded
  await page.waitForLoadState("networkidle")
  expect(writes).toHaveLength(1)
  expect(held.aiLanguage).toBe("Persian")
})

test("a second device keeps the Account's model, and switching Key still restores that Key's", async ({
  page,
}) => {
  const held: Record<string, unknown> = {
    selectedModel: "account/model",
    aiLanguage: "English",
    aiTemperature: 0.7,
  }
  const writes = await serveAiPrefs(page, held)
  const keys = ["k-work", "k-spare"].map((id) => ({
    id,
    label: id,
    provider: "gemini",
    baseUrl: null,
    lastValidated: null,
    createdAt: "2026-10-01T00:00:00Z",
  }))
  await page.route("**/api/v1/data/ai-keys", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: keys })
      : route.fallback(),
  )
  await page.route("**/api/v1/ai/models", (route) =>
    route.fulfill({ json: { models: [], default: "" } }),
  )

  // This browser last ran another model on the Key it has selected.
  await page.goto("/")
  await seedScopedStorage(page, {
    selected_ai_key: "k-work",
    ai_key_models: JSON.stringify({
      "k-work": "device/model",
      "k-spare": "spare/model",
    }),
  })
  await page.goto("/?tab=action")

  const model = page.getByRole("combobox", { name: "Inference model" })
  await expect(model).toContainText("account/model", { timeout: 20_000 })
  await page.waitForLoadState("networkidle")
  expect(writes).toEqual([])
  expect(held.selectedModel).toBe("account/model")

  await page.getByLabel("AI key", { exact: true }).selectOption("k-spare")
  await expect(model).toContainText("spare/model")
})
