import type React from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import { frozenWindow, type PromptScope } from "@/api/data"
import {
  useChatSessionQuery,
  useInvalidateChatSessions,
} from "@/hooks/useChatSessions"
import {
  channelsToSyncBeforeChat,
  chatErrorText,
  chatLLMLog,
  chatSessionRecord,
  NO_CONTEXT_REPLY,
  replaceLastTurn,
  type TurnResult,
} from "@/lib/chat-sessions/chat-turn"
import type { SendOptions } from "@/lib/chat-sessions/send-options"
import { resolveSend } from "@/lib/chat-sessions/send-options"
import {
  deleteChatSession,
  saveChatSession,
  submitChatSession,
} from "@/lib/chat-sessions/store"
import { saveLLMLog } from "@/lib/logs/write"
import { formatChannelsForPrompt } from "../lib/channels/format-channels-for-prompt"
import { formatPostsForPrompt } from "../lib/posts/post-view"
import { chatWithHistoryStream, generateChatStream } from "../services/ai"
import type { ChatMessage, ChatMode, ChatSession, Post } from "../types"
import { useData } from "./DataContext"
import { useRAG } from "./RAGContext"
import { useScope } from "./ScopeContext"
import { useScraper } from "./ScraperContext"
import { useSettings } from "./SettingsContext"
import { useUI } from "./UIContext"

interface ChatContextType {
  chatMessages: ChatMessage[]
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  chatInput: string
  setChatInput: React.Dispatch<React.SetStateAction<string>>
  /**
   * The question typed on the Action tab but not asked yet (AW-09).
   *
   * It lives here rather than in `ActionView` because Action is unmounted the
   * moment you go to Posts to check the Analysis window — and checking the
   * window the Action is about to use must not be the thing that throws the
   * Action away. Separate from `chatInput`, which is the Chat tab's composer
   * and carries an existing conversation on.
   */
  actionDraft: string
  setActionDraft: React.Dispatch<React.SetStateAction<string>>
  isChatting: boolean
  chatMode: ChatMode
  setChatMode: React.Dispatch<React.SetStateAction<ChatMode>>
  chatEndRef: React.RefObject<HTMLDivElement | null>
  chatInputRef: React.RefObject<HTMLTextAreaElement | null>
  /**
   * Send a turn. With no argument it sends what is in the composer, after the
   * turns on screen, into the session on screen — which is what the Chat tab
   * wants. The Action tab starts a conversation from outside all three, so it
   * passes them explicitly. See `resolveSend`.
   */
  handleSendMessage: (options?: SendOptions) => Promise<void>
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { channels, selectedChannels } = useData()
  const loadHistory = useInvalidateChatSessions()
  const { startDate, endDate } = useScope()
  const {
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
    semanticSearchRespectsChannels,
    handleFilterPosts,
    getPromptPostsInput,
    getScopeSubmission,
  } = useScraper()
  const { searchSimilarPosts } = useRAG()

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const [actionDraft, setActionDraft] = useState("")
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

  /** Stream a reply into the last turn on screen; returns the text and the final chunk. */
  const streamReply = async (
    stream: AsyncIterable<{ text: string }>,
    sources?: Post[],
  ) => {
    let text = ""
    let lastChunk: unknown = null
    for await (const chunk of stream) {
      text += chunk.text || ""
      lastChunk = chunk
      const turn: ChatMessage = { role: "model", text, sources }
      setChatMessages((prev) => replaceLastTurn(prev, turn))
    }
    return { text, lastChunk }
  }

