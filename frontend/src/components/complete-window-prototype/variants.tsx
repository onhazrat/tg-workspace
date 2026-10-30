// PROTOTYPE (complete-window): never merge. Every surface of ADR-043 in the one
// design left, D. Each export renders nothing in variant 0, so main stays main.

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  List,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import type { FrozenScope } from "@/client"
import { BarPopover } from "@/components/BarPopover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { TgButton } from "@/components/ui/tg-button"
import { useData } from "@/contexts/DataContext"
import {
  invalidatePostsReads,
  usePostsViewEdits,
} from "@/contexts/PostsViewContext"
import { useScope } from "@/contexts/ScopeContext"
import { useSync } from "@/contexts/SyncContext"
import { useUI } from "@/contexts/UIContext"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { queryClient } from "@/lib/queryClient"
import {
  type ArtifactCheck,
  type ArtifactKind,
  at,
  byFix,
  type ChannelCheck,
  type ChartSource,
  checkWindow,
  incompleteOf,
  isRoutine,
  liveKey,
  measure,
  postsPhrase,
  REASON_LABEL,
  REASON_TONE,
  type Reason,
  recordRun,
  type Stretch,
  setChartSource,
  setGateOwnsSync,
  shortfall,
  span,
  unproven,
  useArtifactCheck,
  useChartSource,
  useLiveCheck,
  useVariant,
  type WindowCheck,
} from "./store"

