import { expect, type Page } from "@playwright/test"

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
