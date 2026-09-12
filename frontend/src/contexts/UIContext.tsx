import type React from "react"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import { scopedStorage } from "@/lib/storage/scoped"
import {
  useChatSessionParam,
  useSummaryParam,
} from "../hooks/useArtifactParams"
import { useLazyTabData } from "../hooks/useLazyTabData"
import { useWorkspaceTab } from "../hooks/useWorkspaceTab"
import type { TabType } from "../types"

interface UIContextType {
  activeTab: TabType
  setActiveTab: React.Dispatch<React.SetStateAction<TabType>>
  isRateLimited: boolean
  setIsRateLimited: React.Dispatch<React.SetStateAction<boolean>>
  summarizing: boolean
  setSummarizing: React.Dispatch<React.SetStateAction<boolean>>
  currentSummaryId: string | null
  setCurrentSummaryId: (id: string | null) => void
  /**
   * The chat being written to, distinct from the summary being viewed.
   *
   * They used to be one field, which is why chatting while a summary was open
   * overwrote *that summary's* transcript instead of starting a conversation of
   * its own. A chat depends on its scope, not on a summary.
   */
  currentChatSessionId: string | null
  setCurrentChatSessionId: (id: string | null) => void
  historySearchQuery: string
  setHistorySearchQuery: React.Dispatch<React.SetStateAction<string>>
  starredOnly: boolean
  setStarredOnly: React.Dispatch<React.SetStateAction<boolean>>
  includeChannelBioInPrompt: boolean
  setIncludeChannelBioInPrompt: React.Dispatch<React.SetStateAction<boolean>>
  includeChannelTagsInPrompt: boolean
  setIncludeChannelTagsInPrompt: React.Dispatch<React.SetStateAction<boolean>>
}

const UIContext = createContext<UIContextType | undefined>(undefined)

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { activeTab, setActiveTab } = useWorkspaceTab()
  useLazyTabData(activeTab)

  const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
  const [summarizing, setSummarizing] = useState<boolean>(false)
  /*
   * Both ids live in the URL, not in state.
   *
   * They were `useState`, which meant History's `?summary=` / `?chatSession=`
   * deep links wrote a param nothing read: clicking a row switched tab and
   * scope and then showed an empty view, because the view still resolved its
   * selection from context. Backing them with the param — the same trick
   * `useWorkspaceTab` plays for `activeTab` — makes every existing consumer
   * work unchanged *and* makes the artifact reopenable from a URL.
   */
  const { summaryId: currentSummaryId, openSummary: setCurrentSummaryId } =
    useSummaryParam()
  const {
    chatSessionId: currentChatSessionId,
    openChatSession: setCurrentChatSessionId,
  } = useChatSessionParam()
  const [historySearchQuery, setHistorySearchQuery] = useState("")
  const [starredOnly, setStarredOnly] = useState(false)
  const [includeChannelBioInPrompt, setIncludeChannelBioInPrompt] =
    useState<boolean>(() => {
      if (typeof window === "undefined") return false
      return scopedStorage.getItem("prompt_includeChannelBio") === "true"
    })
  const [includeChannelTagsInPrompt, setIncludeChannelTagsInPrompt] =
    useState<boolean>(() => {
      if (typeof window === "undefined") return false
      return scopedStorage.getItem("prompt_includeChannelTags") === "true"
    })

  useEffect(() => {
    scopedStorage.setItem(
      "prompt_includeChannelBio",
      String(includeChannelBioInPrompt),
    )
  }, [includeChannelBioInPrompt])

  useEffect(() => {
    scopedStorage.setItem(
      "prompt_includeChannelTags",
      String(includeChannelTagsInPrompt),
    )
  }, [includeChannelTagsInPrompt])

  return (
    <UIContext.Provider
      value={{
        activeTab,
        setActiveTab,
        isRateLimited,
        setIsRateLimited,
        summarizing,
        setSummarizing,
        currentSummaryId,
        setCurrentSummaryId,
        currentChatSessionId,
        setCurrentChatSessionId,
        historySearchQuery,
        setHistorySearchQuery,
        starredOnly,
        setStarredOnly,
        includeChannelBioInPrompt,
        setIncludeChannelBioInPrompt,
        includeChannelTagsInPrompt,
        setIncludeChannelTagsInPrompt,
      }}
    >
      {children}
    </UIContext.Provider>
  )
}

export const useUI = () => {
  const context = useContext(UIContext)
  if (context === undefined) {
    throw new Error("useUI must be used within a UIProvider")
  }
  return context
}
