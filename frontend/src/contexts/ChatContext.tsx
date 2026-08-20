import type React from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import type { PromptScope } from "@/api/data"
import {
  useChatSessionQuery,
  useInvalidateChatSessions,
} from "@/hooks/useChatSessions"
import { saveChatSession } from "@/lib/chat-sessions/store"
import { saveLLMLog } from "@/lib/logs/write"
import { formatChannelsForPrompt } from "../lib/channels/format-channels-for-prompt"
import { formatPostsForPrompt } from "../lib/posts/post-view"
import {
  AIServiceError,
  chatWithHistoryStream,
  generateChatStream,
} from "../services/ai"
import type { ChatMessage, ChatMode, ChatSession, LLMLog } from "../types"
import { useData } from "./DataContext"
import { useRAG } from "./RAGContext"
import { useScraper } from "./ScraperContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

interface ChatContextType {
  chatMessages: ChatMessage[]
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  chatInput: string
  setChatInput: React.Dispatch<React.SetStateAction<string>>
  isChatting: boolean
  chatMode: ChatMode
  setChatMode: React.Dispatch<React.SetStateAction<ChatMode>>
  chatEndRef: React.RefObject<HTMLDivElement | null>
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>
  handleSendMessage: () => Promise<void>
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { channels, selectedChannels } = useData()
  const loadHistory = useInvalidateChatSessions()
  const {
    startDate,
    endDate,
    activeTab,
    currentChatSessionId,
    setCurrentChatSessionId,
    includeChannelBioInPrompt,
    includeChannelTagsInPrompt,
  } = useUI()
  const { aiLanguage, selectedModel, aiTemperature } = useSettings()
  const {
    scrapeChannelsInParallel,
    postSearch,
    semanticSearchQuery,
    semanticSearchRespectsTimeRange,
    semanticSearchRespectsChannels,
    handleFilterPosts,
    getPromptPostsInput,
  } = useScraper()
  const { searchSimilarPosts } = useRAG()

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [isChatting, setIsChatting] = useState(false)
  const [chatMode, setChatMode] = useState<ChatMode>("full_scope")

  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  /*
   * Load a saved transcript when one is opened from History.
   *
   * `chatMessages` is React state that only `handleSendMessage` writes, so
   * opening a chat from History set the id and left the view blank — the same
   * defect the Summary tab had, and for the same reason: deleting the old
   * restore path removed the only thing that filled these buffers.
   *
   * The ref tracks whose transcript is currently loaded, so this fires once per
   * session rather than fighting with the turns being appended live: after the
   * first message of a new chat the id becomes ours, and the ref already
   * matches it.
   */
  const loadedSessionRef = useRef<string | null>(null)
  const { data: openedSession } = useChatSessionQuery(currentChatSessionId)

