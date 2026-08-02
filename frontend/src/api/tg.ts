import {
  type ChannelInfoRequest,
  type PublishRequest,
  telegramApiChannelInfo,
  telegramApiPublish,
} from "@/client"
import { request, requestBlob } from "./base"

/**
 * Telegram API — split by response-model openness (see `api/jobs.ts` and
 * ADR-006 for the rule; `api/client-split.conform.ts` enforces it).
 *
 * Two wrappers went away here rather than moving. `scrape` and
 * `resolveStartTime` had **no callers left**: scraping has been driven
 * server-side through `POST /api/v1/jobs/sync` since the migration, and start
 * times are resolved by `jobs/settings.py`, not the browser. Both routes are
 * still live and still used by the backend — only the dead frontend wrappers
 * are gone.
 *
 * Blob fetches stay hand-written for a reason unrelated to openness: the
 * generated client parses every response as JSON, and these are images and
 * files.
 */
export const tgApi = {
  /**
   * Open response model — hand-written.
   *
   * `BotInfoResponse` forwards the raw Bot API reply, which is deliberately not
   * modelled, so its generated type is an index signature and buys nothing.
   */
  botInfo: (body: Record<string, unknown>) =>
    request("/api/v1/telegram/bot-info", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Closed response models — generated.
  channelInfo: (body: ChannelInfoRequest) => telegramApiChannelInfo({ body }),

  publish: (body: PublishRequest) => telegramApiPublish({ body }),

  // Binary responses — the generated client always parses JSON.
  fetchBotFile: (credentialId: string, path: string) => {
    const qs = new URLSearchParams({ path })
    return requestBlob(`/api/v1/telegram/bot-file/${credentialId}?${qs}`)
  },

  fetchChannelPhoto: (channelId: string) =>
    requestBlob(
      `/api/v1/telegram/channel-photo/${encodeURIComponent(channelId)}`,
    ),

  fetchPostThumb: (thumbApiPath: string) => requestBlob(thumbApiPath),
}
