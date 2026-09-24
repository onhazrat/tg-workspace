import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import {
  useBotCredentials,
  useChatDestinations,
  useSetBotCredentials,
  useSetChatDestinations,
} from "@/hooks/useBots"
import { usePublishLogsQuery } from "@/hooks/useLogs"
import {
  deleteBotCredential,
  deleteChatDestination,
  saveBotCredential,
  saveChatDestination,
} from "@/lib/bots/store"
import { saveNetworkLog, savePublishLog } from "@/lib/logs/write"
import { buildActiveProxies } from "@/lib/syncSettings"
import { useSettings } from "../contexts/SettingsContext"
import {
  fetchBotInfo as fetchBotInfoApi,
  publishSummary,
} from "../services/telegram"
import type { BotCredential, ChatDestination, PublishLog } from "../types"
import {
  BotCredentialsPanel,
  type BotValidationState,
} from "./settings/publishing/BotCredentialsPanel"
import {
  DestinationsPanel,
  type DestValidationState,
} from "./settings/publishing/DestinationsPanel"
import {
  autofillName,
  BOT_NETWORK_ERROR,
  type BotApiCall,
  botDisplayName,
  botNetworkLog,
  canLookUpChat,
  chatDisplayName,
  checkBotToken,
  DEST_NETWORK_ERROR,
  destinationValidation,
  errorText,
  looksLikeBotToken,
  publishLogFor,
  visiblePanels,
} from "./settings/publishing/publishing-model"
import { QuickMessagePanel } from "./settings/publishing/QuickMessagePanel"
import { SettingAnchor } from "./settings/SettingAnchor"

type BotManagementProps = {
  focus?: "publishing" | "bot-credentials" | "destinations" | "quick-message"
  highlightId?: string | null
}

const EMPTY_PUBLISH_LOGS: PublishLog[] = []

// Owned here rather than passed through `DataContext`: `savePublishLog`
// invalidates this key, and an enabled query refetches on its own.
const usePublishLogs = () =>
  usePublishLogsQuery(true).data ?? EMPTY_PUBLISH_LOGS

