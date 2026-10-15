/**
 * The Key and model a Failed Summary's retry runs on, and whether its saved
 * prompt fits that model (SFR-04).
 *
 * Nothing here reads or writes the Account's selected Key or a Key's
 * remembered model: a retry is one rescue, and changing the defaults for the
 * Action tab is not its business. The remembered model is only *read*, as a
 * starting point for a Key no Attempt has run on yet.
 */

type Run = { keyId: string | null; model: string }

/** The server's own estimate (`backend/app/prompts/posts.py`). */
const CHARS_PER_TOKEN = 4

export type PromptFit = "wont-fit" | "tight" | null

/**
 * "won't fit" past the window, "tight" past 80% of it, and nothing when the
 * window is unknown or there is no prompt. It advises; nothing blocks on it.
 */
export function promptFit(
  promptText: string | undefined,
  contextLength: number | null | undefined,
): PromptFit {
  if (!promptText || !contextLength) return null
  const tokens = Math.floor(promptText.length / CHARS_PER_TOKEN)
  if (tokens > contextLength) return "wont-fit"
  if (tokens > contextLength * 0.8) return "tight"
  return null
}

/** The model last run on this Key, else the one remembered for it. */
export function modelOnKey(
  attempts: readonly Run[],
  keyId: string,
  remembered: string | null,
): string | null {
  const onKey = attempts.filter((a) => a.keyId === keyId)
  return onKey.at(-1)?.model ?? remembered
}

/**
 * Where the chips start: the last Attempt's Key and model, or the selected
 * Key (and the model last run on it) when that Key is gone.
 */
export function retryStart(
  attempts: readonly Run[],
  liveKeyIds: readonly string[],
  selectedKeyId: string | null,
  summaryModel: string,
  remembered: (keyId: string) => string | null,
): { keyId: string | null; model: string } {
  const last = attempts.at(-1)
  if (last?.keyId && liveKeyIds.includes(last.keyId))
    return { keyId: last.keyId, model: last.model }
  const fallback = last?.model ?? summaryModel
  if (!selectedKeyId) return { keyId: null, model: fallback }
  return {
    keyId: selectedKeyId,
    model:
      modelOnKey(attempts, selectedKeyId, remembered(selectedKeyId)) ??
      fallback,
  }
}
