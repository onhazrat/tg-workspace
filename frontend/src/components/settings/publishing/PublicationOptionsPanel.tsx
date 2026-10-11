import { Settings2 } from "lucide-react"
import type React from "react"
import { useState } from "react"
import {
  TgFieldLabel,
  TgHelpText,
  TgInput,
  tgFieldClassName,
} from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { CITATION_STYLES, type CitationStyle } from "@/lib/settings/schema"

const CITATION_LABELS: Record<CitationStyle, string> = {
  asWritten: "As written",
  channelName: "By Channel name",
  numbered: "Numbered",
}

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
 * would publish in UTC. A zone nobody knows puts the saved one back.
 */
function TimeZoneInput(p: {
  timeZone: string
  onTimeZone: (zone: string) => void
}) {
  const [draft, setDraft] = useState(p.timeZone)
  const commit = () => {
    const zone = draft.trim()
    if (zone === p.timeZone) return
    if (isKnownZone(zone)) p.onTimeZone(zone)
    else setDraft(p.timeZone)
  }
  return (
    <TgInput
      id="publishing-time-zone"
      list="publishing-time-zones"
      value={draft}
      placeholder="UTC"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  )
}

type PublicationOptionsPanelProps = {
  citationStyle: CitationStyle
  linkPreviews: boolean
  timeZone: string
  onCitationStyle: (style: CitationStyle) => void
  onLinkPreviews: (on: boolean) => void
  onTimeZone: (zone: string) => void
}

/** The Account's Publishing settings (SUMTAB-08); every send applies them. */
export const PublicationOptionsPanel: React.FC<
  PublicationOptionsPanelProps
> = ({
  citationStyle,
  linkPreviews,
  timeZone,
  onCitationStyle,
  onLinkPreviews,
  onTimeZone,
}) => (
  <TgSettingsSection icon={Settings2} title="Publication Options">
    <div className="space-y-6">
      <div>
        <TgFieldLabel htmlFor="publishing-citation-style">
          Citation style
        </TgFieldLabel>
        <select
          id="publishing-citation-style"
          value={citationStyle}
          onChange={(e) => onCitationStyle(e.target.value as CitationStyle)}
          className={tgFieldClassName}
        >
          {CITATION_STYLES.map((style) => (
            <option key={style} value={style}>
              {CITATION_LABELS[style]}
            </option>
          ))}
        </select>
        <TgHelpText className="mt-1.5">
          How Citations read in a Publication. Numbered ones share one numbering
          across the metadata and the Summary.
        </TgHelpText>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest opacity-60">
            Link previews
          </span>
          <TgHelpText className="mt-1">
            Show a preview card under each message. Off by default.
          </TgHelpText>
        </div>
        <TgToggle
          aria-label="Link previews"
          checked={linkPreviews}
          onClick={() => onLinkPreviews(!linkPreviews)}
        />
      </div>

      <div>
        <TgFieldLabel htmlFor="publishing-time-zone">Time zone</TgFieldLabel>
        <TimeZoneInput
          key={timeZone}
          timeZone={timeZone}
          onTimeZone={onTimeZone}
        />
        <datalist id="publishing-time-zones">
          {TIME_ZONES.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <TgHelpText className="mt-1.5">
          The metadata's time range is written in this zone. Taken from your
          browser the first time.
        </TgHelpText>
      </div>
    </div>
  </TgSettingsSection>
)
