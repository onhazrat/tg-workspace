import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"

import {
  type CompletenessMark,
  dataWindowCheck,
  type FrozenScope,
} from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { usePostsViewEdits } from "@/contexts/PostsViewContext"
import { queryKeys } from "@/hooks/queryKeys"
import {
  type ArtifactKind,
  isRecord,
  nowPhrase,
  offersRegenerate,
  pillPhrase,
  recordCheck,
  regenerateAction,
} from "@/lib/complete-window/record"
import {
  incompleteOf,
  REASON_ORDER,
  type WindowCheck,
} from "@/lib/complete-window/window-check"
import { useRunGated } from "./Gate"
import { HoverPopover } from "./HoverPopover"
import { WindowBanner } from "./WindowBanner"
import { GAP, gapStyle, ReasonChip, TONE, TRACK } from "./WindowDetails"

/**
 * The Artifact's Channels and window, checked again at this moment. Its
 * window ended at the action, so its End is past and the key never moves.
 */
function useCheckNow(names: string[], start: number, end: number) {
  const window = { mode: "fixed" as const, start, end }
  return useQuery({
    queryKey: queryKeys.windowCheck(names, window, 0),
    queryFn: () =>
      dataWindowCheck({
        body: { channelNames: names, window },
      }),
    enabled: names.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

/**
 * "· now 2 holes" (or "complete now") and Regenerate, which restores the
 * Scope, opens the Action tab and runs the same action through the gate. A
 * new Artifact, not a successor.
 */
function NowAndRegenerate({
  scope,
  kind,
  check,
}: {
  scope: FrozenScope
  kind: ArtifactKind
  check: WindowCheck
}) {
  const { data } = useCheckNow(scope.channels ?? [], check.start, check.end)
  if (!data)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] opacity-70">
        <Loader2 size={11} className="animate-spin" /> checking now
      </span>
    )
  const now = incompleteOf(data)
  return (
    <>
      <span
        data-testid="window-now"
        className={`text-[12px] ${now.length === 0 ? "font-bold text-green-700 dark:text-green-300" : ""}`}
      >
        <span className="hidden sm:inline">· </span>
        {nowPhrase(now)}
      </span>
      {offersRegenerate(kind, now) && (
        <Regenerate scope={scope} kind={kind} complete={now.length === 0} />
      )}
    </>
  )
}

function Regenerate({
  scope,
  kind,
  complete,
}: {
  scope: FrozenScope
  kind: ArtifactKind
  complete: boolean
}) {
  const { restore } = usePostsViewEdits()
  const runGated = useRunGated()
  const action = regenerateAction(kind)
  const regenerate = () => {
    if (!action) return
    restore(scope)
    runGated(action)
  }
  return (
    <TgButton
      type="button"
      size="sm"
      variant={complete ? "primary" : "secondary"}
      onClick={regenerate}
    >
      <RefreshCw size={12} />
      Regenerate
    </TgButton>
  )
}

/** What "complete only" left out to keep the window Complete. */
function LeftOut({ names }: { names: string[] }) {
  return (
    <p
      data-testid="window-left-out"
      className="mb-3 text-[12px] text-app-ink/60"
      title={names.map((n) => `@${n}`).join("\n")}
    >
      Complete window, with {names.length} Incomplete{" "}
      {names.length === 1 ? "Channel" : "Channels"} left out (
      {names
        .slice(0, 3)
        .map((n) => `@${n}`)
        .join(", ")}
      {names.length > 3 && ` +${names.length - 3}`}).
    </p>
  )
}

/** "Window not checked", quietly: made before the record existed. */
const NotChecked = ({ className = "" }: { className?: string }) => (
  <span className={`text-[11px] text-app-ink/40 ${className}`}>
    Window not checked
  </span>
)

/**
 * An Artifact's window as it froze (ADR-043): the one-line banner, with "now"
 * and Regenerate when it was Incomplete, its Left out Channels when "complete
 * only" made it Complete, or "not checked" for one made before the record.
 */
export function ArtifactWindowBanner({
  scope,
  kind,
}: {
  scope: FrozenScope | null | undefined
  kind: ArtifactKind
}) {
  if (!scope) return null
  const record = scope.completeness
  if (!record) return <NotChecked className="mb-3 block" />
  if (!isRecord(record)) return null
  const check = recordCheck(record)
  const complete = incompleteOf(check).length === 0
  if (complete && record.leftOut.length)
    return <LeftOut names={record.leftOut} />
  return (
    <div className="mb-3">
      <WindowBanner
        check={check}
        action={
          complete ? undefined : (
            <NowAndRegenerate scope={scope} kind={kind} check={check} />
          )
        }
      />
    </div>
  )
}

/** The Incomplete share of the window's Channels, as one bar. */
function MarkBar({ mark }: { mark: CompletenessMark }) {
  const complete = Math.max(0, mark.channelCount - mark.incompleteCount)
  const incomplete = mark.fixable ? "bg-amber-500/70" : GAP.stuck.className
  return (
    <div className="space-y-1">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        <div
          className={`min-w-[2px] border-0 ${incomplete}`}
          style={{
            flex: `${mark.incompleteCount} 1 0`,
            ...(mark.fixable ? undefined : gapStyle("stuck")),
          }}
        />
        {complete > 0 && (
          <div className={TRACK} style={{ flex: `${complete} 1 0` }} />
        )}
      </div>
      <p className="text-[11px] text-app-ink/60">
        {mark.incompleteCount} of {mark.channelCount} Channels Incomplete;{" "}
        {mark.fixable
          ? "a sync could have fixed some"
          : "no sync could have fixed them"}
      </p>
    </div>
  )
}

/**
 * History's mark of an Artifact's window: on an Incomplete one, a pill saying
 * its Unproven Posts, amber when a sync could have fixed some of it and slate
 * when none could, whose breakdown (a bar and the count per reason) opens on
 * hover for a mouse and on a tap otherwise; "not checked" on one made before
 * the record; nothing on a Complete one.
 */
export function CompletenessPill({
  scope,
}: {
  scope: FrozenScope | null | undefined
}) {
  if (!scope) return null
  const mark = scope.completeness
  if (!mark) return <NotChecked className="shrink-0" />
  if (mark.incompleteCount === 0) return null
  const phrase = pillPhrase(mark)
  const counts = mark.counts ?? {}
  return (
    <HoverPopover
      testId="completeness-pill"
      className={`inline-flex shrink-0 cursor-default items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${mark.fixable ? TONE.amber : TONE.slate}`}
      trigger={
        <>
          <AlertTriangle size={11} />
          {phrase}
        </>
      }
    >
      <div data-testid="completeness-breakdown" className="space-y-2 p-1">
        <p className="text-[12px] font-bold">{phrase}</p>
        <MarkBar mark={mark} />
        <ul className="space-y-1">
          {REASON_ORDER.filter((r) => counts[r]).map((r) => (
            <li key={r} className="flex items-center justify-between gap-2">
              <ReasonChip reason={r} />
              <span className="text-[12px] tabular-nums text-app-ink/70">
                {counts[r]}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-app-ink/50">
          Open it to see which Channels, and why.
        </p>
      </div>
    </HoverPopover>
  )
}
