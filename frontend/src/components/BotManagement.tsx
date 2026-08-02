import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { saveNetworkLog, savePublishLog } from "@/lib/logs/write"
import { buildActiveProxies } from "@/lib/syncSettings"
import { useData } from "../contexts/DataContext"
import { useSettings } from "../contexts/SettingsContext"
import {
  deleteBotCredential,
  deleteChatDestination,
  saveBotCredential,
  saveChatDestination,
} from "../lib/repository"
import {
  fetchBotInfo as fetchBotInfoApi,
  publishSummary,
} from "../services/telegram"
import type {
  BotCredential,
  ChatDestination,
  NetworkLog,
  PublishLog,
} from "../types"
import {
  BotCredentialsPanel,
  type BotValidationState,
} from "./settings/publishing/BotCredentialsPanel"
import {
  DestinationsPanel,
  type DestValidationState,
} from "./settings/publishing/DestinationsPanel"
import { QuickMessagePanel } from "./settings/publishing/QuickMessagePanel"
import { SettingAnchor } from "./settings/SettingAnchor"

type BotManagementProps = {
  focus?: "publishing" | "bot-credentials" | "destinations" | "quick-message"
  highlightId?: string | null
}

export const BotManagement: React.FC<BotManagementProps> = ({
  focus = "publishing",
  highlightId = null,
}) => {
  const {
    loadLogs,
    botCredentials,
    setBotCredentials,
    chatDestinations,
    setChatDestinations,
    publishLogs,
    loadNetworkLogs,
  } = useData()
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchBotInfo = async (
    credentialId: string | undefined,
    token: string | undefined,
    method: string,
    params?: Record<string, string | number>,
  ): Promise<any> => {
    const activeProxies = getActiveProxies()
    const startTime = Date.now()
    let status = 0
    let errorMsg: string | undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let telemetryData: any

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await fetchBotInfoApi(
        credentialId,
        token,
        method,
        params,
        activeProxies.length > 0,
        activeProxies,
        torAutoRotate,
        torRotationThreshold,
      )
      status = 200
      telemetryData = data.telemetry
      return data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      errorMsg = error.message
      throw error
    } finally {
      const duration = Date.now() - startTime
      const proxyUsed =
        telemetryData?.attempts?.[telemetryData.attempts.length - 1]?.proxyUrl
      const attempts = telemetryData?.attempts?.length || 1

      const logEntry: NetworkLog = {
        id: crypto.randomUUID(),
        url: `https://api.telegram.org/bot.../${method}`,
        method: "POST",
        status: status === 200 ? "success" : "failed",
        statusCode: status,
        duration: telemetryData?.totalDuration || duration,
        source: "BotManagement",
        timestamp: Date.now(),
        error: errorMsg,
        proxyUsed,
        attempts,
        telemetry: telemetryData,
      }
      saveNetworkLog(logEntry)
        .then(() => loadNetworkLogs())
        .catch((e) => console.error("Failed to save network log:", e))
    }
  }

  const handleBotTokenChange = async (token: string) => {
    setNewBotToken(token)
    if (token.includes(":") && token.length > 20) {
      setIsAutoFetchingBot(true)
      try {
        const data = await fetchBotInfo(undefined, token, "getMe")
        if (data.ok && !newBotName) {
          setNewBotName(data.result.first_name || data.result.username || "")
        }
      } catch (e) {
        console.error("Auto-fetch bot failed", e)
      } finally {
        setIsAutoFetchingBot(false)
      }
    }
  }

  const handleDestChatIdChange = async (chatId: string) => {
    setNewDestChatId(chatId)
    if (chatId.length >= 4 && botCredentials.length > 0) {
      const bot = botCredentials[0]
      setIsAutoFetchingDest(true)
      try {
        const data = await fetchBotInfo(bot.id, undefined, "getChat", {
          chat_id: chatId,
        })
        if (data.ok && !newDestName) {
          setNewDestName(
            data.result.title ||
              data.result.username ||
              data.result.first_name ||
              "",
          )
        }
      } catch (e) {
        console.error("Auto-fetch dest failed", e)
      } finally {
        setIsAutoFetchingDest(false)
      }
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

  const handleCheckBotToken = async (id: string) => {
    setBotValidation((prev) => ({
      ...prev,
      [id]: { isValid: false, loading: true },
    }))
    try {
      const data = await fetchBotInfo(id, undefined, "getMe")
      if (data.ok) {
        let photoPath = ""
        if (
          data.result.can_join_groups &&
          data.result.can_read_all_group_messages !== undefined
        ) {
          try {
            const photosData = await fetchBotInfo(
              id,
              undefined,
              "getUserProfilePhotos",
              { user_id: data.result.id, limit: 1 },
            )
            if (photosData.ok && photosData.result.total_count > 0) {
              const fileId = photosData.result.photos[0][0].file_id
              const fileData = await fetchBotInfo(id, undefined, "getFile", {
                file_id: fileId,
              })
              if (fileData.ok) {
                photoPath = fileData.result.file_path
              }
            }
          } catch (e) {
            console.error("Error fetching bot photo:", e)
          }
        }

        const updatedBot = botCredentials.find((b) => b.id === id)
        if (updatedBot) {
          const newBot = {
            ...updatedBot,
            username: data.result.username,
            photoUrl: photoPath || updatedBot.photoUrl,
            lastValidated: Date.now(),
            hasToken: true,
          }
          await saveBotCredential(newBot)
          setBotCredentials((prev) =>
            prev.map((b) => (b.id === id ? newBot : b)),
          )
        }

        setBotValidation((prev) => ({
          ...prev,
          [id]: {
            isValid: true,
            botInfo: `@${data.result.username} (${data.result.first_name})`,
            loading: false,
          },
        }))
      } else {
        setBotValidation((prev) => ({
          ...prev,
          [id]: { isValid: false, botInfo: "Invalid Token", loading: false },
        }))
      }
    } catch (_err) {
      setBotValidation((prev) => ({
        ...prev,
        [id]: { isValid: false, botInfo: "Network Error", loading: false },
      }))
    }
  }

  const handleCheckDestination = async (destId: string, chatId: string) => {
    if (botCredentials.length === 0) {
      toast.error("Please add a bot first to validate destinations.")
      return
    }

    const bot = botCredentials[0]
    setDestValidation((prev) => ({
      ...prev,
      [destId]: { isValid: false, loading: true },
    }))

    try {
      const data = await fetchBotInfo(bot.id, undefined, "getChat", {
        chat_id: chatId,
      })

      if (data.ok) {
        let info =
          data.result.title ||
          data.result.username ||
          data.result.first_name ||
          "Valid Chat"
        if (data.result.type) info += ` (${data.result.type.toUpperCase()})`

        setDestValidation((prev) => ({
          ...prev,
          [destId]: { isValid: true, info, loading: false },
        }))
      } else {
        setDestValidation((prev) => ({
          ...prev,
          [destId]: {
            isValid: false,
            info: data.description || "Invalid Chat ID",
            loading: false,
          },
        }))
      }
    } catch (_err) {
      setDestValidation((prev) => ({
        ...prev,
        [destId]: { isValid: false, info: "Network Error", loading: false },
      }))
    }
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

  const handleTestBot = async (
    botId: string,
    chatId: string,
    botName: string,
    destName: string,
  ) => {
    const testMessage = `🔔 Test Connection: Bot "${botName}" is working correctly!`
    try {
      const activeProxies = getActiveProxies()
      const result = await publishSummary(
        botId,
        chatId,
        testMessage,
        undefined,
        activeProxies.length > 0,
        activeProxies,
        torAutoRotate,
        torRotationThreshold,
      )

      const log: PublishLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        summaryId: `test-${Date.now()}`,
        botId: botId,
        botName: botName,
        chatId: chatId,
        chatName: destName,
        status: result.success ? "success" : "failed",
        error: result.error,
        timestamp: Date.now(),
        fullRequest: result.requests,
        fullResponse: result.responses,
        textSent: testMessage,
      }
      await savePublishLog(log)
      await loadLogs()

      if (result.success) {
        toast.success(`Test message sent successfully using ${botName}!`)
      } else {
        toast.error(`Test failed: ${result.error}`)
      }
    } catch (e: unknown) {
      toast.error(`Test failed: ${e instanceof Error ? e.message : String(e)}`)
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
      const activeProxies = getActiveProxies()
      const result = await publishSummary(
        botId,
        chatId,
        text,
        undefined,
        activeProxies.length > 0,
        activeProxies,
        torAutoRotate,
        torRotationThreshold,
      )

      const log: PublishLog = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        summaryId: `quick-${Date.now()}`,
        botId: botId,
        botName: botName,
        chatId: chatId,
        chatName: destName,
        status: result.success ? "success" : "failed",
        error: result.error,
        timestamp: Date.now(),
        fullRequest: result.requests,
        fullResponse: result.responses,
        textSent: text,
      }
      await savePublishLog(log)
      await loadLogs()

      if (result.success) {
        toast.success(`Successfully published using ${botName}!`)
      } else {
        toast.error(`Error publishing: ${result.error}`)
      }
    } catch (e: unknown) {
      toast.error(
        `Error publishing: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const showCredentials = focus === "publishing" || focus === "bot-credentials"
  const showDestinations = focus === "publishing" || focus === "destinations"
  const showQuickMessage =
    (focus === "publishing" || focus === "quick-message") &&
    botCredentials.length > 0 &&
    chatDestinations.length > 0

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
          {showCredentials && (
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

          {showQuickMessage && (
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
          {showDestinations && (
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
