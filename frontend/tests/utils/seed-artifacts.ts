import type { Page } from "@playwright/test"

/**
 * Put one summary and one chat in the database, through the API.
 *
 * The open-from-History specs need an artifact that exists *before* the page
 * loads — generating one would drag an AI call into a test about navigation.
 */
export const OPEN_SUMMARY_ID = "e2e-open-summary"
export const OPEN_CHAT_ID = "e2e-open-chat"
export const OPEN_SUMMARY_BODY = "Three things happened this week."

export async function seedArtifacts(page: Page): Promise<void> {
  const now = Date.now()
  await page.request.put(`/api/v1/data/summaries/${OPEN_SUMMARY_ID}`, {
    data: {
      text: `# Weekly report\n\n${OPEN_SUMMARY_BODY}`,
      channels: ["alpha"],
      timestamp: now,
      model: "gemini-3-flash-preview",
      postCount: 42,
    },
  })
  await page.request.put(`/api/v1/data/chat-sessions/${OPEN_CHAT_ID}`, {
    data: {
      channels: ["alpha"],
      timestamp: now - 1000,
      messages: [
        { role: "user", text: "what changed?" },
        { role: "model", text: "three things" },
      ],
    },
  })
}
