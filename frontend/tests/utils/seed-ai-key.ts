import { expect, type Page } from "@playwright/test"

/**
 * Give the signed-in account an AI Key, so the controls that spend one are live.
 *
 * The run buttons that bill a Key (Generate Summary, Generate Tags, Start a
 * chat) are disabled until one is selected — the fix for an account meeting
 * `AI_KEY_MISSING_DETAIL` from a button whose only cure used to live two tabs
 * away. A spec that clicks one of those buttons therefore has to hold a Key,
 * which is not extra scaffolding: it is the precondition the product now states
 * out loud.
 *
 * The Key is deliberately junk. `PUT /data/ai-keys/{id}` stores the row whether
 * or not the provider check passes — `validated: false` is a normal answer, not
 * an error — so no live provider is needed and nothing here spends money. What
 * the spec gets is a *selectable* Key, which is all the gate asks for.
 */
export async function seedAiKey(
  page: Page,
  label = "e2e key",
): Promise<string> {
  const id = `e2e-ai-key-${Date.now()}`

  await page.evaluate(
    async ({ keyId, keyLabel }) => {
      const token = localStorage.getItem("access_token")
      if (!token) throw new Error("seedAiKey: missing access_token")

      const response = await fetch(`/api/v1/data/ai-keys/${keyId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: keyLabel,
          provider: "gemini",
          baseUrl: null,
          key: "e2e-not-a-real-key",
        }),
      })
      if (!response.ok) {
        throw new Error(
          `seedAiKey failed (${response.status}): ${await response.text()}`,
        )
      }
    },
    { keyId: id, keyLabel: label },
  )

  await expect
    .poll(async () =>
      page.evaluate(async (keyId) => {
        const token = localStorage.getItem("access_token")
        if (!token) return false
        const response = await fetch("/api/v1/data/ai-keys", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) return false
        const keys = (await response.json()) as Array<{ id: string }>
        return keys.some((k) => k.id === keyId)
      }, id),
    )
    .toBe(true)

  // The selection is written by the query that fetches the list, so the page
  // has to load it once before the gated buttons see a Key.
  await page.reload()
  return id
}
