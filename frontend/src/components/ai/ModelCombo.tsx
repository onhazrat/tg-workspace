import { useId } from "react"

import { useAiModels } from "@/hooks/useAiModels"

/**
 * Pick a model from what the provider offers, or type one (BYOK-02).
 *
 * A native `<input list>` with a `<datalist>`, which is both halves of the
 * ticket in one control the platform already ships: it drops down the fetched
 * ids and it accepts anything typed. The `<select>`s this replaced could only
 * do the first, which was fine against three hardcoded Gemini ids and is wrong
 * against an endpoint whose catalogue the deployment cannot know — and a
 * combobox library for this would be fifty kilobytes to reimplement a
 * fifteen-year-old input.
 *
 * The list being empty is a supported state, not a broken one: a provider with
 * no `/models` route, or an account with no Key yet. The input still works,
 * which is the fallback the ticket asks for.
 */
export const ModelCombo: React.FC<{
  value: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
  placeholder?: string
}> = ({ value, onChange, className, ariaLabel, placeholder }) => {
  const listId = useId()
  const { models } = useAiModels()

  return (
    <>
      <input
        type="text"
        list={listId}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder ?? "MODEL ID"}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        autoComplete="off"
        spellCheck={false}
      />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m.id} value={m.id} label={m.label} />
        ))}
      </datalist>
    </>
  )
}
