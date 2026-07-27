import { expect, type Page } from "@playwright/test"

/**
 * These helpers **append** — they never reset the database.
 *
 * A full 3-spec run adds roughly 136 channels, and the suite is only reliable
 * against a small *warm* database. Both extremes fail, and both look like code
 * regressions in unrelated tests (channel-card hover, discover guides):
 *
 * - ~2,000+ channels: the grid and scoped-count queries get slow enough to time out.
 * - **0 channels, immediately after `TRUNCATE`**: planner statistics are reset and
 *   the query cache is cold, so the first channel-grid load overruns the 5s
 *   `toBeAttached` timeout and no card exists when a test looks for one.
 *
 * So truncating is not a reset. Truncate, then warm up with **one spec**
 * (`tg-ui-primitives.spec.ts` leaves 6 channels) and judge the run after that —
 * not the full suite, which adds ~136 in a pass and overshoots straight into the
 * range that caused the original problem. Target roughly 5–50 channels
 * (`select count(*) from tg_channels`). Never treat a post-truncate run as a
 * baseline, and never compare two branches measured at different database sizes.
 *
 * This accounts for most of the flakiness but not all of it:
 * `tg-ui-primitives.spec.ts:63` fails at 0, 6, 148 and 154 channels alike and is
 * tracked separately.
 */

export async function seedTestChannel(
  page: Page,
  channelName?: string,
  tags: string[] = [],
): Promise<string> {
  const name = channelName ?? `e2e${Date.now()}`

  await page.evaluate(
    async ({ seedName, seedTags }) => {
      const token = localStorage.getItem("access_token")
      if (!token) {
        throw new Error("seedTestChannel: missing access_token")
      }

      const response = await fetch(`/api/v1/data/channels/${seedName}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: seedName, name: seedName, tags: seedTags }),
      })

      if (!response.ok) {
        throw new Error(
          `seedTestChannel failed (${response.status}): ${await response.text()}`,
        )
      }
    },
    { seedName: name, seedTags: tags },
  )

  await expect
    .poll(async () => {
      return page.evaluate(async (seedName) => {
        const token = localStorage.getItem("access_token")
        if (!token) return false

        const response = await fetch("/api/v1/data/channels", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) return false

        const channels = (await response.json()) as Array<{ name: string }>
        return channels.some((channel) => channel.name === seedName)
      }, name)
    })
    .toBe(true)

  await page.reload()
  await expect(page.getByTestId("command-palette-button")).toBeVisible()
  await page.getByPlaceholder("Search channels...").fill(name)
  await expect(page.locator(`[data-channel-name="${name}"]`)).toBeVisible({
    timeout: 15_000,
  })

  return name
}

export async function seedBulkChannels(
  page: Page,
  count: number,
  prefix: string,
): Promise<void> {
  await page.evaluate(
    async ({ channelCount, channelPrefix }) => {
      const token = localStorage.getItem("access_token")
      if (!token) {
        throw new Error("seedBulkChannels: missing access_token")
      }

      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }

      await Promise.all(
        Array.from({ length: channelCount }, (_, index) => {
          const name = `${channelPrefix}${index}`
          return fetch(`/api/v1/data/channels/${name}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ id: name, name }),
          }).then(async (response) => {
            if (!response.ok) {
              throw new Error(
                `seedBulkChannels failed (${response.status}): ${await response.text()}`,
              )
            }
          })
        }),
      )
    },
    { channelCount: count, channelPrefix: prefix },
  )
}

export async function seedPartialHistoryChannel(
  page: Page,
  channelName?: string,
): Promise<string> {
  const name = channelName ?? `partial${Date.now()}`

  await page.evaluate(
    async ({ seedName }) => {
      const token = localStorage.getItem("access_token")
      if (!token) {
        throw new Error("seedPartialHistoryChannel: missing access_token")
      }

      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }

      const createResponse = await fetch(`/api/v1/data/channels/${seedName}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          id: seedName,
          name: seedName,
          historyCompleteToCutoff: false,
        }),
      })
      if (!createResponse.ok) {
        throw new Error(
          `seedPartialHistoryChannel failed (${createResponse.status}): ${await createResponse.text()}`,
        )
      }
    },
    { seedName: name },
  )

  await expect
    .poll(async () => {
      return page.evaluate(async (seedName) => {
        const token = localStorage.getItem("access_token")
        if (!token) return false

        const response = await fetch("/api/v1/data/channels", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) return false

        const channels = (await response.json()) as Array<{
          name: string
          historyCompleteToCutoff?: boolean
        }>
        return channels.some(
          (channel) =>
            channel.name === seedName &&
            channel.historyCompleteToCutoff === false,
        )
      }, name)
    })
    .toBe(true)

  await page.reload()
  await expect(page.getByTestId("command-palette-button")).toBeVisible()
  await page.getByPlaceholder("Search channels...").fill(name)
  await expect(page.locator(`[data-channel-name="${name}"]`)).toBeVisible({
    timeout: 15_000,
  })

  return name
}
