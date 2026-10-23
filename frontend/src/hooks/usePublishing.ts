/**
 * What the publishing panels and the Quick message tool do with a bot (SET-03,
 * lifted out of the old `BotManagement`): call the Bot API through the backend
 * with a network log per call, look a name up while somebody types, check a
 * saved bot or chat, and send a test or a quick message with a publish log.
 *
 * The decisions themselves stay pure in `lib/bots/publishing-model.ts`; this
 * is the wiring to the store, the settings and the logs.
 */
import { toast } from "sonner"
import { useSettings } from "@/contexts/SettingsContext"
import {
  useBotCredentials,
  useChatDestinations,
  useSetBotCredentials,
  useSetChatDestinations,
} from "@/hooks/useBots"
import {
  autofillName,
  BOT_NETWORK_ERROR,
  type BotApiCall,
  type BotValidation,
  botDisplayName,
  botNetworkLog,
  canLookUpChat,
  chatDisplayName,
  chatsFromUpdates,
  checkBotToken,
  DEST_NETWORK_ERROR,
  type DestValidation,
  destinationValidation,
  errorText,
  looksLikeBotToken,
  publishLogFor,
} from "@/lib/bots/publishing-model"
import {
  deleteBotCredential,
  deleteChatDestination,
  saveBotCredential,
  saveChatDestination,
} from "@/lib/bots/store"
import { saveNetworkLog, savePublishLog } from "@/lib/logs/write"
import { buildActiveProxies } from "@/lib/syncSettings"
import { fetchBotInfo, publishSummary } from "@/services/telegram"
import type { BotCredential, ChatDestination } from "@/types"

export function usePublishing() {
  const bots = useBotCredentials()
  const setBots = useSetBotCredentials()
  const destinations = useChatDestinations()
  const setDestinations = useSetChatDestinations()
  const settings = useSettings()

  const viaProxy = () => buildActiveProxies(settings).length > 0

  const call: BotApiCall = async (credentialId, token, method, params) => {
    const started = Date.now()
    let statusCode = 0
    let error: string | undefined
    let telemetry: unknown
    try {
      const data = await fetchBotInfo(
        credentialId,
        token,
        method,
        params,
        viaProxy(),
        settings.torAutoRotate,
        settings.torRotationThreshold,
      )
      statusCode = 200
      telemetry = data.telemetry
      return data
    } catch (err) {
      error = errorText(err)
      throw err
    } finally {
      saveNetworkLog(
        botNetworkLog({
          method,
          statusCode,
          error,
          telemetry,
          duration: Date.now() - started,
        }),
      ).catch((e) => console.error("Failed to save network log:", e))
    }
  }

  /** The name `getMe` gives a token being typed, or null to leave the field. */
  const lookUpBotName = async (token: string, current: string) => {
    if (!looksLikeBotToken(token)) return null
    try {
      return autofillName(
        await call(undefined, token, "getMe"),
        current,
        botDisplayName,
      )
    } catch {
      return null
    }
  }

  /** The name `getChat` gives a chat id being typed, asked with the first bot. */
  const lookUpChatName = async (chatId: string, current: string) => {
    if (!canLookUpChat(chatId, bots.length)) return null
    try {
      return autofillName(
        await call(bots[0].id, undefined, "getChat", { chat_id: chatId }),
        current,
        chatDisplayName,
      )
    } catch {
      return null
    }
  }

  /** The chats the first bot heard from recently, to pick a destination from. */
  const listBotChats = async () => {
    if (!bots.length) return { chats: [], error: "Add a bot first" }
    try {
      return chatsFromUpdates(await call(bots[0].id, undefined, "getUpdates"))
    } catch (e) {
      return { chats: [], error: errorText(e) }
    }
  }

  /** `getMe` on a saved bot; a good answer records its username and photo. */
  const checkBot = async (id: string): Promise<BotValidation> => {
    try {
      const checked = await checkBotToken(call, id)
      const bot = bots.find((b) => b.id === id)
      if (checked.profile && bot) {
        const updated = {
          ...bot,
          username: checked.profile.username,
          photoUrl: checked.profile.photoPath || bot.photoUrl,
          lastValidated: Date.now(),
          hasToken: true,
        }
        await saveBotCredential(updated)
        setBots((prev) => prev.map((b) => (b.id === id ? updated : b)))
      }
      return checked.validation
    } catch {
      return BOT_NETWORK_ERROR
    }
  }

  const addBot = async (token: string, name: string) => {
    const bot: BotCredential = {
      id: Date.now().toString(),
      name: name || "Unnamed bot",
      token,
    }
    await saveBotCredential(bot)
    setBots((prev) => [...prev, { ...bot, token: undefined, hasToken: true }])
    return bot.id
  }

  const deleteBot = async (id: string) => {
    await deleteBotCredential(id)
    setBots((prev) => prev.filter((b) => b.id !== id))
  }

  /** `getChat` through the first bot; a refusal reads Telegram's words. */
  const checkDestination = async (
    dest: ChatDestination,
  ): Promise<DestValidation> => {
    if (!bots.length)
      return { isValid: false, info: "Add a bot first", loading: false }
    try {
      return destinationValidation(
        await call(bots[0].id, undefined, "getChat", { chat_id: dest.chatId }),
      )
    } catch {
      return DEST_NETWORK_ERROR
    }
  }

  const addDestination = async (chatId: string, name: string) => {
    const dest: ChatDestination = {
      id: Date.now().toString(),
      name: name || "Unnamed destination",
      chatId,
    }
    await saveChatDestination(dest)
    setDestinations((prev) => [...prev, dest])
    return dest
  }

  const deleteDestination = async (id: string) => {
    await deleteChatDestination(id)
    setDestinations((prev) => prev.filter((d) => d.id !== id))
  }

  /** Send through the backend and file the publish log, whatever happened. */
  const send = async (
    kind: "test" | "quick",
    bot: BotCredential,
    dest: ChatDestination,
    text: string,
  ) => {
    try {
      const result = await publishSummary(
        bot.id,
        dest.chatId,
        text,
        undefined,
        viaProxy(),
        settings.torAutoRotate,
        settings.torRotationThreshold,
      )
      await savePublishLog(
        publishLogFor({
          kind,
          botId: bot.id,
          botName: bot.name,
          chatId: dest.chatId,
          destName: dest.name,
          text,
          result,
        }),
      )
      if (result.success) toast.success(`Sent with ${bot.name}`)
      else toast.error(`Not sent: ${result.error}`)
      return result.success
    } catch (e) {
      toast.error(`Not sent: ${errorText(e)}`)
      return false
    }
  }

  /** A test message to a destination, with the first bot. */
  const testDestination = (dest: ChatDestination) =>
    bots.length
      ? send(
          "test",
          bots[0],
          dest,
          `🔔 Test Connection: Bot "${bots[0].name}" is working correctly!`,
        )
      : Promise.resolve(false)

  return {
    bots,
    destinations,
    lookUpBotName,
    lookUpChatName,
    listBotChats,
    addBot,
    checkBot,
    deleteBot,
    addDestination,
    checkDestination,
    deleteDestination,
    testDestination,
    send,
  }
}
