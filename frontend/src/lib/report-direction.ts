import { isRTLLanguage } from "@/lib/utils"

/**
 * Text direction for a rendered report.
 *
 * Two rules, both learned from bugs:
 *
 * 1. **Direction belongs to the AI-generated body, not the card.** The whole
 *    report card used to carry `dir`, so when the language was Persian the
 *    English chrome inherited RTL and rendered with its trailing period on the
 *    left (`.Message may exceed Telegram single-message limit`). Chrome is
 *    always LTR; only generated content follows the report's language.
 *
 * 2. **The language comes from the report, not from global settings.** Reading it
 *    from the global `aiLanguage` meant opening a saved report had to *overwrite*
 *    that setting to render correctly — a silent mutation of the user's
 *    "language for the next generation". Deriving it from the record removes the
 *    reason for that write.
 */

export interface ReportDirection {
  /** `dir` for the generated body. */
  dir: "rtl" | "ltr"
  isRTL: boolean
  /** Alignment + typeface classes for the body. */
  className: string
}

export function reportDirection(
  /** The loaded report's own language, when a report is loaded. */
  reportLanguage: string | null | undefined,
  /** The language the *next* generation would use — used before one exists. */
  fallbackLanguage: string,
): ReportDirection {
  const language = reportLanguage || fallbackLanguage
  const isRTL = isRTLLanguage(language)

  const typeface =
    language === "Persian"
      ? "font-persian leading-loose"
      : isRTL
        ? "font-serif leading-loose"
        : ""

  return {
    dir: isRTL ? "rtl" : "ltr",
    isRTL,
    className: [isRTL ? "text-right" : "", typeface].filter(Boolean).join(" "),
  }
}
