import { countOf } from "@/lib/plural"

/**
 * Explains the gap between "channels selected" and "channels in the preview".
 *
 * The Tag tab showed `43 selected channel(s)` above a table headed
 * `PREVIEW (50 channels)`. The two numbers count different sets — the current
 * selection, versus the channels the generated suggestions actually cover — so
 * they legitimately diverge once the selection changes after a run. Displayed
 * bare and unlabelled, that reads as a bug in the app.
 *
 * Returns `null` when the two agree and no explanation is warranted.
 */
export function tagPreviewScopeNote(
  previewCount: number,
  selectedCount: number,
): string | null {
  if (previewCount === 0) return null
  if (previewCount === selectedCount) return null

  const suggestions = `Suggestions cover ${countOf(previewCount, "channel")}`
  const selection = `${countOf(selectedCount, "channel")} currently selected`
  return `${suggestions}; ${selection}.`
}
