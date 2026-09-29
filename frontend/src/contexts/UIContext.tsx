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
import { useWorkspaceTabs, type WorkspaceTabs } from "../hooks/useWorkspaceTabs"
import type { TabType } from "../types"

interface UIContextType {
  activeTab: TabType
  /** "Go to <kind>": see `useWorkspaceTabs`. */
  setActiveTab: (tab: TabType) => void
  /** The tab strip and its operations (TABS-01). */
  workspaceTabs: WorkspaceTabs
  isRateLimited: boolean
  setIsRateLimited: React.Dispatch<React.SetStateAction<boolean>>
  summarizing: boolean
  setSummarizing: React.Dispatch<React.SetStateAction<boolean>>
  /** The active tab's Summary; null on any other tab or an empty one. */
  currentSummaryId: string | null
  /**
   * The chat being written to, distinct from the summary being viewed.
   *
   * They used to be one field, which is why chatting while a summary was open
   * overwrote *that summary's* transcript instead of starting a conversation of
   * its own. A chat depends on its scope, not on a summary.
   */
  currentChatSessionId: string | null
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
  const workspaceTabs = useWorkspaceTabs()
  const { activeTab, setActiveTab } = workspaceTabs
  useLazyTabData(activeTab)

  const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
  const [summarizing, setSummarizing] = useState<boolean>(false)
  /*
   * Both ids live in the URL, not in state, and only the active tab's is
   * there (TABS-01), so each is exactly "the Artifact the active tab holds".
   * Opening or creating one goes through `workspaceTabs`, which is what gives
   * it a tab of its own.
   */
  const { summaryId: currentSummaryId } = useSummaryParam()
  const { chatSessionId: currentChatSessionId } = useChatSessionParam()
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
        workspaceTabs,
        isRateLimited,
        setIsRateLimited,
        summarizing,
        setSummarizing,
        currentSummaryId,
        currentChatSessionId,
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
