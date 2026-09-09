import { useEffect, useId, useRef } from "react"

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
 *
 * **It also repairs a stored id the provider does not offer**, which is the
 * half deleting `constants.MODELS` removed without replacing. `oneOfSetting`
 * used to fall back to the default whenever a persisted model was not in the
 * hardcoded list; with the list fetched instead, nothing did — so an account
 * whose only Key is an OpenRouter or Ollama credential started with the
 * deployment's Gemini id in the box and its first Summary went to an endpoint
 * that has never heard of it. The server answers `default` with a model the
 * resolved provider actually offers, and this adopts it once.
 */
export const ModelCombo: React.FC<{
  value: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
  placeholder?: string
}> = ({ value, onChange, className, ariaLabel, placeholder }) => {
  const listId = useId()
  const { models, fallback } = useAiModels()

  // Once per catalogue, never per keystroke. A plain "value is not in the
  // list" effect looks right and destroys the free-text half of this control:
  // every prefix of a model id somebody types is absent from the list, so the
  // first character typed would be overwritten by the fallback.
  //
  // `fallback` changes when a catalogue arrives and when the chosen Key
  // changes, and at no other time — so keying the repair on it fires exactly
  // when a new provider might not accept the stored id, and stays silent while
  // somebody is typing. An empty list means "this provider serves no
  // catalogue", where any id may be right and nothing should be rewritten.
  const repairedAgainst = useRef<string | null>(null)
  useEffect(() => {
    if (!fallback || models.length === 0) return
    if (repairedAgainst.current === fallback) return
    repairedAgainst.current = fallback
    if (!models.some((m) => m.id === value)) onChange(fallback)
  }, [fallback, models, value, onChange])

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
