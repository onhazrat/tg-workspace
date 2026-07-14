import { env } from "./env"

export function telegramWebDomain(): string {
  return env.telegramWebDomain
}

export function telegramWebBaseUrl(): string {
  return `https://${telegramWebDomain()}`
}

export function telegramWebViewChannelUrl(channelName: string): string {
  return `${telegramWebBaseUrl()}/s/${channelName}`
}

export function telegramWebViewPostUrl(
  channelName: string,
  postId: number,
): string {
  return `${telegramWebBaseUrl()}/s/${channelName}/${postId}`
}
