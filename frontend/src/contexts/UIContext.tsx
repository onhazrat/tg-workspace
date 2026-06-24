import type React from "react"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import { useLazyTabData } from "../hooks/useLazyTabData"
import { useSummarizerTab } from "../hooks/useSummarizerTab"
import type { TabType } from "../types"

interface UIContextType {
  activeTab: TabType
  setActiveTab: React.Dispatch<React.SetStateAction<TabType>>
  isRateLimited: boolean
  setIsRateLimited: React.Dispatch<React.SetStateAction<boolean>>
  startDate: number
  setStartDate: React.Dispatch<React.SetStateAction<number>>
  endDate: number
  setEndDate: React.Dispatch<React.SetStateAction<number>>
  setDateRange: (start: number, end: number) => void
  summarizing: boolean
  setSummarizing: React.Dispatch<React.SetStateAction<boolean>>
  currentSummaryId: string | null
  setCurrentSummaryId: React.Dispatch<React.SetStateAction<string | null>>
  historySearchQuery: string
  setHistorySearchQuery: React.Dispatch<React.SetStateAction<string>>
  starredOnly: boolean
  setStarredOnly: React.Dispatch<React.SetStateAction<boolean>>
}

const UIContext = createContext<UIContextType | undefined>(undefined)

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { activeTab, setActiveTab } = useSummarizerTab()
  useLazyTabData(activeTab)

  const [isRateLimited, setIsRateLimited] = useState<boolean>(false)
  const [summarizing, setSummarizing] = useState<boolean>(false)
  const [currentSummaryId, setCurrentSummaryId] = useState<string | null>(null)
  const [historySearchQuery, setHistorySearchQuery] = useState("")
  const [starredOnly, setStarredOnly] = useState(false)

  const [startDate, setStartDateInternal] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("startDateTs")
      if (saved && !Number.isNaN(Number(saved))) return Number(saved)
      const oldSaved = localStorage.getItem("startDate")
      if (oldSaved) {
        const ts = new Date(oldSaved).getTime()
        if (!Number.isNaN(ts)) return ts
      }
    }
    return Date.now() - 7 * 24 * 60 * 60 * 1000
  })

  const [endDate, setEndDateInternal] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("endDateTs")
      if (saved && !Number.isNaN(Number(saved))) return Number(saved)
      const oldSaved = localStorage.getItem("endDate")
      if (oldSaved) {
        const ts = new Date(oldSaved).getTime()
        if (!Number.isNaN(ts)) return ts
      }
    }
    return Date.now()
  })

  const setStartDate = (value: React.SetStateAction<number>) => {
    if (typeof value === "function") {
      setStartDateInternal((prev) => {
        const next = value(prev)
        if (next > endDate) {
          setEndDateInternal(next)
        }
        return next
      })
    } else {
      setStartDateInternal(value)
      if (value > endDate) {
        setEndDateInternal(value)
      }
    }
  }

  const setEndDate = (value: React.SetStateAction<number>) => {
    const now = Date.now()

    if (typeof value === "function") {
      setEndDateInternal((prev) => {
        let next = value(prev)
        if (next > now) next = now
        if (next < startDate) {
          setStartDateInternal(next)
        }
        return next
      })
    } else {
      const next = value > now ? now : value
      if (next < startDate) {
        setStartDateInternal(next)
      }
      setEndDateInternal(next)
    }
  }

  const setDateRange = (start: number, end: number) => {
    const now = Date.now()
    const finalEnd = end > now ? now : end
    const finalStart = start > finalEnd ? finalEnd : start

    setStartDateInternal(finalStart)
    setEndDateInternal(finalEnd)
  }

  useEffect(() => {
    localStorage.setItem("startDateTs", startDate.toString())
    localStorage.setItem("endDateTs", endDate.toString())
  }, [startDate, endDate])

  return (
    <UIContext.Provider
      value={{
        activeTab,
        setActiveTab,
        isRateLimited,
        setIsRateLimited,
        startDate,
        setStartDate,
        endDate,
        setEndDate,
        setDateRange,
        summarizing,
        setSummarizing,
        currentSummaryId,
        setCurrentSummaryId,
        historySearchQuery,
        setHistorySearchQuery,
        starredOnly,
        setStarredOnly,
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
