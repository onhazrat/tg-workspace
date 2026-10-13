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

import { ArrowLeft, Clock, ZoomIn, ZoomOut } from "lucide-react"
import { Popover } from "radix-ui"
import type React from "react"
import { createContext, useContext, useEffect, useId, useState } from "react"

import { BarHistogram } from "@/components/filter-tree/BarHistogram"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { TgButton } from "@/components/ui/tg-button"
import { TgFilterChip } from "@/components/ui/tg-chips"
import { TgInput } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { useScope } from "@/contexts/ScopeContext"
import { useUI } from "@/contexts/UIContext"
import { useIsMobile } from "@/hooks/useMobile"
import type { WindowHistogramQuery } from "@/lib/analysis-window"
import { MINUTE_MS } from "@/lib/analysis-window"
import { formatCount } from "@/lib/format-count"
import {
  ELAPSED_PRESETS,
  formatLocalStamp,
  parseElapsed,
  SCOPE_FIELDS,
  type ScopeField,
} from "@/lib/scope/window"

// ---- The chart (PTI-03) ------------------------------------------------------

/**
 * A hook answering a query's counts, `undefined` while they load. Context
 * rather than a prop so the control renders, and tests, without the
 * providers the read needs: with none, the editor draws no chart.
 */
export type WindowHistogramRead = (
  query: WindowHistogramQuery,
) => number[] | undefined

export const WindowHistogramContext = createContext<WindowHistogramRead | null>(
  null,
)

const BUCKETS = 60

/**
 * Three times the window, times three again per zoom step, centred on the
 * window and slid back so it never reaches past now.
 */
function chartExtent(start: number, end: number, now: number, zoom: number) {
  const span = Math.max(end - start, MINUTE_MS) * 3 * 3 ** zoom
  const extentEnd = Math.min(Math.floor((start + end) / 2 + span / 2), now)
  return { extentStart: extentEnd - span, extentEnd }
}

/**
 * The Posts around the window, its own buckets solid; a drag or a click sets
 * a Fixed window over the buckets it covered. The zoom and the toggle are
 * this editor's, so each opening starts at Filtered and the default.
 */
const WindowChart: React.FC<{ read: WindowHistogramRead }> = ({ read }) => {
  const { startDate, endDate, minuteNow, setFixedRange } = useScope()
  const [zoom, setZoom] = useState(0)
  const [unfiltered, setUnfiltered] = useState(false)
  const { extentStart, extentEnd } = chartExtent(
    startDate,
    endDate,
    minuteNow,
    zoom,
  )
  const counts = read({ extentStart, extentEnd, buckets: BUCKETS, unfiltered })
  const width = (extentEnd - extentStart) / BUCKETS
  const from = (i: number) => extentStart + i * width

  return (
    <div className="space-y-2 border-t border-app-ink/5 pt-3">
      <div className="flex items-center gap-1.5">
        <TgSegmentedControl
          size="sm"
          aria-label="Posts counted"
          value={unfiltered ? "all" : "filtered"}
          onChange={(next) => setUnfiltered(next === "all")}
          options={[
            { value: "filtered", label: "Filtered" },
            { value: "all", label: "All posts" },
          ]}
        />
        <span className="flex-1" />
        <TgButton
          size="sm"
          variant="secondary"
          aria-label="Zoom in"
          disabled={zoom === 0}
          onClick={() => setZoom(zoom - 1)}
        >
          <ZoomIn size={13} />
        </TgButton>
        <TgButton
          size="sm"
          variant="secondary"
          aria-label="Zoom out"
          onClick={() => setZoom(zoom + 1)}
        >
          <ZoomOut size={13} />
        </TgButton>
      </div>
      {counts ? (
        <BarHistogram
          testId="window"
          bins={counts}
          solid={(i) => from(i) < endDate && from(i + 1) > startDate}
          onSelect={(run) =>
            setFixedRange(
              from(Math.min(run.from, run.to)),
              from(Math.max(run.from, run.to) + 1),
            )
          }
          caption={(shown) => [
            formatLocalStamp(extentStart),
            shown === null
              ? `${formatCount(counts.reduce((a, n) => a + n, 0))} posts`
              : `${formatCount(counts[shown])} posts from ${formatLocalStamp(from(shown))}`,
            formatLocalStamp(extentEnd),
          ]}
        />
      ) : (
        <p className="h-16 text-[11px] text-app-ink/50">Counting…</p>
      )}
    </div>
  )
}

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
  const { draftText, setDraft, commitDraft, errors } = useScope()
  const id = useId()
  const errorId = `${id}-error`
  const error = errors[field]
  const isElapsed = ELAPSED_FIELDS.includes(field)

  // A boundary is an instant in either mode, so it gets the platform's own
  // date-time control rather than a parser and a format to learn. Everything
  // else is elapsed time, where `datetime-local` would be the wrong question
  // entirely.
  const asInstant = !isElapsed

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
const WindowEditor: React.FC<{ onReturn?: () => void }> = ({ onReturn }) => {
  const { mode, setMode, applyValue } = useScope()
  const [elapsedFocus, setElapsedFocus] = useState<ScopeField | null>(null)
  const read = useContext(WindowHistogramContext)

  return (
    <div className="flex flex-col gap-4">
      {/*
       * The way back, shown only to somebody who was sent here (AW-09).
       *
       * Action hands editing off to this editor rather than growing its own, so
       * the window is checked one tab away from the half-written Action it
       * belongs to. The nav still has an Action tab, but it is behind whichever
       * overlay this is — a sheet covers it outright on a phone. One button
       * where the eye already is costs less than the trip.
       */}
      {onReturn && (
        <TgButton
          size="sm"
          variant="secondary"
          data-testid="window-editor-return"
          className="self-start"
          onClick={onReturn}
        >
          <ArrowLeft size={13} />
          Back to Action
        </TgButton>
      )}

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

      {read && <WindowChart read={read} />}
    </div>
  )
}

