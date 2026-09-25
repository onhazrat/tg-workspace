/**
 * Batching for post translations, with its I/O injected.
 *
 * Each post card asks for its own translation. Sending those one at a time
 * would be a request per card, so `TranslationProvider` queues them and sends
 * one batch: after a quiet spell, or at once when the queued text reaches the
 * batch-size cap. This module holds both decisions, when to send and how a
 * batch response settles each waiting card, so a test can pin them without
 * mounting the provider or reaching the network.
 */

import { isTranslationQuotaError } from "@/lib/translations/translation-errors"

export interface TranslationRequest {
  id: string
  text: string
  resolve: (translation: string) => void
  reject: (error: Error) => void
}

export interface TranslationQueueLimits {
  /** Send at once when the queued text reaches this many characters. */
  maxChars: number
  /** Otherwise send this long after the last request. */
  debounceMs: number
}

/**
 * A queue that hands `send` a batch after `debounceMs` of quiet, or at once
 * when the queued text reaches `maxChars`. `cancel` drops the pending timer.
 */
export function createTranslationQueue(
  send: (batch: TranslationRequest[]) => void,
  limits: TranslationQueueLimits,
) {
  let pending: TranslationRequest[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    const batch = pending
    pending = []
    send(batch)
  }

  return {
    push(request: TranslationRequest) {
      pending.push(request)
      clearTimeout(timer)
      const chars = pending.reduce((sum, queued) => sum + queued.text.length, 0)
      if (chars >= limits.maxChars) flush()
      else timer = setTimeout(flush, limits.debounceMs)
    },
    cancel() {
      clearTimeout(timer)
    },
  }
}

export interface SendTranslationBatchIO {
  enabled: boolean
  translate: (
    posts: { id: string; text: string }[],
  ) => Promise<{ id: string; translation: string }[]>
  /** The provider refused on quota; the caller turns auto-translate off. */
  onQuotaExceeded: () => void
  notifyError: (message: string) => void
}

export const QUOTA_EXCEEDED_MESSAGE =
  "Translation failed: API Quota Exceeded. Auto-translate disabled."
export const BATCH_FAILED_MESSAGE = "Batch translation failed."

/**
 * Translate one batch and settle every request in it. With translation off,
 * each request gets its own text back. A request the response leaves out, or
 * answers with an empty string, is rejected rather than left waiting forever.
 */
export async function sendTranslationBatch(
  batch: TranslationRequest[],
  io: SendTranslationBatchIO,
): Promise<void> {
  if (!io.enabled) {
    for (const request of batch) request.resolve(request.text)
    return
  }
  try {
    const results = await io.translate(
      batch.map(({ id, text }) => ({ id, text })),
    )
    const byId = new Map(results.map((r) => [r.id, r.translation]))
    for (const request of batch) {
      const translation = byId.get(request.id)
      if (translation) request.resolve(translation)
      else request.reject(new Error("Translation missing from batch response"))
    }
  } catch (error) {
    console.error("[TranslationProvider] Batch translation failed:", error)
    if (isTranslationQuotaError(error)) {
      io.onQuotaExceeded()
      io.notifyError(QUOTA_EXCEEDED_MESSAGE)
    } else {
      io.notifyError(BATCH_FAILED_MESSAGE)
    }
    const reason = error instanceof Error ? error : new Error(String(error))
    for (const request of batch) request.reject(reason)
  }
}