export const BotManagement: React.FC<BotManagementProps> = ({
  focus = "publishing",
  highlightId = null,
}) => {
  const botCredentials = useBotCredentials()
  const setBotCredentials = useSetBotCredentials()
  const chatDestinations = useChatDestinations()
  const setChatDestinations = useSetChatDestinations()
  const publishLogs = usePublishLogs()
  const {
    proxyEnabled,
    defaultProxyUrls,
    torEnabled,
    torMode,
    torProxyUrls,
    torAutoRotate,
    torRotationThreshold,
  } = useSettings()

  const [selectedQuickBotId, setSelectedQuickBotId] = useState<string>("")
  const [selectedQuickDestId, setSelectedQuickDestId] = useState<string>("")
  const [quickMessage, setQuickMessage] = useState<string>("")

  const [newBotName, setNewBotName] = useState("")
  const [newBotToken, setNewBotToken] = useState("")
  const [newDestName, setNewDestName] = useState("")
  const [newDestChatId, setNewDestChatId] = useState("")
  const [isAutoFetchingBot, setIsAutoFetchingBot] = useState(false)
  const [isAutoFetchingDest, setIsAutoFetchingDest] = useState(false)
  const [isSavingBot, setIsSavingBot] = useState(false)
  const [isSavingDest, setIsSavingDest] = useState(false)
  const [botValidation, setBotValidation] = useState<BotValidationState>({})
  const [destValidation, setDestValidation] = useState<DestValidationState>({})

  const getActiveProxies = () =>
    buildActiveProxies({
      proxyEnabled,
      defaultProxyUrls,
      torEnabled,
      torMode,
      torProxyUrls,
    })

  const fetchBotInfo: BotApiCall = async (
    credentialId,
    token,
    method,
    params,
  ) => {
    const startTime = Date.now()
    let statusCode = 0
    let error: string | undefined
    let telemetry: any
    try {
      const data = await fetchBotInfoApi(
        credentialId,
        token,
        method,
        params,
        getActiveProxies().length > 0,
        torAutoRotate,
        torRotationThreshold,
      )
      statusCode = 200
      telemetry = data.telemetry
      return data
    } catch (err: any) {
      error = err.message
      throw err
    } finally {
      const duration = Date.now() - startTime
      saveNetworkLog(
        botNetworkLog({ method, statusCode, error, telemetry, duration }),
      ).catch((e) => console.error("Failed to save network log:", e))
    }
  }

  const handleBotTokenChange = async (token: string) => {
    setNewBotToken(token)
    if (!looksLikeBotToken(token)) return
    setIsAutoFetchingBot(true)
    try {
      const data = await fetchBotInfo(undefined, token, "getMe")
      const name = autofillName(data, newBotName, botDisplayName)
      if (name !== null) setNewBotName(name)
    } catch (e) {
      console.error("Auto-fetch bot failed", e)
    } finally {
      setIsAutoFetchingBot(false)
    }
  }

  const handleDestChatIdChange = async (chatId: string) => {
    setNewDestChatId(chatId)
    if (!canLookUpChat(chatId, botCredentials.length)) return
    setIsAutoFetchingDest(true)
    try {
      const data = await fetchBotInfo(
        botCredentials[0].id,
        undefined,
        "getChat",
        {
          chat_id: chatId,
        },
      )
      const name = autofillName(data, newDestName, chatDisplayName)
      if (name !== null) setNewDestName(name)
    } catch (e) {
      console.error("Auto-fetch dest failed", e)
    } finally {
      setIsAutoFetchingDest(false)
    }
  }

  const handleAddBotCredential = async () => {
    if (!newBotToken) {
      toast.error("Please provide a Bot Token.")
      return
    }
    const nameToUse = newBotName || "Unnamed Bot"
    const newBot: BotCredential = {
      id: Date.now().toString(),
      name: nameToUse,
      token: newBotToken,
    }
    setIsSavingBot(true)
    try {
      await saveBotCredential(newBot)
      setBotCredentials((prev) => [
        ...prev,
        { ...newBot, token: undefined, hasToken: true },
      ])
      setNewBotName("")
      setNewBotToken("")
      handleCheckBotToken(newBot.id)
    } finally {
      setIsSavingBot(false)
    }
  }

  /** Store what `getMe` said about a saved bot on its credential row. */
  const recordBotProfile = async (
    id: string,
    profile: { username: string; photoPath: string },
  ) => {
    const bot = botCredentials.find((b) => b.id === id)
    if (!bot) return
    const updated = {
      ...bot,
      username: profile.username,
      photoUrl: profile.photoPath || bot.photoUrl,
      lastValidated: Date.now(),
      hasToken: true,
    }
    await saveBotCredential(updated)
    setBotCredentials((prev) => prev.map((b) => (b.id === id ? updated : b)))
  }

  const handleCheckBotToken = async (id: string) => {
    setBotValidation((prev) => ({
      ...prev,
      [id]: { isValid: false, loading: true },
    }))
    let validation: BotValidationState[string]
    try {
      const checked = await checkBotToken(fetchBotInfo, id)
      if (checked.profile) await recordBotProfile(id, checked.profile)
      validation = checked.validation
    } catch (_err) {
      validation = BOT_NETWORK_ERROR
    }
    setBotValidation((prev) => ({ ...prev, [id]: validation }))
  }

  const handleCheckDestination = async (destId: string, chatId: string) => {
    if (botCredentials.length === 0) {
      toast.error("Please add a bot first to validate destinations.")
      return
    }
    setDestValidation((prev) => ({
      ...prev,
      [destId]: { isValid: false, loading: true },
    }))
    let validation: DestValidationState[string]
    try {
      const data = await fetchBotInfo(
        botCredentials[0].id,
        undefined,
        "getChat",
        {
          chat_id: chatId,
        },
      )
      validation = destinationValidation(data)
    } catch (_err) {
      validation = DEST_NETWORK_ERROR
    }
    setDestValidation((prev) => ({ ...prev, [destId]: validation }))
  }

  const handleDeleteBotCredential = async (id: string) => {
    await deleteBotCredential(id)
    setBotCredentials((prev) => prev.filter((b) => b.id !== id))
    if (selectedQuickBotId === id) setSelectedQuickBotId("")
  }

  const handleAddChatDestination = async () => {
    if (!newDestChatId) {
      toast.error("Please provide a Chat ID.")
      return
    }
    const nameToUse = newDestName || "Unnamed Destination"
    const newDest: ChatDestination = {
      id: Date.now().toString(),
      name: nameToUse,
      chatId: newDestChatId,
    }
    setIsSavingDest(true)
    try {
      await saveChatDestination(newDest)
      setChatDestinations((prev) => [...prev, newDest])
      setNewDestName("")
      setNewDestChatId("")
      handleCheckDestination(newDest.id, newDest.chatId)
    } finally {
      setIsSavingDest(false)
    }
  }

  const handleDeleteChatDestination = async (id: string) => {
    await deleteChatDestination(id)
    setChatDestinations((prev) => prev.filter((d) => d.id !== id))
    if (selectedQuickDestId === id) setSelectedQuickDestId("")
  }

  /** Send through the backend and file the publish log, whatever happened. */
  const sendAndLog = async (
    kind: "test" | "quick",
    botId: string,
    chatId: string,
    botName: string,
    destName: string,
    text: string,
  ) => {
    const result = await publishSummary(
      botId,
      chatId,
      text,
      undefined,
      getActiveProxies().length > 0,
      torAutoRotate,
      torRotationThreshold,
    )
    await savePublishLog(
      publishLogFor({ kind, botId, botName, chatId, destName, text, result }),
    )
    return result
  }

  const handleTestBot = async (
    botId: string,
    chatId: string,
    botName: string,
    destName: string,
  ) => {
    const testMessage = `🔔 Test Connection: Bot "${botName}" is working correctly!`
    try {
      const result = await sendAndLog(
        "test",
        botId,
        chatId,
        botName,
        destName,
        testMessage,
      )
      if (result.success) {
        toast.success(`Test message sent successfully using ${botName}!`)
      } else {
        toast.error(`Test failed: ${result.error}`)
      }
    } catch (e: unknown) {
      toast.error(`Test failed: ${errorText(e)}`)
    }
  }

  const handlePublish = async (
    botId: string,
    chatId: string,
    botName: string,
    text: string,
    destName: string,
  ) => {
    try {
      const result = await sendAndLog(
        "quick",
        botId,
        chatId,
        botName,
        destName,
        text,
      )
      if (result.success) {
        toast.success(`Successfully published using ${botName}!`)
      } else {
        toast.error(`Error publishing: ${result.error}`)
      }
    } catch (e: unknown) {
      toast.error(`Error publishing: ${errorText(e)}`)
    }
  }

  const show = visiblePanels(
    focus,
    botCredentials.length,
    chatDestinations.length,
  )

  return (
    <motion.div
      key="bots"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
          <div className="text-left">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm uppercase font-bold tracking-widest">
                Bot & Destination Management
              </h3>
              <span className="text-[10px] font-mono opacity-40">
                [COMMUNICATIONS]
              </span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              Configure Telegram bots and define publication targets.
            </p>
          </div>
        </div>
        <div className="h-px bg-app-ink/10 w-full" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          {show.credentials && (
            <SettingAnchor
              settingId="panel-bot-credentials"
              highlighted={highlightId === "panel-bot-credentials"}
            >
              <BotCredentialsPanel
                botCredentials={botCredentials}
                publishLogs={publishLogs}
                newBotToken={newBotToken}
                newBotName={newBotName}
                isAutoFetchingBot={isAutoFetchingBot}
                isSavingBot={isSavingBot}
                botValidation={botValidation}
                onBotTokenChange={handleBotTokenChange}
                onBotNameChange={setNewBotName}
                onAddBot={handleAddBotCredential}
                onCheckBot={handleCheckBotToken}
                onDeleteBot={handleDeleteBotCredential}
              />
            </SettingAnchor>
          )}

          {show.quickMessage && (
            <SettingAnchor
              settingId="panel-quick-message"
              highlighted={highlightId === "panel-quick-message"}
            >
              <QuickMessagePanel
                botCredentials={botCredentials}
                chatDestinations={chatDestinations}
                selectedQuickBotId={selectedQuickBotId}
                selectedQuickDestId={selectedQuickDestId}
                quickMessage={quickMessage}
                onSelectBot={setSelectedQuickBotId}
                onSelectDest={setSelectedQuickDestId}
                onMessageChange={setQuickMessage}
                onPublish={handlePublish}
              />
            </SettingAnchor>
          )}
        </div>

        <div className="space-y-8">
          {show.destinations && (
            <SettingAnchor
              settingId="panel-destinations"
              highlighted={highlightId === "panel-destinations"}
            >
              <DestinationsPanel
                chatDestinations={chatDestinations}
                botCredentials={botCredentials}
                newDestChatId={newDestChatId}
                newDestName={newDestName}
                isAutoFetchingDest={isAutoFetchingDest}
                isSavingDest={isSavingDest}
                destValidation={destValidation}
                onDestChatIdChange={handleDestChatIdChange}
                onDestNameChange={setNewDestName}
                onAddDestination={handleAddChatDestination}
                onCheckDestination={handleCheckDestination}
                onTestConnection={handleTestBot}
                onDeleteDestination={handleDeleteChatDestination}
              />
            </SettingAnchor>
          )}
        </div>
      </div>
    </motion.div>
  )
}