/** The collapsed line both surfaces draw: a clock, then the whole window. */
const TRIGGER_CLASS =
  "flex w-full items-center gap-2.5 rounded-xl border border-app-ink/10 bg-app-muted/50 px-3.5 py-2.5 text-left transition-colors hover:border-app-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"

const TriggerFace: React.FC<{ summary: string }> = ({ summary }) => (
  <>
    <Clock size={13} className="shrink-0 text-app-ink/60" />
    <span className="text-[11px] font-mono text-app-ink/90">{summary}</span>
  </>
)

/**
 * The window on a surface that does not edit it (AW-09).
 *
 * Actions is where every Artifact begins, so it has to say what window the
 * thing it is about to make will use. It says it with the *same* line Posts
 * draws and then sends you to the one editor, because a second editor is how
 * two surfaces start disagreeing about what Live means.
 */
export const AnalysisWindowLink: React.FC = () => {
  const { summary, requestEditor } = useScope()
  const { setActiveTab } = useUI()

  return (
    <button
      type="button"
      aria-label="Analysis window"
      data-testid="action-analysis-window"
      className={TRIGGER_CLASS}
      onClick={() => {
        setActiveTab("posts")
        requestEditor()
      }}
    >
      <TriggerFace summary={summary} />
    </button>
  )
}

/** The persistent trigger: mode, both boundaries and Duration, in one line. */
export const AnalysisWindowControl: React.FC<{
  /** Where "Back to Action" goes. Omitted, the button is not rendered. */
  onReturnToAction?: () => void
}> = ({ onReturnToAction }) => {
  const {
    summary,
    commitDraft,
    discardDrafts,
    editorRequested,
    clearEditorRequest,
  } = useScope()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  /** Whether this opening came from Action, which is what earns the way back. */
  const [sentHere, setSentHere] = useState(false)

  /*
   * Somebody on another tab asked for this editor, and the request outlived the
   * navigation that carried it. Consume it, or every later arrival on Posts
   * would find the popover opening by itself.
   */
  useEffect(() => {
    if (!editorRequested) return
    clearEditorRequest()
    setSentHere(true)
    setOpen(true)
  }, [editorRequested, clearEditorRequest])

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
      setSentHere(false)
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
      className={TRIGGER_CLASS}
    >
      <TriggerFace summary={summary} />
    </button>
  )

  /*
   * Leaving by the button is still leaving, so it goes out through the same
   * door. `AnimatePresence` unmounts this on the tab change without Radix ever
   * seeing a close, so a draft left invalid — `abc` in Duration, with its
   * error — would be sitting there on the next visit, which no other way of
   * closing the editor leaves behind.
   */
  const editorReturn =
    sentHere && onReturnToAction
      ? () => {
          onOpenChange(false)
          onReturnToAction()
        }
      : undefined

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
            <WindowEditor onReturn={editorReturn} />
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
          <WindowEditor onReturn={editorReturn} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
