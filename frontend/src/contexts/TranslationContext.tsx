import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react"
import { toast } from "sonner"
import { env } from "@/lib/env"
import { translateTextBatch } from "../services/ai"
import { useSettings } from "./SettingsContext"

interface TranslationRequest {
  id: string
  text: string
  resolve: (translation: string) => void
  reject: (error: Error) => void
}

interface TranslationContextType {
  requestTranslation: (id: string, text: string) => Promise<string>
}

const TranslationContext = createContext<TranslationContextType | undefined>(
  undefined,
)

export const TranslationProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const {
    translationEnabled,
    translationModel,
    translationTargetLanguage,
    setAutoTranslate,
  } = useSettings()

  const queueRef = useRef<TranslationRequest[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const processQueue = useCallback(async () => {
    if (queueRef.current.length === 0) return

    // Take a snapshot of the current queue and clear it
    const batch = [...queueRef.current]
    queueRef.current = []

    if (!translationEnabled) {
      // If translation is disabled, just resolve with original text
      batch.forEach((req) => req.resolve(req.text))
      return
    }

    try {
      const postsToTranslate = batch.map((req) => ({
        id: req.id,
        text: req.text,
      }))
      const results = await translateTextBatch(
        postsToTranslate,
        translationTargetLanguage,
        translationModel,
      )

      // Map results back to promises
      const resultMap = new Map(results.map((r) => [r.id, r.translation]))

      batch.forEach((req) => {
        const translation = resultMap.get(req.id)
        if (translation) {
          req.resolve(translation)
        } else {
          req.reject(new Error("Translation missing from batch response"))
        }
      })
    } catch (error: any) {
      console.error("[TranslationProvider] Batch translation failed:", error)

      const errorMsg = error instanceof Error ? error.message : String(error)
      if (
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("429")
      ) {
        setAutoTranslate(false)
        toast.error(
          "Translation failed: API Quota Exceeded. Auto-translate disabled.",
        )
      } else {
        toast.error("Batch translation failed.")
      }

      // Reject all pending promises in this batch
      batch.forEach((req) =>
        req.reject(error instanceof Error ? error : new Error(errorMsg)),
      )
    }
  }, [
    translationEnabled,
    translationTargetLanguage,
    translationModel,
    setAutoTranslate,
  ])

  const requestTranslation = useCallback(
    (id: string, text: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        if (!translationEnabled) {
          resolve(text)
          return
        }

        queueRef.current.push({ id, text, resolve, reject })

        const currentChars = queueRef.current.reduce(
          (acc, req) => acc + req.text.length,
          0,
        )

        if (currentChars >= env.translationMaxBatchChars) {
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
          processQueue()
        } else {
          if (timerRef.current) {
            clearTimeout(timerRef.current)
          }
          timerRef.current = setTimeout(() => {
            processQueue()
          }, env.translationDebounceMs)
        }
      })
    },
    [translationEnabled, processQueue],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  return (
    <TranslationContext.Provider value={{ requestTranslation }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(TranslationContext)
  if (context === undefined) {
    throw new Error("useTranslation must be used within a TranslationProvider")
  }
  return context
}
