import { expect, type Page } from "@playwright/test"

import { firstSuperuser, firstSuperuserPassword } from "../config"

/**
 * Put one summary and one chat in the database, through the API.
 *
 * The open-from-History specs need an artifact that exists *before* the page
 * loads — generating one would drag an AI call into a test about navigation.
 */
export const OPEN_SUMMARY_ID = "e2e-open-summary"
export const WIDE_SUMMARY_ID = "e2e-wide-summary"
export const OPEN_CHAT_ID = "e2e-open-chat"
export const OPEN_SUMMARY_BODY = "Three things happened this week."

/**
 * A real summary in this database carries 1,722 channel names. The History card
 * renders them on one `truncate` line, which only clamps if every ancestor is
 * allowed to shrink — so the wide row is seeded on purpose, not as a stress
 * test. 600 names is far past the point where the bug showed.
 */
export const WIDE_SUMMARY_CHANNELS = Array.from(
  { length: 600 },
  (_, i) => `e2e_wide_channel_number_${i}`,
)

/**
 * `page.request` does not carry the app's credentials.
 *
 * The session token lives in `localStorage`, which `storageState` restores for
 * the *browser* and not for the API context — so every seed PUT here answered
 * 401 while the helper returned void and the specs passed on rows a human had
 * left in the dev database. Fetch a token, and assert every write.
 */
async function authHeaders(page: Page): Promise<Record<string, string>> {
  const login = await page.request.post("/api/v1/login/access-token", {
    form: { username: firstSuperuser, password: firstSuperuserPassword },
  })
  expect(login.ok(), `login for seeding failed: ${login.status()}`).toBe(true)
  const { access_token } = (await login.json()) as { access_token: string }
  return { Authorization: `Bearer ${access_token}` }
}

export async function seedArtifacts(page: Page): Promise<void> {
  const now = Date.now()
  const headers = await authHeaders(page)

  const put = async (path: string, data: unknown): Promise<void> => {
    const response = await page.request.put(path, { headers, data })
    expect(
      response.ok(),
      `seeding ${path} failed: ${response.status()} ${await response.text()}`,
    ).toBe(true)
  }

  /**
   * Open an artifact at a frozen Scope, which is the only way it gets one.
   *
   * AW-07 dropped the `channels` / `startDate` / `endDate` trio, so a `PUT`
   * has nowhere to put a channel list: it is inside `scope` now, and only a
   * submission writes that. Seeding through `PUT` alone still *succeeds* here
   * — which is the trap, because the card then renders "No channels" and the
   * wide-card regression test below passes without exercising anything.
   */
  const submit = async (
    path: string,
    id: string,
    channels: string[],
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    const response = await page.request.post(path, {
      headers,
      data: {
        id,
        scope: {
          channels,
          window: { mode: "fixed", start: now - 86_400_000, end: now },
        },
        ...extra,
      },
    })
    expect(
      response.ok(),
      `submitting ${path}/${id} failed: ${response.status()} ${await response.text()}`,
    ).toBe(true)
  }

  await submit(
    "/api/v1/data/summaries",
    WIDE_SUMMARY_ID,
    WIDE_SUMMARY_CHANNELS,
    {
      model: "gemini-3-flash-preview",
      postCount: 7,
    },
  )
  await put(`/api/v1/data/summaries/${WIDE_SUMMARY_ID}`, {
    text: "Wide.",
    timestamp: now + 1000,
  })

  await submit("/api/v1/data/summaries", OPEN_SUMMARY_ID, ["alpha"], {
    model: "gemini-3-flash-preview",
    postCount: 42,
  })
  await put(`/api/v1/data/summaries/${OPEN_SUMMARY_ID}`, {
    text: `# Weekly report\n\n${OPEN_SUMMARY_BODY}`,
    timestamp: now,
  })

  await submit("/api/v1/data/chat-sessions", OPEN_CHAT_ID, ["alpha"])
  await put(`/api/v1/data/chat-sessions/${OPEN_CHAT_ID}`, {
    timestamp: now - 1000,
    messages: [
      { role: "user", text: "what changed?" },
      { role: "model", text: "three things" },
    ],
  })
}
