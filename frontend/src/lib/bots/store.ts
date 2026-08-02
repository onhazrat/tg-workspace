import { api } from "@/api"
import { stripToken } from "@/lib/botCredential"
import type { BotCredential, ChatDestination } from "@/types"

/**
 * Reads and writes for the `BotCredential` and `ChatDestination` aggregates.
 *
 * **Suppress, not invalidate** — the same rule as channels and summaries. The
 * `bots` query is written through by `BotManagement` after each save, and
 * `repository.ts` marked the resource synced so the next read would not refetch.
 *
 * ## `stripToken` on every read path, deliberately
 *
 * A bot token must never come back over the wire: `BotCredentialResponse` is a
 * closed model carrying only `hasToken`, and requests carry a stored
 * `credentialId` rather than a raw token outside `local`. `stripToken` is the
 * client half of that — belt-and-braces against a server that starts sending
 * one, and the reason a saved credential is stripped on the way *back* even
 * though the token was legitimately sent on the way *in*.
 */

/** The slice of `api` used here, injectable as a test seam (see `ChannelsApi`). */
export type BotsApi = Pick<
  typeof api,
  | "listBotCredentials"
  | "upsertBotCredential"
  | "deleteBotCredential"
  | "listChatDestinations"
  | "upsertChatDestination"
  | "deleteChatDestination"
>

export async function listBotCredentials(
  client: BotsApi = api,
): Promise<BotCredential[]> {
  return (await client.listBotCredentials()).map(stripToken)
}

export async function saveBotCredential(
  bot: BotCredential,
  client: BotsApi = api,
): Promise<BotCredential> {
  // The token goes *out* — this is how a credential is stored — and is stripped
  // off whatever comes back.
  return stripToken(await client.upsertBotCredential(bot.id, { ...bot }))
}

export async function deleteBotCredential(
  id: string,
  client: BotsApi = api,
): Promise<void> {
  await client.deleteBotCredential(id)
}

export async function listChatDestinations(
  client: BotsApi = api,
): Promise<ChatDestination[]> {
  return client.listChatDestinations()
}

export async function saveChatDestination(
  dest: ChatDestination,
  client: BotsApi = api,
): Promise<ChatDestination> {
  return client.upsertChatDestination(dest.id, dest)
}

export async function deleteChatDestination(
  id: string,
  client: BotsApi = api,
): Promise<void> {
  await client.deleteChatDestination(id)
}
