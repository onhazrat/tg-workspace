/**
 * The one place the Analysis window is edited (AW-04).
 *
 * Posts used to carry a permanently expanded pair of `datetime-local` inputs
 * beside a row of quick ranges, which cost the page a block of height whether
 * or not anybody was changing the window, and said nothing about whether that
 * window moves. This replaces both with a summary somebody can read at a glance
 * and one editor behind it.
 *
 * Every rule it applies belongs to `ScopeContext` and `lib/scope/window.ts`.
 * What is here is presentation and disclosure: an anchored popover on desktop,
 * a bottom sheet on mobile, one field set shared by the two. No other surface
 * may grow a second editor — that is the rule the ticket exists to make true,
 * and a rendered summary is what they get instead.
 */

import { Clock } from "lucide-react"
import { Popover } from "radix-ui"
import type React from "react"
import { useId, useState } from "react"

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { TgFilterChip } from "@/components/ui/tg-chips"
import { TgInput } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { useScope } from "@/contexts/ScopeContext"
import { useIsMobile } from "@/hooks/useMobile"
import {
  ELAPSED_PRESETS,
  parseElapsed,
  SCOPE_FIELDS,
  type ScopeField,
} from "@/lib/scope/window"

/** The four fields, in the order they are read: boundaries, then the spans. */
const FIELDS: { field: ScopeField; label: string }[] = [
  { field: "start", label: "Start" },
  { field: "end", label: "End" },
  { field: "duration", label: "Duration" },
  { field: "endGap", label: "End gap" },
]

/** Duration and End gap are elapsed time in both modes; the boundaries are not. */
const ELAPSED_FIELDS: ScopeField[] = ["duration", "endGap"]

interface WindowFieldProps {
  field: ScopeField
  label: string
  /** `null` unless an elapsed field has focus, in which case the row is its. */
  onElapsedFocus: (field: ScopeField | null) => void
}

const WindowField: React.FC<WindowFieldProps> = ({
  field,
  label,
  onElapsedFocus,
}) => {
  const { mode, draftText, setDraft, commitDraft, errors } = useScope()
  const id = useId()
  const errorId = `${id}-error`
  const error = errors[field]
  const isElapsed = ELAPSED_FIELDS.includes(field)

  // A Fixed boundary is an instant, so it gets the platform's own date-time
  // control rather than a parser and a format to learn. Everything else is
  // elapsed time, where `datetime-local` would be the wrong question entirely.
  const asInstant = !isElapsed && mode === "fixed"

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[10px] uppercase font-bold text-app-ink/60 tracking-widest"
      >
        {label}
      </label>
      <TgInput
        id={id}
        type={asInstant ? "datetime-local" : "text"}
        value={draftText(field)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder={asInstant ? undefined : "1d 6h"}
        onChange={(event) => setDraft(field, event.target.value)}
        onFocus={() => onElapsedFocus(isElapsed ? field : null)}
        onBlur={() => {
          commitDraft(field)
          // And the row goes with the focus. Clicking the mode switch blurs
          // this input without focusing another, and a row left armed behind it
          // would apply to a field nothing on screen still points at — the
          // exact ambiguity the row is rendered conditionally to avoid. A move
          // to another field fires this before that field's `onFocus`, so the
          // row simply changes hands.
          onElapsedFocus(null)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commitDraft(field)
          }
        }}
        className="rounded-lg py-2 px-3 normal-case"
      />
      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-[11px] text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The four fields, the mode switch and the shortcut row.
 *
 * Shared verbatim between the popover and the sheet, because two copies of a
 * four-field form is two places for the propagation rules to be wired up
 * differently.
 */
const WindowEditor: React.FC = () => {
  const { mode, setMode, applyValue } = useScope()
  const [elapsedFocus, setElapsedFocus] = useState<ScopeField | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <TgSegmentedControl
        size="sm"
        aria-label="Analysis window mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "live", label: "Live" },
          { value: "fixed", label: "Fixed" },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map(({ field, label }) => (
          <WindowField
            key={field}
            field={field}
            label={label}
            onElapsedFocus={setElapsedFocus}
          />
        ))}
      </div>

      {/*
       * One row, two fields, and it belongs to whichever has focus. Rendered
       * only while one does, because a row of durations floating under four
       * fields cannot say which of them it would change.
       */}
      {elapsedFocus && (
        <fieldset
          className="flex flex-wrap gap-1.5 border-t border-app-ink/5 pt-3"
          aria-label={`Shortcuts for ${elapsedFocus === "duration" ? "Duration" : "End gap"}`}
        >
          {ELAPSED_PRESETS.map((preset) => (
            <TgFilterChip
              key={preset}
              // The press must not take focus off the field, or the field the
              // shortcut applies to is gone before the click resolves — and a
              // blur would commit a half-typed draft on the way out.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const ms = parseElapsed(preset)
                if (ms !== null) applyValue(elapsedFocus, ms)
              }}
            >
              {preset}
            </TgFilterChip>
          ))}
        </fieldset>
      )}
    </div>
  )
}

/** The persistent trigger: mode, both boundaries and Duration, in one line. */
export const AnalysisWindowControl: React.FC = () => {
  const { summary, commitDraft, discardDrafts } = useScope()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  const onOpenChange = (next: boolean) => {
    if (!next) {
      /*
       * Closing is a blur that the field never gets to see.
       *
       * An outside click dismisses on `pointerdown`, which runs before the
       * focused input's `blur` — so a value typed and clicked away from inside
       * the debounce window would simply vanish. Committing first gives a valid
       * draft the same answer blur would have; `discardDrafts` then clears what
       * is left, which is exactly the incomplete and invalid ones the spec says
       * to throw away.
       */
      for (const field of SCOPE_FIELDS) commitDraft(field)
      discardDrafts()
    }
    setOpen(next)
  }

  // `aria-haspopup` / `aria-expanded` and the focus return are the trigger
  // primitive's, in both branches. Setting them by hand would be a second
  // answer to a question Radix already answers from the same `open`.
  const trigger = (
    <button
      type="button"
      aria-label="Analysis window"
      className="flex w-full items-center gap-2.5 rounded-xl border border-app-ink/10 bg-app-muted/50 px-3.5 py-2.5 text-left transition-colors hover:border-app-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"
    >
      <Clock size={13} className="shrink-0 text-app-ink/60" />
      <span className="text-[11px] font-mono text-app-ink/90">{summary}</span>
    </button>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        {/* A dialog, so focus is contained and Escape returns it to the
            trigger — both of which a bare anchored overlay would have to
            reimplement on a viewport where it does not fit anyway. */}
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetTitle className="px-4 pt-4 text-xs uppercase tracking-widest">
            Analysis window
          </SheetTitle>
          <div className="px-4 pb-6">
            <WindowEditor />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          aria-label="Analysis window"
          className="z-50 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-xl"
        >
          <WindowEditor />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