  /** Answer from the posts most similar to the question (RAG). */
  const answerFromSimilarPosts = async (
    userMessage: string,
    history: ChatMessage[],
  ): Promise<TurnResult> => {
    toast.info("Searching history for relevant context...")
    let sources: Post[]
    try {
      sources = await searchSimilarPosts(userMessage, 20, {
        startDate,
        endDate,
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Semantic search failed",
      )
      throw error
    }
    if (sources.length === 0) {
      const turn: ChatMessage = { role: "model", text: NO_CONTEXT_REPLY }
      setChatMessages((prev) => replaceLastTurn(prev, turn))
      return {
        text: NO_CONTEXT_REPLY,
        lastChunk: null,
        prompt: "",
        config: null,
        systemInstruction: "",
        sources,
        postCount: 0,
      }
    }
    const { stream, prompt, config, systemInstruction } =
      await chatWithHistoryStream(
        sources,
        aiLanguage,
        selectedModel,
        history,
        userMessage,
        aiTemperature,
      )
    return {
      ...(await streamReply(stream, sources)),
      prompt,
      config,
      systemInstruction: systemInstruction ?? "",
      sources,
      postCount: sources.length,
    }
  }

  /** Answer from every post in the Analysis window the session froze. */
  const answerFromScope = async (
    userMessage: string,
    history: ChatMessage[],
    selectedChannelNames: string[],
    frozen: ChatSession["scope"],
  ): Promise<TurnResult> => {
    const channelsToSync = channelsToSyncBeforeChat(
      channels,
      selectedChannels,
      endDate,
      Date.now(),
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
    const input = await getPromptPostsInput()
    let postsText = ""
    let scope: PromptScope | undefined
    let postCount: number
    if (input.scope) {
      // Select by what was frozen, not by what the clock says now — the
      // Chat and its prompt have to name the same two instants. The counts
      // go through the same value, or the number stored beside the answer
      // describes a different window than the answer does.
      scope = frozen
        ? { ...input.scope, window: frozenWindow(frozen) }
        : input.scope
      const counts = await api.getPostsCounts({
        channelNames: selectedChannelNames,
        ...scope,
      })
      postCount = Object.values(counts).reduce((sum, n) => sum + n, 0)
    } else {
      postsText = formatPostsForPrompt(input.posts)
      postCount = input.posts.length
    }

    const { stream, prompt, config, systemInstruction } =
      await generateChatStream(
        selectedChannelNames,
        formatChannelsForPrompt(channels, selectedChannels, {
          includeBio: includeChannelBioInPrompt,
          includeTags: includeChannelTagsInPrompt,
        }),
        postsText,
        aiLanguage,
        selectedModel,
        history,
        userMessage,
        aiTemperature,
        scope,
      )
    return {
      ...(await streamReply(stream)),
      prompt,
      config,
      systemInstruction: systemInstruction ?? "",
      postCount,
    }
  }

  const handleSendMessage = async (options?: SendOptions) => {
    if (isChatting) return

    const {
      message: userMessage,
      history,
      sessionId: baseSessionId,
    } = resolveSend(options, {
      chatInput,
      chatMessages,
      sessionId: currentChatSessionId,
    })
    if (!userMessage) return

    setChatInput("")
    setIsChatting(true)

    // A UUID, not a timestamp — see the note in `AIContext`. `id` is the whole
    // primary key of `tg_chat_sessions`, and ticket 17 made a cross-account
    // collision refuse the create instead of merging into it.
    const sessionId = baseSessionId ?? crypto.randomUUID()
    const selectedChannelNames = channels
      .filter((channel) => selectedChannels.has(channel.name))
      .map((channel) => channel.name)

    // Submission creates the row, so a turn that produces nothing has to take
    // it back — otherwise a chat whose very first message failed sits in
    // History for ever as an empty session with a perfectly good Scope. Only
    // ever the row *this* call created: a failure on turn nine does not throw
    // away eight turns that worked.
    let openedId: string | null = null
    //: The row the submission opened, on the turn that opened it. Holds the
    //: frozen Scope the rest of this turn assembles from.
    let opened: ChatSession | undefined

    try {
      // Submit before a single token is spent (AW-06). The server resolves the
      // Analysis window against its own current minute and stores the result,
      // so model latency, a retry and this browser's clock cannot move the
      // boundaries the finished Chat claims it used.
      //
      // On the turn that *creates* the session and never again, which matters
      // more here than it does for a Summary: a conversation writes back after
      // every turn and can easily outlive the Live window it started in, so
      // before this the recorded window was whichever one the last message
      // happened to land in.
      //
      // No explicit Post selection, deliberately. A semantic chat ranks Posts
      // per *turn*, against the question being asked; the session's Scope is
      // the window and filters that ranking ran inside, and `scopedPostCount`
      // being null says exactly that.
      if (!baseSessionId) {
        opened = await submitChatSession({
          id: sessionId,
          scope: getScopeSubmission(selectedChannelNames),
          language: aiLanguage,
          model: selectedModel,
          mode: chatMode,
          extra: {
            postSearch: postSearch || undefined,
            semanticSearchQuery: semanticSearchQuery || undefined,
            semanticSearchRespectsChannels,
          },
        })
        openedId = sessionId
      }

      // The window the *row* records, which on turn one is what the server
      // just froze and afterwards is what it froze back then. Assembling the
      // prompt from live scope instead was the defect: a conversation held
      // across a Live boundary answered later turns from a window its own
      // record did not claim. `undefined` only for a session opened before
      // AW-06, which AW-07 deletes.
      const frozen = opened?.scope ?? openedSession?.scope

      const startTime = Date.now()
      setChatMessages([
        ...history,
        { role: "user", text: userMessage },
        { role: "model", text: "" },
      ])

      const turn =
        chatMode === "semantic"
          ? await answerFromSimilarPosts(userMessage, history)
          : await answerFromScope(
              userMessage,
              history,
              selectedChannelNames,
              frozen,
            )

      const log = chatLLMLog(turn, {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
        model: selectedModel,
        mode: chatMode,
        message: userMessage,
        history,
        now: Date.now(),
        durationMs: Date.now() - startTime,
      })
      if (log) await saveLLMLog(log)

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
      await saveChatSession(
        chatSessionRecord(sessionId, history, userMessage, turn, Date.now()),
      )
      openedId = null
      // Claim the id before publishing it, so the loader effect above treats
      // this session as already-loaded and never refetches over the turns we
      // are appending live.
      loadedSessionRef.current = sessionId
      if (currentChatSessionId !== sessionId) setCurrentChatSessionId(sessionId)
      await loadHistory()
    } catch (err: unknown) {
      console.error(err)
      const failure: ChatMessage = { role: "model", text: chatErrorText(err) }
      setChatMessages((prev) => replaceLastTurn(prev, failure))
    } finally {
      if (openedId) await deleteChatSession(openedId).catch(() => {})
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
        actionDraft,
        setActionDraft,
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