const TONE: Record<"red" | "amber" | "slate", string> = {
  red: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  amber:
    "bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/30",
  slate: "bg-app-ink/5 text-app-ink/60 border-app-ink/15",
}
function ReasonChip({ reason, title }: { reason: Reason; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[REASON_TONE[reason]]} ${title ? "cursor-help underline decoration-dotted" : ""}`}
    >
      {REASON_LABEL[reason]}
    </span>
  )
}

/** Counts per reason, worst first. */
function byReason(channels: ChannelCheck[]): [Reason, number][] {
  const counts = new Map<Reason, number>()
  for (const c of channels)
    if (c.reason) counts.set(c.reason, (counts.get(c.reason) ?? 0) + 1)
  return [...counts.entries()]
}

// ---- The gate: one run of the check-sync-freeze flow, shared by every surface --

type Phase = "idle" | "checking" | "review" | "syncing" | "result"

/** Every Action row button that freezes a Scope, so every one is gated. */
export type ActionKind =
  | "summary"
  | "summary-prompt"
  | "chat"
  | "tags"
  | "tags-prompt"
  | "discover"
const ACTION: Record<ActionKind, { verb: string; artifact: string }> = {
  summary: { verb: "Generate summary", artifact: "Summary" },
  "summary-prompt": {
    verb: "Copy summary prompt",
    artifact: "Pending Summary",
  },
  chat: { verb: "Start a chat", artifact: "Chat" },
  tags: { verb: "Generate tags", artifact: "Tag run" },
  "tags-prompt": { verb: "Copy tag prompt", artifact: "Pending Tag run" },
  discover: { verb: "Generate report", artifact: "Discovery report" },
}

interface GateState {
  phase: Phase
  kind: ActionKind
  freeze: number
  start: number
  end: number
  names: string[]
  check?: WindowCheck
  syncing: string[]
  outcome?: ArtifactCheck
  error?: string
  /** Showing the chip's cached check while the frozen one runs. */
  refreshing?: boolean
  /** The person edited the list: the countdown stops, only a click acts. */
  touched?: boolean
}
let gate: GateState = {
  phase: "idle",
  kind: "summary",
  freeze: 0,
  start: 0,
  end: 0,
  names: [],
  syncing: [],
}
const gateListeners = new Set<() => void>()
const setGate = (next: Partial<GateState>) => {
  gate = { ...gate, ...next }
  for (const l of gateListeners) l()
}
const useGateState = () =>
  useSyncExternalStore(
    (cb) => {
      gateListeners.add(cb)
      return () => gateListeners.delete(cb)
    },
    () => gate,
  )
let continueNow: (() => void) | null = null
/** Bumped by every begin and cancel, so a check that lands late is dropped. */
let run = 0

/** ADR-043's deadline for a person waiting; they can continue sooner. */
const DEADLINE_MS = 5 * 60_000

/**
 * Each row's handler from its latest render. The gate calls the latest, not
 * the one captured at the click: "complete only" narrows the selection first,
 * and every action reads the selection from the render it was made in.
 */
const latest: Partial<Record<ActionKind, () => unknown>> = {}
/** Whether the open gate still owes its action a run; cancel clears it. */
let pendingAction = false

async function finish(
  choice: string,
  channels: ChannelCheck[],
  narrowed?: { total: number; excluded: string[] },
  /** What the gate's sync did, said in the same toast. */
  said?: string,
) {
  const incomplete = channels.filter((c) => c.reason)
  await recordRun({
    freeze: gate.freeze,
    start: gate.start,
    end: Math.min(gate.end, gate.freeze),
    choice,
    kind: gate.kind,
    channels: incomplete,
    total: narrowed?.total ?? gate.names.length,
    posts: gate.check?.posts,
    excluded: narrowed?.excluded ?? [],
  })
  // A sync moved Last sync: every cached check, live or "now", is stale.
  void queryClient.invalidateQueries({ queryKey: ["proto", "completeness"] })
  const owed = pendingAction
  pendingAction = false
  const { verb } = ACTION[gate.kind]
  setGate({ phase: "idle" })
  if (incomplete.length)
    toast.warning(
      `${said ? `${said} ` : ""}${verb} runs on an Incomplete window: ${measure(incomplete).phrase}.`,
    )
  else if (said) toast.success(said)
  // The gate has decided what to sync; main's own pre-sync must not redo it.
  setGateOwnsSync(true)
  try {
    if (owed) await latest[gate.kind]?.()
  } finally {
    setGateOwnsSync(false)
  }
}

const withReason = (c: ChannelCheck, r: Reason): ChannelCheck => ({
  ...c,
  reasons: [r, ...c.reasons.filter((x) => x !== r)],
  reason: r,
})

/**
 * A sync started from the live banner, before any action. The gate joins it
 * rather than queueing the same Channels again, so the wait passes while the
 * person still picks a model.
 */
let early: { names: Set<string>; job: Promise<void>; at: number } | null = null
const earlyListeners = new Set<() => void>()
const setEarly = (next: typeof early) => {
  early = next
  for (const l of earlyListeners) l()
}
const useEarlySync = () =>
  useSyncExternalStore(
    (cb) => {
      earlyListeners.add(cb)
      return () => earlyListeners.delete(cb)
    },
    () => early,
  )

/**
 * What a person can do about a Channel no sync can fix: leave it out of the
 * selection, or unfreeze it as the Channels tab does (into the default
 * group), after which a sync can. An open gate takes the change at once.
 */
function useStuckActions() {
  const { channels, selectedChannels, setSelectedChannels, loadChannels } =
    useData()
  const { data: groups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()
  const leaveOut = (names: string[]) => {
    const out = new Set(names)
    const before = new Set(selectedChannels)
    setSelectedChannels(new Set([...before].filter((n) => !out.has(n))))
    if (gate.check)
      setGate({
        touched: true,
        names: gate.names.filter((n) => !out.has(n)),
        check: {
          ...gate.check,
          channels: gate.check.channels.filter((c) => !out.has(c.name)),
        },
      })
    toast.info(
      `Left ${names.length === 1 ? `@${names[0]}` : `${names.length} Channels`} out of the selection.`,
      { action: { label: "Undo", onClick: () => setSelectedChannels(before) } },
    )
  }
  const home = groups.find((g) => g.isDefault)
  const canUnfreeze = (name: string) => {
    const c = channels.find((x) => x.name === name)
    return !!home && !!c?.isFrozen && !c.isUnavailableOnWebView
  }
  const unfreeze = async (name: string) => {
    const c = channels.find((x) => x.name === name)
    if (!c || !home) return
    await api.bulkAssignSettingGroup({
      channelIds: [c.id],
      settingGroupId: home.id,
    })
    await loadChannels()
    await invalidateSettingGroups()
    void queryClient.invalidateQueries({ queryKey: ["proto", "completeness"] })
    if (gate.check)
      setGate({
        touched: true,
        check: {
          ...gate.check,
          channels: gate.check.channels.map((x) => {
            if (x.name !== name) return x
            const reasons = x.reasons.filter((r) => r !== "frozen")
            return { ...x, syncable: true, reasons, reason: reasons[0] ?? null }
          }),
        },
      })
    toast.success(
      `Unfroze @${name}: it is in ${home.name} now, so a sync can fix it.`,
    )
  }
  return { leaveOut, canUnfreeze, unfreeze }
}

function StuckRowActions({ c }: { c: ChannelCheck }) {
  const { leaveOut, canUnfreeze, unfreeze } = useStuckActions()
  return (
    <span className="inline-flex shrink-0 gap-2 text-[11px] font-bold">
      {canUnfreeze(c.name) && (
        <button
          type="button"
          className="underline"
          onClick={() => void unfreeze(c.name)}
        >
          Unfreeze
        </button>
      )}
      <button
        type="button"
        className="underline"
        onClick={() => leaveOut([c.name])}
      >
        Leave out
      </button>
    </span>
  )
}

/** The head of the rows no sync can fix, with one way to clear them all. */
function StuckHead({ stuck }: { stuck: ChannelCheck[] }) {
  const { leaveOut } = useStuckActions()
  return (
    <p className="flex items-center justify-between gap-2 px-1 text-[11px] font-bold text-app-ink/70">
      No sync can fix these · {stuck.length}
      <button
        type="button"
        className="underline"
        onClick={() => leaveOut(stuck.map((c) => c.name))}
      >
        Leave all out
      </button>
    </p>
  )
}

/**
 * Sync what a sync can fix now, from the live banner, before any action.
 * The gate, opened meanwhile, joins this sync instead of starting its own.
 */
function SyncNow({ check }: { check: ArtifactCheck }) {
  const running = useEarlySync()
  const { channels } = useData()
  const { scrapeChannelsInParallel } = useSync()
  const wanted = new Set(byFix(incompleteOf(check)).fixable.map((c) => c.name))
  const targets = channels.filter((c) => wanted.has(c.name))
  if (running)
    return (
      <span className="inline-flex items-center gap-1 text-[12px]">
        <Loader2 size={12} className="animate-spin" /> Syncing{" "}
        {running.names.size}…
      </span>
    )
  if (targets.length === 0) return null
  const start = () => {
    const names = new Set(targets.map((c) => c.name))
    const job = scrapeChannelsInParallel(
      targets,
      "Early Sync (complete-window prototype)",
    ).then(
      () => {},
      () => {},
    )
    setEarly({ names, job, at: Date.now() })
    void job.then(() => {
      setEarly(null)
      invalidatePostsReads(queryClient)
      void queryClient.invalidateQueries({
        queryKey: ["proto", "completeness"],
      })
      // A gate that joined says what the sync did itself.
      if (gate.phase === "idle")
        toast.success(`Synced ${names.size}. Checking the window again.`)
    })
  }
  return (
    <TgButton type="button" size="sm" variant="secondary" onClick={start}>
      <RefreshCw size={12} />
      Sync {targets.length}
    </TgButton>
  )
}

function useGate() {
  const state = useGateState()
  const { channels, selectedChannels, setSelectedChannels } = useData()
  const { startDate, endDate } = useScope()
  const { scrapeChannelsInParallel } = useSync()

  const begin = async (kind: ActionKind) => {
    // The selection's own names: the Channel list can still be loading (5 to
    // 10 s after a page load), and an empty check would pass as Complete.
    const names = [...selectedChannels].sort()
    // The action starts here: `now` is frozen for the check and the record.
    const freeze = Date.now()
    const mine = ++run
    setGate({
      phase: "checking",
      kind,
      freeze,
      start: startDate,
      end: endDate,
      names,
      check: undefined,
      outcome: undefined,
      error: undefined,
      syncing: [],
      refreshing: false,
      touched: false,
    })
    // The chip already checked this Scope: open on its answer at once, and
    // swap in the check frozen at this moment when it lands.
    const cached = queryClient.getQueryData<WindowCheck>(
      liveKey(names, startDate, endDate),
    )
    if (cached && byFix(incompleteOf(cached)).fixable.length)
      setGate({ phase: "review", check: cached, refreshing: true })
    try {
      const check = await checkWindow(names, startDate, endDate, freeze)
      // Cancelled, or the person already chose on the cached answer.
      if (mine !== run || !["checking", "review"].includes(gate.phase)) return
      setGate({ refreshing: false })
      const incomplete = incompleteOf(check)
      if (incomplete.length === 0) await finish("complete", [])
      // Nothing a sync can fix: no question worth asking, so run and mark it.
      else if (byFix(incomplete).fixable.length === 0)
        await finish("nothing to sync", incomplete)
      else setGate({ phase: "review", check })
    } catch (err) {
      if (mine !== run) return
      setGate({ phase: "idle" })
      toast.error(`Prototype check failed: ${String(err)}`)
    }
  }

  const sync = async () => {
    const targets = incompleteOf(gate.check).filter((c) => c.syncable)
    const wanted = new Set(targets.map((c) => c.name))
    // Right after a page load the Channel list may not be here to sync from.
    if (!channels.some((c) => wanted.has(c.name))) {
      toast.info("Channels are still loading. Sync again in a moment.")
      return
    }
    setGate({ phase: "syncing", syncing: [...wanted], refreshing: false })
    let jobDone = false
    // A sync from the banner is joined, not queued again.
    const joined = early
    const fresh = channels.filter(
      (c) => wanted.has(c.name) && !joined?.names.has(c.name),
    )
    const job = Promise.all([
      joined?.job,
      fresh.length
        ? scrapeChannelsInParallel(
            fresh,
            `Pre-${ACTION[gate.kind].artifact} Sync (complete-window prototype)`,
          )
        : undefined,
    ]).then(
      () => {
        jobDone = true
      },
      () => {
        jobDone = true
      },
    )
    await Promise.race([
      job,
      new Promise<void>((resolve) => {
        continueNow = resolve
        setTimeout(resolve, DEADLINE_MS)
      }),
    ])
    continueNow = null
    invalidatePostsReads(queryClient)
    const again = await checkWindow(
      gate.names,
      gate.start,
      gate.end,
      gate.freeze,
    )
    const still = incompleteOf(again).map((c) =>
      !jobDone && wanted.has(c.name) ? withReason(c, "timed_out") : c,
    )
    const left = new Set(still.map((c) => c.name))
    const fixed = [...wanted].filter((n) => !left.has(n)).length
    await finish(
      jobDone ? "synced" : "continued early",
      still,
      undefined,
      `Synced ${wanted.size}: ${fixed} now complete${fixed < wanted.size ? `, ${wanted.size - fixed} still not` : ""}.`,
    )
  }

  const skip = async () => {
    const still = incompleteOf(gate.check).map((c) =>
      c.syncable ? withReason(c, "skipped") : c,
    )
    await finish("skipped", still)
  }

  /**
   * Run on the Complete Channels alone: the Incomplete ones leave the Channel
   * selection, so the Artifact's Scope never names them and its window is
   * Complete. The selection stays narrowed, with an Undo.
   */
  const completeOnly = async () => {
    const excluded = incompleteOf(gate.check).map((c) => c.name)
    const out = new Set(excluded)
    const before = new Set(selectedChannels)
    const keep = new Set([...selectedChannels].filter((n) => !out.has(n)))
    setSelectedChannels(keep)
    // Let the rows render once with the new selection before the action reads it.
    await new Promise((resolve) => setTimeout(resolve, 150))
    toast.info(
      `Selection narrowed to the ${gate.names.length - excluded.length} complete Channels.`,
      { action: { label: "Undo", onClick: () => setSelectedChannels(before) } },
    )
    await finish("complete only", [], {
      total: gate.names.length - excluded.length,
      excluded,
    })
  }

  return {
    state,
    begin,
    sync,
    skip,
    completeOnly,
    cancel: () => {
      run++
      pendingAction = false
      setGate({ phase: "idle" })
    },
    continueNow: () => continueNow?.(),
    close: () => setGate({ phase: "idle" }),
  }
}

// The mounted `ProtoGate` lends its `begin`, so a row needs no providers.
let beginGate: ((kind: ActionKind) => void) | null = null

/**
 * Wrap an Action row's handler: variant 0 runs it as main does; every other
 * variant runs the check first, then the action for real.
 */
export function useGated() {
  const v = useVariant()
  return (kind: ActionKind, real: () => unknown) => {
    latest[kind] = real
    return () => {
      if (v === "0") {
        real()
        return
      }
      pendingAction = true
      beginGate?.(kind)
    }
  }
}

/** Mounted once on the Action tab: the gate in this variant's form. */
export function ProtoGate() {
  const v = useVariant()
  const g = useGate()
  beginGate = (kind) => void g.begin(kind)
  if (v !== "0") return <GateDialog />
  return null
}

function Checking({ names }: { names: number }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-app-ink/70">
      <Loader2 size={14} className="animate-spin" /> Checking the window for{" "}
      {names} Channels…
    </p>
  )
}

function GateRows({
  channels,
  syncing,
  end,
  stuck = false,
}: {
  channels: ChannelCheck[]
  syncing: string[]
  /** The window's end E, to say how far behind each Channel is. */
  end: number
  /** No sync can fix these: each row offers what can. */
  stuck?: boolean
}) {
  const { scrapingChannels } = useSync()
  const banner = useEarlySync()
  return (
    <ul className="divide-y divide-app-ink/5 rounded-lg border border-app-ink/10">
      {channels.map((c) => (
        <li
          key={c.name}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]"
        >
          {/* A row with several reasons wraps them instead of hiding the name. */}
          <span className="min-w-[8rem] flex-1 truncate font-medium">
            @{c.name}
          </span>
          {syncing.includes(c.name) &&
            (scrapingChannels.has(c.name) ? (
              <Loader2 size={13} className="animate-spin text-app-ink/50" />
            ) : (
              <span className="text-[11px] text-app-ink/40">queued</span>
            ))}
          {/* Started from the banner before the click; the gate's Sync joins it. */}
          {!syncing.includes(c.name) && banner?.names.has(c.name) && (
            <span className="inline-flex items-center gap-1 text-[11px] text-app-ink/50">
              <Loader2 size={11} className="animate-spin" /> syncing, started{" "}
              {span(Date.now() - banner.at)} ago
            </span>
          )}
          <span
            title={`Last sync ${at(c.lastSync)}`}
            className="shrink-0 text-[11px] text-app-ink/60"
          >
            {shortfall(c, end) || `synced ${at(c.lastSync)}`}
          </span>
          <Chips c={c} said={!!shortfall(c, end)} />
          {stuck && <StuckRowActions c={c} />}
        </li>
      ))}
    </ul>
  )
}

/**
 * A row's reason chips, minus the ones its words already say (behind, hole,
 * short history). A failure carries its error on hover.
 */
function Chips({ c, said }: { c: ChannelCheck; said: boolean }) {
  const worded: Reason[] = ["end", "hole", "start"]
  return (
    <>
      {c.reasons
        .filter((r) => !said || !worded.includes(r))
        .map((r) => (
          <ReasonChip
            key={r}
            reason={r}
            title={r === "failed" ? (c.error ?? undefined) : undefined}
          />
        ))}
    </>
  )
}

/**
 * The rows: the problems a sync can fix, then the ones only behind folded
 * into one line, then what no sync can fix.
 */
function GroupedRows({
  channels,
  syncing,
  end,
}: {
  channels: ChannelCheck[]
  syncing: string[]
  end: number
}) {
  const { fixable, stuck } = byFix(channels)
  const problems = fixable.filter((c) => !isRoutine(c))
  const behind = fixable.filter(isRoutine)
  const lag = Math.max(0, ...behind.map(unproven))
  return (
    <div className="max-h-[50vh] space-y-3 overflow-y-auto">
      {problems.length > 0 && (
        <div className="space-y-1">
          <GroupHead>A sync can fix these · {problems.length}</GroupHead>
          <GateRows channels={problems} syncing={syncing} end={end} />
        </div>
      )}
      {behind.length > 0 && (
        <details
          className="group space-y-1"
          open={problems.length === 0 && stuck.length === 0}
        >
          <summary className="cursor-pointer px-1 text-[11px] font-bold text-app-ink/70">
            Just behind · {behind.length}, up to {span(lag)}
            <span className="font-normal text-app-ink/50 group-open:hidden">
              {" "}
              · show
            </span>
          </summary>
          <GateRows channels={behind} syncing={syncing} end={end} />
        </details>
      )}
      {stuck.length > 0 && (
        <div className="space-y-1">
          <StuckHead stuck={stuck} />
          <GateRows channels={stuck} syncing={syncing} end={end} stuck />
        </div>
      )}
    </div>
  )
}

/** "with ~340 Posts (7%) unproven", or "no Posts expected". */
const unprovenSaid = (phrase: string) =>
  phrase === "no Posts expected" ? phrase : `with ${phrase} unproven`

function GroupHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 text-[11px] font-bold text-app-ink/70">{children}</p>
  )
}

function Outcome({ outcome }: { outcome: ArtifactCheck }) {
  const { verb, artifact } = ACTION[gate.kind]
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-app-ink/70">
        {verb} is stubbed in this prototype. The new {artifact} would carry
        this:
      </p>
      <div className="max-h-[55vh] overflow-y-auto">
        <SummaryPanelBody check={outcome} />
      </div>
    </div>
  )
}

function GateDialog() {
  const g = useGate()
  const { phase, check, syncing, outcome } = g.state
  const open = phase !== "idle"
  const incomplete = incompleteOf(check)
  const syncable = incomplete.filter((c) => c.syncable).length
  const { behind, problems } = measure(incomplete)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && phase !== "syncing" && g.cancel()}
    >
      <DialogContent className="max-w-xl">
        {phase === "checking" ? (
          <>
            <DialogTitle>{ACTION[g.state.kind].verb}</DialogTitle>
            <Checking names={g.state.names.length} />
          </>
        ) : phase === "result" && outcome ? (
          <>
            <DialogTitle>Run recorded</DialogTitle>
            <Outcome outcome={outcome} />
            <div className="flex justify-end">
              <TgButton onClick={g.close}>Close</TgButton>
            </div>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (phase === "review") void g.sync()
            }}
          >
            <DialogTitle>
              {problems.length
                ? `${problems.length} ${problems.length === 1 ? "Channel needs" : "Channels need"} attention`
                : `${behind.length} Channels are just behind`}
              {problems.length > 0 && behind.length > 0 && (
                <span className="font-normal text-app-ink/60">
                  , {behind.length} just behind
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Before {ACTION[g.state.kind].verb.toLowerCase()}: the window ends{" "}
              {at(Math.min(g.state.end, g.state.freeze))},{" "}
              {unprovenSaid(postsPhrase(incomplete, check?.posts))}.
              {g.state.refreshing && (
                <span className="ml-1 inline-flex items-center gap-1 text-app-ink/50">
                  <Loader2 size={11} className="animate-spin" /> refreshing
                </span>
              )}
            </DialogDescription>
            <CoverageBar check={check} />
            <GroupedRows
              channels={incomplete}
              syncing={syncing}
              end={Math.min(g.state.end, g.state.freeze)}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {phase === "syncing" ? (
                <TgButton
                  type="button"
                  variant="secondary"
                  onClick={g.continueNow}
                >
                  Continue now
                </TgButton>
              ) : (
                <>
                  <TgButton type="button" variant="ghost" onClick={g.cancel}>
                    Cancel
                  </TgButton>
                  <TgButton
                    type="button"
                    variant="secondary"
                    onClick={() => void g.skip()}
                  >
                    Continue without syncing
                  </TgButton>
                  <CompleteOnlyButton
                    count={g.state.names.length - incomplete.length}
                    onClick={() => void g.completeOnly()}
                  />
                  {/* Enter submits the form: the default is the sync. */}
                  <SyncButton
                    count={syncable}
                    onSync={() => void g.sync()}
                    submit
                    stopped={g.state.touched}
                  />
                </>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Run on the Complete Channels only; absent when none are. */
function CompleteOnlyButton({
  count,
  onClick,
}: {
  count: number
  onClick: () => void
}) {
  if (count === 0) return null
  return (
    <TgButton
      type="button"
      variant="secondary"
      disabled={count === 0}
      title={
        count === 0
          ? "No Channel is complete for this window."
          : "Leave the Incomplete Channels out of the selection and run on the rest."
      }
      onClick={onClick}
    >
      Continue with {count} complete only
    </TgButton>
  )
}

/** How long every variant waits before the default, the sync, starts by itself. */
const AUTO_SYNC_SECONDS = 30

/**
 * The sync button, counting down to pressing itself: the default is the sync,
 * and doing nothing gets it. Mounted only while the gate waits for a choice,
 * so each review starts a fresh count. With nothing syncable it never fires.
 */
function SyncButton({
  count,
  onSync,
  submit = false,
  stopped = false,
}: {
  count: number
  onSync: () => void
  /** The gate is a form: the button submits it, so Enter syncs. */
  submit?: boolean
  /** An edit in the gate stopped the countdown for good. */
  stopped?: boolean
}) {
  const [left, setLeft] = useState(AUTO_SYNC_SECONDS)
  const fired = useRef(false)
  useEffect(() => {
    if (count === 0 || stopped) return
    if (left === 0) {
      if (!fired.current) onSync()
      fired.current = true
      return
    }
    const id = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(id)
  }, [left, count, onSync, stopped])
  return (
    <TgButton
      type={submit ? "submit" : "button"}
      autoFocus
      disabled={count === 0}
      onClick={submit ? undefined : onSync}
      title={stopped ? undefined : `Syncs by itself in ${left}s`}
      className="relative overflow-hidden"
    >
      {/* The countdown, filling the button until it presses itself. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-app-bg/25 transition-[width] duration-1000 ease-linear"
        style={{
          width: stopped
            ? 0
            : `${((AUTO_SYNC_SECONDS - left) / AUTO_SYNC_SECONDS) * 100}%`,
        }}
      />
      <RefreshCw size={13} className="relative" />
      <span className="relative">
        Sync {count}
        {!stopped && ` · ${left}s`}
      </span>
    </TgButton>
  )
}

// ---- Live indicator: the Action and Posts tabs ----------------------------------

// ---- Gap colours --------------------------------------------------------------
// A chart colours what is missing, never why: failed and skipped are the rows'
// chips. Three gap kinds take categorical slots 1 to 3 of the dataviz
// reference palette, validated all-pairs in both modes against the app's cards
// (#fff, #1a1a1a): worst CVD ΔE 9.2 light / 9.4 dark. Routine lag is a lighter
// step of the end-gap blue (an ordinal pair, both modes pass). A covered
// stretch is a neutral track, not green: green beside an amber gap was ΔE 5.7
// under protanopia. What no sync can fix is hatched, so it reads without colour.
type Gap = "hole" | "start" | "overdue" | "stuck" | "behind" | "complete"
const TRACK = "bg-[#f0efec] dark:bg-[#383835]"
const GAP: Record<Gap, { label: string; className: string }> = {
  hole: { label: "Hole", className: "bg-[#eb6834] dark:bg-[#d95926]" },
  start: {
    label: "Short history",
    className: "bg-[#1baf7a] dark:bg-[#199e70]",
  },
  overdue: {
    label: "End gap, overdue",
    className: "bg-[#2a78d6] dark:bg-[#3987e5]",
  },
  stuck: { label: "No sync can fix", className: "text-app-ink/45" },
  behind: {
    label: "End gap, routine",
    className: "bg-[#86b6ef] dark:bg-[#184f95]",
  },
  // Covered all through: the track, no colour.
  complete: { label: "Complete", className: TRACK },
}
const GAP_ORDER = Object.keys(GAP) as Gap[]
const gapStyle = (g: Gap) =>
  g === "stuck"
    ? {
        backgroundImage:
          "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px)",
      }
    : undefined

/** One unproven stretch's colour on a Channel's bar. */
function stretchGap(c: ChannelCheck, s: Stretch): Gap {
  if (!c.syncable) return "stuck"
  if (s.kind !== "end") return s.kind
  return s.to - s.from <= (c.behindLimit ?? 2 * 60 * 60_000)
    ? "behind"
    : "overdue"
}

/** A Channel's one segment on the summary bar: its most telling stretch. */
function channelGap(c: ChannelCheck): Gap {
  if (!c.syncable) return "stuck"
  const gaps = c.stretches.map((s) => stretchGap(c, s))
  return GAP_ORDER.find((g) => gaps.includes(g)) ?? "overdue"
}

/**
 * Which kinds the lists under a legend hide. The bar keeps counting them; the
 * table, the chart and the rows leave them out. Complete starts off: the lists
 * are about what is missing until the person asks for the rest.
 */
function useGapFilter(initial: Gap[] = []) {
  const [hidden, setHidden] = useState<Set<Gap>>(
    () => new Set<Gap>(["complete", ...initial]),
  )
  const toggle = (g: Gap) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  /**
   * Plotly's double click: show this kind alone, or, when it already is,
   * every kind again. Its two single clicks cancel out before it lands.
   */
  const isolate = (g: Gap, present: Gap[]) =>
    setHidden((prev) => {
      const others = present.filter((x) => x !== g)
      const alone = !prev.has(g) && others.every((x) => prev.has(x))
      return new Set(alone ? [] : others)
    })
  const keep = <T extends { channels?: ChannelCheck[] }>(
    check: T,
  ): T & { showComplete: boolean } => ({
    ...check,
    channels: check.channels?.filter(
      (c) => !hidden.has(c.reason ? channelGap(c) : "complete"),
    ),
    showComplete: !hidden.has("complete"),
  })
  return { hidden, toggle, isolate, keep }
}

/** Shows or hides the rows under a legend, as Visualize does the chart. */
function RowsToggle({
  rows,
  setRows,
}: {
  rows: boolean
  setRows: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={rows}
      onClick={() => setRows(!rows)}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-app-ink/15 px-2 py-1 text-[11px] font-bold text-app-ink hover:bg-app-ink/5"
    >
      <List size={12} />
      {rows ? "Hide rows" : "Show rows"}
    </button>
  )
}

/**
 * The rows under a legend: the Incomplete Channels in the rows' order, then
 * the Complete ones when the legend shows them.
 */
function rowsOf(check: { channels?: ChannelCheck[]; showComplete?: boolean }) {
  const all = check.channels ?? []
  const { fixable, stuck } = byFix(all.filter((c) => c.reason))
  return [
    ...fixable,
    ...stuck,
    ...(check.showComplete ? all.filter((c) => !c.reason) : []),
  ]
}

/** Said in place of an empty list when every kind in it is switched off. */
function AllHidden() {
  return (
    <p className="text-[12px] text-app-ink/50">
      Every kind is hidden: turn one back on in the legend above.
    </p>
  )
}

function Swatch({ gap }: { gap: Gap }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-3 shrink-0 rounded-sm ${GAP[gap].className}`}
      style={gapStyle(gap)}
    />
  )
}

