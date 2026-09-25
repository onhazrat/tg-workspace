import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { env } from "@/lib/env"
import {
  createTranslationQueue,
  sendTranslationBatch,
  type TranslationRequest,
} from "@/lib/translations/translation-batch"
import { translateTextBatch } from "../services/ai"
import { useSettings } from "./SettingsContext"

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

  // A queued batch is sent up to `translationDebounceMs` after it was queued,
  // so it reads the settings current at send time, not at queue time.
  const sendRef = useRef<(batch: TranslationRequest[]) => void>(() => {})
  sendRef.current = (batch) =>
    void sendTranslationBatch(batch, {
      enabled: translationEnabled,
      translate: (posts) =>
        translateTextBatch(posts, translationTargetLanguage, translationModel),
      onQuotaExceeded: () => setAutoTranslate(false),
      notifyError: (message) => toast.error(message),
    })

  const [queue] = useState(() =>
    createTranslationQueue((batch) => sendRef.current(batch), {
      maxChars: env.translationMaxBatchChars,
      debounceMs: env.translationDebounceMs,
    }),
  )

  const requestTranslation = useCallback(
    (id: string, text: string): Promise<string> => {
      if (!translationEnabled) return Promise.resolve(text)
      return new Promise((resolve, reject) =>
        queue.push({ id, text, resolve, reject }),
      )
    },
    [translationEnabled, queue],
  )

  useEffect(() => () => queue.cancel(), [queue])

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
