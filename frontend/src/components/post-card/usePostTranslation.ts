import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { needsTranslation } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"
import { useTranslation } from "@/contexts/TranslationContext"
import { getTranslation, saveTranslation } from "@/lib/translations/store"
import { isTranslationQuotaError } from "@/lib/translations/translation-errors"
import type { Post } from "@/types"
import { nextTranslateStep } from "./post-card-model"

/**
 * A post's translation: loaded from the cache when one exists, fetched on
 * demand (or at once, with auto-translate on), and toggled against the
 * original. `translatable` is false when the post is already in the target
 * language or translation is off.
 */
export function usePostTranslation(post: Post) {
  const { translationEnabled, autoTranslate, translationTargetLanguage } =
    useSettings()
  const { requestTranslation } = useTranslation()
  return usePostTranslationWith(post, {
    translationEnabled,
    autoTranslate,
    translationTargetLanguage,
    requestTranslation,
    getTranslation,
    saveTranslation,
  })
}

/**
 * Everything `usePostTranslation` reads from its providers and the store,
 * injected so the hook renders in a test without `mock.module` (process-wide
 * in bun, see `DataContext.test.tsx`).
 */
export interface PostTranslationDeps {
  translationEnabled: boolean
  autoTranslate: boolean
  translationTargetLanguage: string
  requestTranslation: (id: string, text: string) => Promise<string>
  getTranslation: typeof getTranslation
  saveTranslation: typeof saveTranslation
}

export function usePostTranslationWith(post: Post, deps: PostTranslationDeps) {
  const {
    translationEnabled,
    autoTranslate,
    translationTargetLanguage,
    requestTranslation,
    getTranslation,
    saveTranslation,
  } = deps

  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showing, setShowing] = useState(false)

  const translatable =
    translationEnabled &&
    needsTranslation(post.language, translationTargetLanguage)

  const toggle = useCallback(async () => {
    const step = nextTranslateStep({
      translating: busy,
      translated: Boolean(translatedText),
      showing,
    })
    if (step === "ignore") return
    if (step !== "fetch") {
      setShowing(step === "show")
      return
    }
    setBusy(true)
    try {
      const result = await requestTranslation(
        `${post.channelName}_${post.id}`,
        post.text,
      )
      setTranslatedText(result)
      setShowing(true)
      await saveTranslation({
        id: `${post.channelName}_${post.id}_${translationTargetLanguage}`,
        channelName: post.channelName,
        postId: post.id,
        language: translationTargetLanguage,
        translatedText: result,
        timestamp: Date.now(),
      })
    } catch (error: unknown) {
      console.error("Translation failed:", error)
      // TranslationContext already toasted a quota refusal and switched
      // auto-translate off; say something only for anything else.
      if (!isTranslationQuotaError(error))
        toast.error("Failed to translate post")
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    translatedText,
    showing,
    requestTranslation,
    saveTranslation,
    post.channelName,
    post.id,
    post.text,
    translationTargetLanguage,
  ])

  useEffect(() => {
    if (!translatable) return
    void getTranslation(
      post.channelName,
      post.id,
      translationTargetLanguage,
    ).then((existing) => {
      if (existing) {
        setTranslatedText(existing.translatedText)
        if (autoTranslate) setShowing(true)
      } else if (autoTranslate) {
        toggle()
      }
    })
  }, [
    post.channelName,
    post.id,
    translatable,
    autoTranslate,
    translationTargetLanguage,
    getTranslation,
    toggle,
  ])

  return {
    translatable,
    busy,
    showing: showing && Boolean(translatedText),
    text: showing && translatedText ? translatedText : post.text,
    toggle,
  }
}
