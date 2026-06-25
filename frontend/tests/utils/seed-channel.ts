import { expect, type Page } from "@playwright/test"

export async function seedTestChannel(
  page: Page,
  channelName?: string,
): Promise<string> {
  const name = channelName ?? `e2e${Date.now()}`

  await page.evaluate(async (seedName) => {
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
      body: JSON.stringify({ id: seedName, name: seedName }),
    })

    if (!response.ok) {
      throw new Error(
        `seedTestChannel failed (${response.status}): ${await response.text()}`,
      )
    }
  }, name)

  await page.reload()
  await expect(page.getByTestId("command-palette-button")).toBeVisible()
  await expect(page.getByText(`@${name}`)).toBeVisible({ timeout: 15_000 })

  return name
}
