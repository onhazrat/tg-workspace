/**
 * Whether a failed translation was the provider refusing on quota.
 *
 * `TranslationContext` owns that case: it switches auto-translate off and says
 * so once. Everything else that sees the same failure — a post card that asked
 * for one translation — must stay quiet on exactly these errors, or the user
 * gets a second, vaguer toast for every card on screen. Both sides ask here so
 * they cannot disagree about which errors are whose.
 */
export function isTranslationQuotaError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase()
  return message.includes("quota") || message.includes("429")
}