  useEffect(() => {
    if (!currentChatSessionId) {
      loadedSessionRef.current = null
      return
    }
    if (loadedSessionRef.current === currentChatSessionId) return
    if (!openedSession) return
    loadedSessionRef.current = currentChatSessionId
    setChatMessages(openedSession.messages ?? [])
  }, [currentChatSessionId, openedSession])

  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = "auto"
      const scrollHeight = chatInputRef.current.scrollHeight
      chatInputRef.current.style.height = `${Math.min(scrollHeight, 200)}px`
      chatInputRef.current.style.overflowY =
        scrollHeight > 200 ? "auto" : "hidden"
    }
  }, [])

  useEffect(() => {
    if (activeTab === "chat") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [activeTab])

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatting) return

    const userMessage = chatInput.trim()
    setChatInput("")
    setChatMessages((prev) => [...prev, { role: "user", text: userMessage }])
    setIsChatting(true)

    try {
      const startTime = Date.now()
      let fullModelText = ""
      let lastResponse: any = null
      let promptUsed = ""
      let configUsed: any = null
      let systemInstructionUsed = ""
      let similarPostsUsed: any[] | undefined
      // Post count for the summary-chat entry; history (RAG) mode uses
      // similarPostsUsed instead.
      let summaryChatPostCount = 0

      // Add user message and placeholder for AI
      const initialMessages: { role: "user" | "model"; text: string }[] = [
        ...chatMessages,
        { role: "user", text: userMessage },
        { role: "model", text: "" },
      ]
      setChatMessages(initialMessages)

      if (chatMode === "semantic") {
        // RAG Logic
        toast.info("Searching history for relevant context...")

        let similarPosts
        try {
          similarPosts = await searchSimilarPosts(userMessage, 20)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Semantic search failed"
          toast.error(message)
          throw error
        }
        similarPostsUsed = similarPosts

        if (similarPosts.length === 0) {
          fullModelText =
            "I couldn't find any relevant information in your history to answer that question. Please ensure your posts have been synced and processed."
          setChatMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: "model", text: fullModelText }
            return updated
          })
        } else {
          // 4. Chat with history stream
          const { stream, prompt, config, systemInstruction } =
            await chatWithHistoryStream(
              similarPosts,
              aiLanguage,
              selectedModel,
              chatMessages,
              userMessage,
              aiTemperature,
            )

          promptUsed = prompt
          configUsed = config
          systemInstructionUsed = systemInstruction ?? ""

          for await (const chunk of stream) {
            const chunkText = chunk.text || ""
            fullModelText += chunkText
            lastResponse = chunk

            setChatMessages((prev) => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                role: "model",
                text: fullModelText,
                sources: similarPosts,
              }
              return updated
            })
          }
        }
      } else {
        // Standard Summary Chat Logic
        const now = Date.now()
        const targetTs = Math.min(endDate, now)

        const channelsToSync = channels.filter(
          (c) =>
            selectedChannels.has(c.name) &&
            (!c.lastUpdated || c.lastUpdated < targetTs - 60000), // 1 minute buffer
        )

        if (channelsToSync.length > 0) {
          toast.info(
            `Syncing ${channelsToSync.length} channels to ensure up-to-date data...`,
          )
          await scrapeChannelsInParallel(channelsToSync, "Pre-Chat Sync")

          // Refresh the eager Posts-tab list so the UI reflects the sync.
          handleFilterPosts()
        }

        // Server-eligible → send the scope (backend assembles); semantic/related
        // → client-built postsText. Refreshed after any pre-chat sync above.
        const selectedChannelNames = channels
          .filter((channel) => selectedChannels.has(channel.name))
          .map((channel) => channel.name)
        const input = await getPromptPostsInput()
        let postsText = ""
        let scope: PromptScope | undefined
        if (input.scope) {
          scope = input.scope
          const counts = await api.getPostsCounts({
            channelNames: selectedChannelNames,
            ...input.scope,
          })
          summaryChatPostCount = Object.values(counts).reduce(
            (sum, n) => sum + n,
            0,
          )
        } else {
          postsText = formatPostsForPrompt(input.posts)
          summaryChatPostCount = input.posts.length
        }
        const channelsText = formatChannelsForPrompt(
          channels,
          selectedChannels,
          {
            includeBio: includeChannelBioInPrompt,
            includeTags: includeChannelTagsInPrompt,
          },
        )

        const { stream, prompt, config, systemInstruction } =
          await generateChatStream(
            selectedChannelNames,
            channelsText,
            postsText,
            aiLanguage,
            selectedModel,
            chatMessages,
            userMessage,
            aiTemperature,
            scope,
          )

        promptUsed = prompt
        configUsed = config
        systemInstructionUsed = systemInstruction ?? ""

        for await (const chunk of stream) {
          const chunkText = chunk.text || ""
          fullModelText += chunkText
          lastResponse = chunk

          setChatMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: "model", text: fullModelText }
            return updated
          })
        }
      }

      const duration = Date.now() - startTime

      // Log LLM Interaction
      if (promptUsed) {
        const llmLog: LLMLog = {
          id:
            Date.now().toString() + Math.random().toString(36).substring(2, 7),
          model: selectedModel,
          prompt: userMessage, // For chat, the prompt is the user message
          response: fullModelText,
          systemInstruction: systemInstructionUsed,
          modelConfig: configUsed,
          fullRequest: {
            message: userMessage,
            history: chatMessages,
            config: configUsed,
          },
          fullResponse: lastResponse,
          tokens: lastResponse?.usageMetadata?.totalTokenCount,
          status: fullModelText ? "success" : "failed",
          timestamp: Date.now(),
          duration: duration,
          type: chatMode === "semantic" ? "chat_semantic" : "chat_full_scope",
        }
        await saveLLMLog(llmLog)
      }

      const finalMessages: {
        role: "user" | "model"
        text: string
        sources?: any[]
      }[] = [
        ...chatMessages,
        { role: "user", text: userMessage },
        { role: "model", text: fullModelText, sources: similarPostsUsed },
      ]

      /*
       * Persist as a chat session.
       *
       * This used to write a `Summary`: either patching the currently-selected
       * one's `chatMessages`, or inventing a row titled `Chat: <first 50
       * chars>`. Both were wrong. Patching meant a conversation held while a
       * summary happened to be open never became its own history entry, and the
       * invented row encoded the artifact's *kind* in a prefix of its body text.
       *
       * A chat depends on its scope, not on a summary — `full_scope` mode reads
       * no summary, it assembles its prompt from the same channels and dates a
       * summary would. So there is no link to write.
       */
      const sessionId = currentChatSessionId ?? Date.now().toString()
      const session: Partial<ChatSession> = {
        id: sessionId,
        channels: Array.from(selectedChannels),
        startDate,
        endDate,
        language: aiLanguage,
        model: selectedModel,
        mode: chatMode,
        postCount:
          chatMode === "semantic"
            ? (similarPostsUsed?.length ?? 0)
            : summaryChatPostCount,
        timestamp: Date.now(),
        messages: finalMessages,
        postSearch: postSearch || undefined,
        semanticSearchQuery: semanticSearchQuery || undefined,
        semanticSearchRespectsTimeRange,
        semanticSearchRespectsChannels,
      }
      await saveChatSession(session)
      // Claim the id before publishing it, so the loader effect above treats
      // this session as already-loaded and never refetches over the turns we
      // are appending live.
      loadedSessionRef.current = sessionId
      if (!currentChatSessionId) setCurrentChatSessionId(sessionId)
      await loadHistory()
    } catch (err: unknown) {
      console.error(err)
      const errorMessage =
        err instanceof AIServiceError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to generate response"
      setChatMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: "model",
          text: `Error: ${errorMessage}`,
        }
        return updated
      })
    } finally {
      setIsChatting(false)
    }
  }

  return (
    <ChatContext.Provider
      value={{
        chatMessages,
        setChatMessages,
        chatInput,
        setChatInput,
        isChatting,
        chatMode,
        setChatMode,
        chatEndRef,
        chatInputRef,
        handleSendMessage,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChatContext() {
  const context = useContext(ChatContext)
  if (context === undefined) {
    throw new Error("useChatContext must be used within a ChatProvider")
  }
  return context
}
