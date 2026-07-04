import { request, requestBlob } from "./base"

export const tgApi = {
  scrape: (body: Record<string, unknown>) =>
    request("/api/v1/telegram/scrape", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  channelInfo: (body: Record<string, unknown>) =>
    request("/api/v1/telegram/channel-info", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  resolveStartTime: (body: Record<string, unknown>) =>
    request<{ startId: number }>("/api/v1/telegram/resolve-start-time", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  botInfo: (body: Record<string, unknown>) =>
    request("/api/v1/telegram/bot-info", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  publish: (body: Record<string, unknown>) =>
    request("/api/v1/telegram/publish", {
      method: "POST",
      body: JSON.stringify(body),
    }),

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
