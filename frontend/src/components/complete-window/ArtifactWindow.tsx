import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { useState } from "react"

import {
  type CompletenessMark,
  dataWindowCheck,
  type FrozenScope,
} from "@/client"
import { BarPopover } from "@/components/BarPopover"
import { TgButton } from "@/components/ui/tg-button"
import { usePostsViewEdits } from "@/contexts/PostsViewContext"
import { useUI } from "@/contexts/UIContext"
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
  type WindowCheck,
} from "@/lib/complete-window/window-check"
import { runGated } from "./Gate"
import { WindowBanner } from "./WindowBanner"
import { TONE } from "./WindowDetails"

/** The Artifact's Channels and window, checked again at this moment. */
function useCheckNow(names: string[], start: number, end: number) {
  const window = {
    mode: "fixed" as const,
    start,
    end: Math.min(end, Date.now()),
  }
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
  const { workspaceTabs } = useUI()
  const action = regenerateAction(kind)
  const regenerate = () => {
    if (!action) return
    restore(scope)
    workspaceTabs.openTab("action")
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
      Complete window: {names.length} Incomplete{" "}
      {names.length === 1 ? "Channel was" : "Channels were"} left out (
      {names
        .slice(0, 3)
        .map((n) => `@${n}`)
        .join(", ")}
      {names.length > 3 && ` +${names.length - 3}`}).
    </p>
  )
}

/**
 * An Artifact's window as it froze (ADR-043): the one-line banner with "now"
 * and Regenerate, its Left out Channels on a Complete window, or "not
 * checked" for one made before the record existed.
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
  if (!record)
    return (
      <p className="mb-3 text-[12px] text-app-ink/40">
        Window not checked: made before this was recorded.
      </p>
    )
  if (!isRecord(record)) return null
  const check = recordCheck(record)
  if (incompleteOf(check).length === 0)
    return record.leftOut.length ? <LeftOut names={record.leftOut} /> : null
  return (
    <div className="mb-3">
      <WindowBanner
        check={check}
        action={<NowAndRegenerate scope={scope} kind={kind} check={check} />}
      />
    </div>
  )
}

/**
 * History's mark of an Artifact made on an Incomplete window: amber when a
 * sync could have fixed some of it, slate when none could. Its breakdown
 * opens on hover for a mouse and on a tap otherwise, kept on screen.
 */
export function CompletenessPill({
  mark,
}: {
  mark: CompletenessMark | null | undefined
}) {
  const [open, setOpen] = useState(false)
  if (!mark || mark.incompleteCount === 0) return null
  const phrase = pillPhrase(mark)
  const n = mark.incompleteCount
  return (
    <BarPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          data-testid="completeness-pill"
          data-tone={mark.fixable ? "amber" : "slate"}
          onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
          // A mouse already opened it on hover; its click must not close it.
          onClick={(e) =>
            (e.nativeEvent as PointerEvent).pointerType === "mouse" &&
            e.preventDefault()
          }
          className={`inline-flex shrink-0 cursor-default items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${mark.fixable ? TONE.amber : TONE.slate}`}
        >
          <AlertTriangle size={11} />
          {phrase}
        </button>
      }
    >
      <div data-testid="completeness-breakdown" className="space-y-1 p-1">
        <p className="text-[12px] font-bold">{phrase}</p>
        <p className="text-[12px] text-app-ink/70">
          {n} {n === 1 ? "Channel was" : "Channels were"} Incomplete:{" "}
          {mark.fixable
            ? "a sync could have fixed some of them."
            : "no sync could have fixed them."}
        </p>
        <p className="text-[11px] text-app-ink/50">
          Open it to see which, and why.
        </p>
      </div>
    </BarPopover>
  )
}
