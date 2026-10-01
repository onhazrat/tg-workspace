import { TgButton } from "@/components/ui/tg-button"
import {
  completeTag,
  type TagSuggestion,
} from "@/lib/channels/bulk-tag-suggestions"

const channelCount = (n: number) => `${n} channel${n === 1 ? "" : "s"}`

/**
 * A bulk tag field that completes an existing tag in ghost text (CTB-05), so a
 * typo reaches the tag it meant instead of creating a near-duplicate. Tab, or
 * → with the caret at the end, accepts the completion; Enter submits what was
 * typed, so a new tag is never in the way.
 */
export function TagCompletionField({
  label,
  button,
  value,
  onChange,
  onSubmit,
  suggestions,
  testId,
}: {
  label: string
  button: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Best first. */
  suggestions: TagSuggestion[]
  testId: string
}) {
  const match = completeTag(suggestions, value)
  const rest = match ? match.tag.slice(value.length) : ""
  const hint = match
    ? `${match.tag} · on ${channelCount(match.total)}, ${match.inTargets} of these`
    : value.trim()
      ? "no existing tag starts like this"
      : ""
  return (
    <form
      className="px-1 pb-1"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              const atEnd = e.currentTarget.selectionStart === value.length
              if (
                rest &&
                (e.key === "Tab" || (e.key === "ArrowRight" && atEnd))
              ) {
                e.preventDefault()
                onChange(match?.tag ?? value)
              }
            }}
            placeholder="Tag"
            aria-label={label}
            autoComplete="off"
            spellCheck={false}
            data-testid={`${testId}-input`}
            className="h-8 w-full rounded-lg border border-app-ink/15 bg-app-muted px-2.5 text-xs outline-none focus:border-app-ink/40"
          />
          {rest && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre border border-transparent px-2.5 text-xs"
            >
              <span className="invisible">{value}</span>
              <span data-testid={`${testId}-ghost`} className="text-app-ink/35">
                {rest}
              </span>
            </div>
          )}
        </div>
        <TgButton
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!value.trim()}
          data-testid={`${testId}-button`}
        >
          {button}
        </TgButton>
      </div>
      <div
        data-testid={`${testId}-hint`}
        className="h-4 truncate px-0.5 pt-0.5 text-[10px] text-app-ink/50"
      >
        {hint}
      </div>
    </form>
  )
}
