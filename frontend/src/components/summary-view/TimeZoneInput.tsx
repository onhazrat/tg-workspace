import { useState } from "react"
import { TgInput } from "@/components/ui/tg-input"

// Every zone the browser knows, offered as suggestions; the server falls back
// to UTC for a name it cannot resolve.
const TIME_ZONES = Intl.supportedValuesOf?.("timeZone") ?? []

/** Whether the browser's `Intl` knows `zone`; empty is UTC, so it is known. */
function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", zone ? { timeZone: zone } : {})
    return true
  } catch {
    return false
  }
}

/**
 * Saved once left, never per keystroke: a half-typed zone saved on the way
 * would publish in UTC. A zone nobody knows puts the saved one back. Remount
 * it (`key`) when the saved zone changes elsewhere.
 */
export function TimeZoneInput(p: {
  id: string
  timeZone: string
  onTimeZone: (zone: string) => void
  className?: string
}) {
  const [draft, setDraft] = useState(p.timeZone)
  const commit = () => {
    const zone = draft.trim()
    if (zone === p.timeZone) return
    if (isKnownZone(zone)) p.onTimeZone(zone)
    else setDraft(p.timeZone)
  }
  return (
    <>
      <TgInput
        id={p.id}
        list={`${p.id}-options`}
        value={draft}
        placeholder="UTC"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={p.className}
      />
      <datalist id={`${p.id}-options`}>
        {TIME_ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </>
  )
}