function CoverageBar({
  check,
  filter,
}: {
  check: WindowCheck | ArtifactCheck | undefined
  /** When given, each legend item toggles its kind in the lists below. */
  filter?: ReturnType<typeof useGapFilter>
}) {
  const total =
    (check as ArtifactCheck | undefined)?.total ?? check?.channels?.length ?? 0
  const incomplete = incompleteOf(check)
  const counts = new Map<Gap, number>()
  for (const c of incomplete)
    counts.set(channelGap(c), (counts.get(channelGap(c)) ?? 0) + 1)
  const complete = total - incomplete.length
  if (complete > 0) counts.set("complete", complete)
  const groups = GAP_ORDER.filter((g) => counts.has(g)).map(
    (g) => [g, counts.get(g) ?? 0] as const,
  )
  // An Artifact keeps only its Incomplete Channels' names: its Complete ones
  // can be counted, not listed.
  const listable = (g: Gap) =>
    g !== "complete" || !!check?.channels?.some((c) => !c.reason)
  const present = groups.map(([g]) => g).filter(listable)
  const lag = measure(incomplete).lag
  if (!total) return null
  return (
    <div className="space-y-1">
      {/* Segments sized by count, 2px surface gaps between them; the covered
          share is the neutral track. */}
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {groups.map(([gap, n]) => (
          <div
            key={gap}
            title={`${GAP[gap].label}: ${n}`}
            className={`min-w-[2px] transition-opacity ${GAP[gap].className} ${gap !== "complete" && filter?.hidden.has(gap) ? "opacity-25" : ""}`}
            style={{ flex: `${n} 1 0`, ...gapStyle(gap) }}
          />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-app-ink/60">
        {groups.map(([gap, n]) => {
          const item = (
            <>
              <Swatch gap={gap} /> {GAP[gap].label}{" "}
              <span className="font-bold tabular-nums">
                {n}
                {gap === "behind" && lag > 0 && (
                  <span className="font-normal">, up to {span(lag)}</span>
                )}
                {gap === "complete" && (
                  <span className="font-normal"> of {total}</span>
                )}
              </span>
            </>
          )
          if (!filter || !listable(gap))
            return (
              <span key={gap} className="inline-flex items-center gap-1">
                {item}
              </span>
            )
          const shown = !filter.hidden.has(gap)
          return (
            <button
              key={gap}
              type="button"
              aria-pressed={shown}
              title={`${shown ? "Hide" : "Show"} these below; double-click to show only these`}
              onClick={() => filter.toggle(gap)}
              onDoubleClick={() => filter.isolate(gap, present)}
              className={`-mx-1 inline-flex select-none items-center gap-1 rounded px-1 hover:bg-app-ink/5 ${shown ? "" : "line-through opacity-50"}`}
            >
              {item}
            </button>
          )
        })}
      </p>
    </div>
  )
}

export function ProtoWindowIndicator(
  props: Parameters<typeof ProtoWindowIndicatorInner>[0],
) {
  return useVariant() === "0" ? null : <ProtoWindowIndicatorInner {...props} />
}

function ProtoWindowIndicatorInner({
  where,
  slot = "row",
}: {
  where: "action" | "posts"
  /** The banner takes a row of its own under the Action tab's header. */
  slot?: "inline" | "row"
}) {
  const v = useVariant()
  const mine = where === "posts" || slot === "row"
  const { channels, selectedChannels } = useData()
  const { startDate, endDate } = useScope()
  const names = channels
    .filter((c) => selectedChannels.has(c.name))
    .map((c) => c.name)
  const q = useLiveCheck(names, startDate, endDate, v !== "0")
  if (v === "0" || names.length === 0 || !mine) return null
  const check = q.data
  const incomplete = incompleteOf(check)
  const pad =
    where === "action"
      ? "block w-full border-b border-app-ink/10 px-4 py-2"
      : ""

  const view = (() => {
    if (!check)
      return (
        <span
          className={`flex items-center gap-1 text-[11px] text-app-ink/50 ${pad}`}
        >
          <Loader2 size={12} className="animate-spin" /> Checking the window…
        </span>
      )

    // The Artifact's banner, on the live window.
    const live: ArtifactCheck = {
      checked: true,
      ...check,
      end: Math.min(check.end, check.freeze),
      total: check.channels.length,
    }
    return (
      <div className={pad}>
        {incomplete.length ? (
          <WindowBanner
            check={live}
            source={{ kind: "live" }}
            extra={<SyncNow check={live} />}
            className=""
            hideRoutine
            act
          />
        ) : (
          <p className="flex items-center gap-2 text-[12px] text-green-700 dark:text-green-300">
            <CheckCircle2 size={14} /> Complete window: all{" "}
            {check.channels.length} Channels proven through {at(live.end)}.
          </p>
        )}
      </div>
    )
  })()
  // The last answer stays readable but dimmed until the new one lands, so a
  // count is never shown as current for a selection or window it is not for.
  return q.updating && check ? (
    <div className="relative" aria-busy="true">
      <div className="opacity-40">{view}</div>
      <span className="pointer-events-none absolute top-1/2 right-24 flex -translate-y-1/2 items-center gap-1 text-[11px] text-app-ink/60">
        <Loader2 size={12} className="animate-spin" /> Updating…
      </span>
    </div>
  ) : (
    view
  )
}

// ---- History ----------------------------------------------------------------------

/** Variant 0 renders main: no hooks run, so main's tests need no providers. */
export function ProtoHistoryMark(
  props: Parameters<typeof ProtoHistoryMarkInner>[0],
) {
  return useVariant() === "0" ? null : <ProtoHistoryMarkInner {...props} />
}

function ProtoHistoryMarkInner({ id, kind }: { id: string; kind: string }) {
  const v = useVariant()
  const q = useArtifactCheck(id, kind, v !== "0")
  const [open, setOpen] = useState(false)
  if (v === "0") return null
  const check = q.data
  if (!check)
    return <span className="text-[11px] text-app-ink/30">checking…</span>
  if (!check.checked)
    return <span className="text-[11px] text-app-ink/40">not checked</span>
  const incomplete = incompleteOf(check)
  const { fixable, stuck } = byFix(incomplete)
  const groups = [
    ["A sync would have fixed", fixable],
    ["No sync could fix", stuck],
  ] as const

  if (v !== "0")
    return incomplete.length ? (
      // The breakdown by reason: a mouse opens it on hover, a tap or a key on
      // click, and the popover keeps it on a phone's screen.
      <BarPopover
        open={open}
        onOpenChange={setOpen}
        trigger={
          // Slate when no sync could have helped: nothing to act on, only to know.
          <button
            type="button"
            onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
            onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
            // A mouse already opened it on hover; its click must not close it.
            onClick={(e) =>
              (e.nativeEvent as PointerEvent).pointerType === "mouse" &&
              e.preventDefault()
            }
            className={`inline-flex cursor-default items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${incomplete.some((c) => c.syncable) ? TONE.amber : TONE.slate}`}
          >
            <AlertTriangle size={11} />
            {unprovenSaid(postsPhrase(incomplete)).replace(/^with /, "")}
          </button>
        }
      >
        <p className="mb-2 px-1 text-[12px] font-bold">
          {unprovenSaid(postsPhrase(incomplete, check.posts)).replace(
            /^with /,
            "",
          )}
        </p>
        <CoverageBar check={check} />
        {groups.map(
          ([head, rows]) =>
            rows.length > 0 && (
              <span key={head} className="mt-2 block">
                <span className="block text-[11px] font-bold text-app-ink/60">
                  {head} · {rows.length}
                </span>
                <ul className="mt-1 space-y-1">
                  {byReason(rows).map(([reason, n]) => (
                    <li
                      key={reason}
                      className="flex items-center justify-between gap-2"
                    >
                      <ReasonChip reason={reason} />
                      <span className="text-[12px] tabular-nums text-app-ink/70">
                        {n}
                      </span>
                    </li>
                  ))}
                </ul>
              </span>
            ),
        )}
      </BarPopover>
    ) : null

  return null
}

// ---- The Summary page ---------------------------------------------------------------

/**
 * Each Incomplete Channel's window as a bar, with the stretch it cannot vouch
 * for in its own colour, behind Visualize and on the Coverage tab.
 */
function Timeline({
  check,
  bar = true,
}: {
  check: WindowCheck | ArtifactCheck
  bar?: boolean
}) {
  // The rows' order: problems, then only behind, then what no sync can fix,
  // each biggest gap first.
  const filter = useGapFilter()
  const incomplete = rowsOf(bar ? filter.keep(check) : check)
  const end = check.end ?? 0
  const start = check.start ?? 0
  const width = Math.max(1, end - start)
  return (
    <div className="space-y-2">
      {bar && <CoverageBar check={check} filter={filter} />}
      <div className="flex flex-wrap gap-3 text-[11px] text-app-ink/60">
        {GAP_ORDER.map((gap) => (
          <span key={gap} className="inline-flex items-center gap-1">
            <Swatch gap={gap} /> {GAP[gap].label}
          </span>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-app-ink/40">
        <span>{at(start)}</span>
        <span>{at(end)}</span>
      </div>
      {incomplete.map((c) => (
        <div
          key={c.name}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] sm:flex-nowrap"
        >
          {/* A phone gives the bar a line of its own under the name and words. */}
          <span className="min-w-0 max-w-full truncate sm:w-36 sm:shrink-0">
            @{c.name}
          </span>
          <div
            className={`relative order-last h-3 basis-full overflow-hidden rounded sm:order-none sm:basis-auto sm:flex-1 ${TRACK}`}
          >
            {c.stretches.map((s) => (
              <div
                key={`${s.kind}${s.from}`}
                title={`${GAP[stretchGap(c, s)].label}: ${at(s.from)} to ${at(s.to)}`}
                className={`absolute inset-y-0 rounded ${GAP[stretchGap(c, s)].className}`}
                style={{
                  ...gapStyle(stretchGap(c, s)),
                  left: `${Math.min(100, (Math.max(0, s.from - start) / width) * 100)}%`,
                  width: `${Math.max(1, ((Math.min(s.to, end) - Math.max(s.from, start)) / width) * 100)}%`,
                }}
              />
            ))}
            {c.stretches.length === 0 && !c.syncable && (
              <div
                className={`absolute inset-0 rounded ${GAP.stuck.className}`}
                style={gapStyle("stuck")}
              />
            )}
          </div>
          {/* The rows' words, in a fixed column so every bar spans the same
              width and stays comparable. */}
          <span className="ml-auto flex min-w-0 max-w-full items-center justify-end gap-1 sm:w-72 sm:shrink-0">
            <span
              title={`Last sync ${at(c.lastSync)}`}
              className="min-w-0 text-[11px] text-app-ink/60 sm:truncate"
            >
              {shortfall(c, Math.min(end, check.freeze ?? end)) ||
                `synced ${at(c.lastSync)}`}
            </span>
            <Chips
              c={c}
              said={!!shortfall(c, Math.min(end, check.freeze ?? end))}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

function SummaryPanelBody({
  check,
  act = false,
}: {
  check: ArtifactCheck & { showComplete?: boolean }
  act?: boolean
}) {
  const { channels } = useData()
  const rows = rowsOf(check)
  const end = check.end ?? 0
  const caughtUp = (name: string) =>
    (channels.find((c) => c.name === name)?.lastUpdated ?? 0) > end
  if (rows.length === 0)
    return (
      <p className="flex items-center gap-2 text-[13px] text-green-700 dark:text-green-300">
        <CheckCircle2 size={14} /> Complete window: all {check.total} Channels
        were complete through {at(end)}.
      </p>
    )

  return (
    <table className="w-full text-left text-[12px]">
      <thead className="text-app-ink/50 max-sm:hidden">
        <tr>
          <th className="py-1 font-medium">Channel</th>
          <th className="py-1 font-medium">Why</th>
          <th className="hidden py-1 font-medium sm:table-cell">Last sync</th>
          <th className="hidden py-1 font-medium sm:table-cell">Unproven</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-app-ink/5">
        {rows.map((c) => (
          // A phone stacks each row: the name, then why, under it.
          <tr
            key={c.name}
            className="max-sm:flex max-sm:flex-col max-sm:py-1.5"
          >
            <td className="py-1.5 pr-2 max-sm:py-0">
              @{c.name}
              {caughtUp(c.name) && (
                <span className="ml-1 text-[10px] text-green-700 dark:text-green-300">
                  synced since
                </span>
              )}
            </td>
            <td className="py-1.5 pr-2 max-sm:py-0">
              {/* Every reason, so a hole behind "not synced to the end" shows. */}
              <span className="flex flex-wrap gap-1">
                <Chips c={c} said={!!shortfall(c, end)} />
              </span>
              {/* A phone drops the Unproven column, so its text moves here. */}
              <span className="text-app-ink/60 sm:hidden">
                {shortfall(c, end)}
              </span>
              {act && !c.syncable && c.reason && (
                <span className="mt-1 block">
                  <StuckRowActions c={c} />
                </span>
              )}
            </td>
            <td className="hidden py-1.5 pr-2 text-app-ink/60 sm:table-cell">
              {at(c.lastSync)}
            </td>
            <td className="hidden py-1.5 text-app-ink/60 sm:table-cell">
              {shortfall(c, end) || (c.reason ? "" : "complete")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** What "complete only" took out of the selection to keep the window Complete. */
function LeftOut({ names }: { names: string[] }) {
  return (
    <p
      className="mb-4 text-[12px] text-app-ink/60"
      title={names.map((n) => `@${n}`).join("\n")}
    >
      Complete window: {names.length} Incomplete{" "}
      {names.length === 1 ? "Channel was" : "Channels were"} left out of the
      selection (
      {names
        .slice(0, 3)
        .map((n) => `@${n}`)
        .join(", ")}
      {names.length > 3 && ` +${names.length - 3}`}).
    </p>
  )
}

/** Variant 0 renders main: no hooks run, so main's tests need no providers. */
export function ProtoArtifactPanel(
  props: Parameters<typeof ProtoArtifactPanelInner>[0],
) {
  return useVariant() === "0" ? null : <ProtoArtifactPanelInner {...props} />
}

function ProtoArtifactPanelInner({
  artifactId,
  kind,
  scope,
}: {
  artifactId: string | undefined
  kind: ArtifactKind
  /** What a Regenerate puts back before it runs. */
  scope: FrozenScope | null | undefined
}) {
  const v = useVariant()
  const summaryId = artifactId
  const q = useArtifactCheck(artifactId ?? "", kind, v !== "0" && !!artifactId)
  if (v === "0" || !summaryId) return null
  const check = q.data
  if (!check)
    return (
      <p className="mb-3 text-[12px] text-app-ink/40">Checking the window…</p>
    )
  if (!check.checked)
    return (
      <p className="mb-3 text-[12px] text-app-ink/40">
        Window not checked: made before this was recorded.
      </p>
    )
  const incomplete = incompleteOf(check)
  const left = check.excluded ?? []
  if (incomplete.length === 0)
    return left.length ? <LeftOut names={left} /> : null
  return (
    <WindowBanner
      check={check}
      source={{ kind: "artifact", artifactKind: kind, id: summaryId }}
      extra={
        scope &&
        check.start != null &&
        check.end != null && (
          <NowAndRegenerate
            scope={scope}
            kind={kind}
            start={check.start}
            end={check.end}
          />
        )
      }
    />
  )
}

/**
 * One line naming what an Incomplete window lacks, with Details: the bar,
 * Open in a tab, Visualize and the table. An Artifact's frozen window, and in
 * D the live one on the Action and Posts tabs.
 */
function WindowBanner({
  check,
  source,
  extra,
  className = "mb-4",
  hideRoutine = false,
  act = false,
}: {
  check: ArtifactCheck
  source: ChartSource
  /** After the line: the Artifact's re-check and Regenerate. */
  extra?: React.ReactNode
  className?: string
  /**
   * Open on what needs a look: routine lag starts switched off, unless it is
   * all there is (an empty list would greet the person).
   */
  hideRoutine?: boolean
  /** The live window: rows no sync can fix offer what can. */
  act?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [chart, setChart] = useState(false)
  const [rows, setRows] = useState(true)
  const filter = useGapFilter(
    hideRoutine && incompleteOf(check).some((c) => channelGap(c) !== "behind")
      ? ["behind"]
      : [],
  )
  const shown = filter.keep(check)
  const incomplete = incompleteOf(check)
  const note = check.reconstructed ? " (reconstructed from sync logs)" : ""
  return (
    <section
      className={`rounded-xl border px-3 py-2 ${TONE.amber} ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <AlertTriangle size={14} className="shrink-0" />
        <span
          className="font-bold"
          title={`${incomplete.length} of ${check.total} Channels cannot prove they hold every post up to the window's end.`}
        >
          Unproven through {at(check.end)}:{" "}
          {postsPhrase(incomplete, check.posts)} · {measure(incomplete).phrase}
        </span>
        {extra}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="ml-auto text-[11px] underline"
        >
          {open ? "Hide" : "Details"}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-lg bg-app-card p-2 text-app-ink">
          <CoverageBar check={check} filter={filter} />
          <div className="flex flex-wrap justify-end gap-2">
            <OpenInTab source={source} />
            <button
              type="button"
              aria-pressed={chart}
              onClick={() => setChart(!chart)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-app-ink/15 px-2 py-1 text-[11px] font-bold hover:bg-app-ink/5"
            >
              <BarChart3 size={12} />
              {chart ? "Hide chart" : "Visualize"}
            </button>
            <RowsToggle rows={rows} setRows={setRows} />
          </div>
          {rowsOf(shown).length === 0 ? (
            <AllHidden />
          ) : (
            <>
              {chart && <Timeline check={shown} bar={false} />}
              {rows && <SummaryPanelBody check={shown} act={act} />}
            </>
          )}
          {note && (
            <p className="mt-1 text-[10px] text-app-ink/40">{note.trim()}</p>
          )}
        </div>
      )}
    </section>
  )
}

/** The gated action a Regenerate runs, per Artifact kind; a Chat has none. */
const REGENERATE: Record<ArtifactKind, ActionKind | null> = {
  summary: "summary",
  chat: null,
  tag: "tags",
  discovery: "discover",
}

/**
 * The Artifact's window checked again now, as "· now 4", with the full
 * sentence on hover. Regenerate puts its Scope back, opens the Action tab and
 * runs the same action through the gate, which syncs whatever is still
 * behind. It makes a new Artifact, not a successor.
 */
function NowAndRegenerate({
  scope,
  kind,
  start,
  end,
}: {
  scope: FrozenScope
  kind: ArtifactKind
  start: number
  end: number
}) {
  const restore = usePostsViewEdits().restore
  const { workspaceTabs } = useUI()
  const names = scope.channels ?? []
  const q = useLiveCheck(names, start, end, names.length > 0)
  if (!names.length) return null
  if (!q.data)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] opacity-70">
        <span className="hidden sm:inline">·</span>
        <Loader2 size={11} className="animate-spin" /> checking now
      </span>
    )
  const now = incompleteOf(q.data)
  const { fixable, stuck } = byFix(now)
  const action = REGENERATE[kind]
  const run = () => {
    if (!action) return
    restore(scope)
    workspaceTabs.openTab("action")
    // Let the Action tab render the restored Scope before the gate reads it.
    setTimeout(() => {
      pendingAction = true
      beginGate?.(action)
    }, 400)
  }
  const said =
    now.length === 0
      ? "Every Channel is complete for this window now."
      : stuck.length === 0
        ? `Now ${now.length} still Incomplete, and a sync fixes all of them.`
        : fixable.length === 0
          ? `Now ${now.length} still Incomplete, and no sync can fix ${now.length === 1 ? "it" : "them"}.`
          : `Now ${now.length} still Incomplete: a sync fixes ${fixable.length}, ${stuck.length} no sync can.`
  return (
    <>
      <span
        title={said}
        className={`text-[12px] ${now.length === 0 ? "font-bold text-green-700 dark:text-green-300" : ""}`}
      >
        {/* A phone wraps this to a line of its own, where a lone dot dangles. */}
        <span className="hidden sm:inline">· </span>
        {now.length === 0 ? "complete now" : `now ${measure(now).phrase}`}
      </span>
      {/* Nothing a sync can change: a Regenerate would freeze the same gaps.
          A Chat has none; its scope line already offers "Use this Scope". */}
      {action && (fixable.length > 0 || now.length === 0) && (
        <TgButton
          type="button"
          size="sm"
          variant={now.length === 0 ? "primary" : "secondary"}
          onClick={run}
        >
          <RefreshCw size={12} />
          Regenerate
        </TgButton>
      )}
    </>
  )
}

// ---- The Coverage tab ---------------------------------------------------------------

/** Open the timeline in its own tab, for the current Scope or one Artifact. */
function OpenInTab({ source }: { source: ChartSource }) {
  const { workspaceTabs } = useUI()
  return (
    <button
      type="button"
      onClick={() => {
        setChartSource(source)
        workspaceTabs.openTab("coverage")
      }}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-app-ink/15 px-2 py-1 text-[11px] font-bold text-app-ink hover:bg-app-ink/5"
    >
      <ExternalLink size={12} /> Open in a tab
    </button>
  )
}

/** The Coverage tab: the timeline, full width, for whatever opened it last. */
export function CoverageTab() {
  return useVariant() === "0" ? (
    <p className="text-sm text-app-ink/60">
      Coverage is part of the complete-window prototype: switch to A or B.
    </p>
  ) : (
    <CoverageTabInner />
  )
}

function CoverageTabInner() {
  const source = useChartSource()
  const { channels, selectedChannels } = useData()
  const { startDate, endDate } = useScope()
  const names = channels
    .filter((c) => selectedChannels.has(c.name))
    .map((c) => c.name)
  const live = useLiveCheck(names, startDate, endDate, source.kind === "live")
  const artifact = useArtifactCheck(
    source.kind === "artifact" ? source.id : "",
    source.kind === "artifact" ? source.artifactKind : "summary",
    source.kind === "artifact",
  )
  const check =
    source.kind === "live"
      ? live.data
      : artifact.data?.checked
        ? artifact.data
        : undefined
  const title =
    source.kind === "live"
      ? "The current Scope"
      : `${ARTIFACT_LABEL[source.artifactKind]} as it froze`
  return (
    <section className="space-y-4 rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-[13px] font-bold">Coverage: {title}</h2>
        {source.kind === "artifact" && (
          <button
            type="button"
            onClick={() => setChartSource({ kind: "live" })}
            className="ml-auto text-[12px] underline"
          >
            Show the current Scope
          </button>
        )}
      </header>
      {!check ? (
        <p className="flex items-center gap-2 text-[13px] text-app-ink/60">
          <Loader2 size={14} className="animate-spin" /> Checking the window…
        </p>
      ) : incompleteOf(check).length === 0 ? (
        <SummaryPanelBody check={{ checked: true, ...check }} />
      ) : (
        <Timeline check={check} />
      )}
    </section>
  )
}

const ARTIFACT_LABEL: Record<ArtifactKind, string> = {
  summary: "This Summary",
  chat: "This Chat",
  tag: "This Tag run",
  discovery: "This Discovery report",
}
