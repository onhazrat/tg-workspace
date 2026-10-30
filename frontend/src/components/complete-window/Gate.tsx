import { useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

import { api } from "@/api"
import { dataWindowCheck } from "@/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { TgButton } from "@/components/ui/tg-button"
import { useData } from "@/contexts/DataContext"
import { invalidatePostsReads } from "@/contexts/PostsViewContext"
import { useScope } from "@/contexts/ScopeContext"
import { useSync } from "@/contexts/SyncContext"
import { queryKeys } from "@/hooks/queryKeys"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import {
  type BannerSync,
  bannerSync,
  useBannerSync,
} from "@/lib/complete-window/banner-sync"
import {
  ACTION_VERB,
  type ActionKind,
  AUTO_SYNC_SECONDS,
  afterWait,
  type Choice,
  canUnfreeze,
  DEADLINE_MS,
  fixableNames,
  gateGroups,
  gateTitle,
  type Lists,
  leaveOut,
  outcomeOf,
  outcomeToast,
  setGateOutcome,
  syncedSaid,
  syncPlan,
  unfrozen,
  verdictOf,
} from "@/lib/complete-window/gate"
import {
  behindLag,
  incompleteOf,
  postsPhrase,
  shortfall,
  span,
  stamp,
  type Verdict,
  type WindowCheck,
} from "@/lib/complete-window/window-check"
import { toWireWindow } from "@/lib/scope/window"
import { Chips } from "./WindowDetails"

// ---- The gate's state, shared by the rows that open it and the dialog ------

type Phase = "idle" | "checking" | "review" | "syncing"
type WireWindow = ReturnType<typeof toWireWindow>

interface GateState {
  phase: Phase
  kind: ActionKind
  frozenAt: number
  names: string[]
  window?: WireWindow
  check?: WindowCheck
  /** Showing the banner's cached check while the one frozen at the click runs. */
  refreshing: boolean
  /** An edit stopped the countdown: only a click acts now. */
  touched: boolean
  syncing: string[]
  leftOut: string[]
}
const IDLE: GateState = {
  phase: "idle",
  kind: "summary",
  frozenAt: 0,
  names: [],
  refreshing: false,
  touched: false,
  syncing: [],
  leftOut: [],
}
let gate = IDLE
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const setGate = (next: Partial<GateState>) => {
  gate = { ...gate, ...next }
  for (const listener of listeners) listener()
}
const useGateState = () => useSyncExternalStore(subscribe, () => gate)

/** A request to open the gate: a row's click, or Regenerate on an Artifact. */
let requested: ActionKind | null = null
const setRequested = (kind: ActionKind | null) => {
  requested = kind
  for (const listener of listeners) listener()
}
const useRequested = () => useSyncExternalStore(subscribe, () => requested)

/**
 * Each row's handler from its latest render. The gate runs the latest, not the
 * one captured at the click: Leave out and "complete only" narrow the
 * selection first, and an action reads the selection it rendered with.
 */
const latest: Partial<Record<ActionKind, () => unknown>> = {}
/** Whether the open gate still owes its action a run; cancel clears it. */
let owed = false
/** Bumped by every open and cancel, so a check that lands late is dropped. */
let run = 0
let continueNow: (() => void) | null = null

/**
 * Wrap an Action row's handler: it runs after the gate, never instead of it.
 * The handler should return its promise, so the outcome reaches its
 * submission before the next one can take it.
 */
export function useGated() {
  return (kind: ActionKind, real: () => unknown) => {
    latest[kind] = real
    return () => runGated(kind)
  }
}

/** Open the gate for this action, as a row's click does (Regenerate). */
export function runGated(kind: ActionKind) {
  owed = true
  setRequested(kind)
}

// ---- The flow ---------------------------------------------------------------

/** The open gate's window checked, at its moment when given. */
const checkGate = (frozenAt?: number) =>
  dataWindowCheck({
    body: {
      channelNames: gate.names,
      window: gate.window as WireWindow,
      frozenAt,
    },
  })

/** E: the earlier of the window's End and the gate's moment. */
const gateEnd = () => gate.check?.end ?? gate.frozenAt

/** The gate's outcome goes to the action's submission, then the action runs. */
async function finish(choice: Choice, lists: Lists = {}, said?: string) {
  const { kind, frozenAt, check, leftOut } = gate
  setGateOutcome(outcomeOf(choice, frozenAt, check, lists, leftOut))
  setGate({ phase: "idle" })
  const note = outcomeToast(kind, choice, check, said)
  if (note) toast[note.level](note.text)
  await runOwed(kind)
}

async function runOwed(kind: ActionKind) {
  if (!owed) return
  owed = false
  try {
    await latest[kind]?.()
  } finally {
    setGateOutcome(null)
  }
}

/** Open on the banner's answer, marked refreshing, when it has work to show. */
function openOnCached(cached: WindowCheck | undefined) {
  if (cached && fixableNames(cached).length)
    setGate({ phase: "review", check: cached, refreshing: true })
}

/** Cancelled, or the person already chose on the cached answer. */
const superseded = (mine: number) =>
  mine !== run || !["checking", "review"].includes(gate.phase)

/** The check frozen at the click landed: swap it in, or run at once. */
async function onFrozen(check: WindowCheck, mine: number) {
  const frozen = leaveOut(check, gate.leftOut)
  if (superseded(mine)) return
  setGate({ frozenAt: frozen.frozenAt, refreshing: false })
  // An edit on the cached answer stands.
  if (gate.touched) return
  const next = verdictOf(frozen)
  setGate({ check: frozen, phase: next === "review" ? "review" : gate.phase })
  if (next !== "review") await finish(next)
}

function failed(err: unknown, mine: number) {
  if (mine !== run) return
  setGate({ phase: "idle" })
  toast.error(`The window check failed: ${String(err)}`)
}

/**
 * Every sync the gate waits on: the banner's it joins, its own, and another
 * behind a banner sync that read its head before E.
 */
function planJob(
  plan: ReturnType<typeof syncPlan>,
  banner: BannerSync | null,
  scrape: (names: string[]) => Promise<void>,
) {
  const behind = () =>
    (banner?.job ?? Promise.resolve()).then(() => scrape(plan.after))
  return Promise.all([
    plan.join.length ? banner?.job : undefined,
    plan.now.length ? scrape(plan.now) : undefined,
    plan.after.length ? behind() : undefined,
  ])
}

/** Wait for the sync, "Continue now" or the deadline; whether it finished. */
async function waitOrDeadline(job: Promise<unknown>): Promise<boolean> {
  let done = false
  const settled = job.then(
    () => {
      done = true
    },
    () => {
      done = true
    },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    settled,
    new Promise<void>((resolve) => {
      continueNow = resolve
      timer = setTimeout(resolve, DEADLINE_MS)
    }),
  ])
  clearTimeout(timer)
  continueNow = null
  return done
}

function useGateFlow() {
  const queryClient = useQueryClient()
  const { channels, selectedChannels, setSelectedChannels, loadChannels } =
    useData()
  const { windowKey, liveTick } = useScope()
  const { scrapeChannelsInParallel } = useSync()
  const { data: groups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()

  const begin = async (kind: ActionKind) => {
    const names = [...selectedChannels].sort()
    const mine = ++run
    setGate({
      ...IDLE,
      phase: "checking",
      kind,
      names,
      window: toWireWindow(windowKey),
      frozenAt: Date.now(),
    })
    // The banner already checked this Scope: open on its answer at once.
    openOnCached(
      queryClient.getQueryData<WindowCheck>(
        queryKeys.windowCheck(names, windowKey, liveTick),
      ),
    )
    try {
      await onFrozen(await checkGate(), mine)
    } catch (err) {
      failed(err, mine)
    }
  }

  const sync = async () => {
    const wanted = fixableNames(gate.check)
    const byName = new Map(channels.map((c) => [c.name, c]))
    const pick = (names: string[]) => names.flatMap((n) => byName.get(n) ?? [])
    if (pick(wanted).length === 0) {
      toast.info("Channels are still loading. Sync again in a moment.")
      return
    }
    const banner = bannerSync()
    const plan = syncPlan(wanted, banner, gateEnd())
    const source = `Before: ${ACTION_VERB[gate.kind]}`
    setGate({ phase: "syncing", syncing: wanted, refreshing: false })
    const done = await waitOrDeadline(
      planJob(plan, banner, (names) =>
        scrapeChannelsInParallel(pick(names), source),
      ),
    )
    invalidatePostsReads(queryClient)
    const again = leaveOut(await checkGate(gate.frozenAt), gate.leftOut)
    const still = incompleteOf(again)
    setGate({ check: again })
    const { choice, timedOut } = afterWait(done, wanted, still)
    await finish(choice, { timedOut }, syncedSaid(wanted, still))
  }

  const narrow = (names: string[]) => {
    const out = new Set(names)
    const before = new Set(selectedChannels)
    setSelectedChannels(new Set([...before].filter((n) => !out.has(n))))
    return () => setSelectedChannels(before)
  }

  /** Leave these out of the selection, and of the Artifact (Left out). */
  const leave = (names: string[]) => {
    const undo = narrow(names)
    setGate({
      touched: true,
      leftOut: [...gate.leftOut, ...names],
      names: gate.names.filter((n) => !names.includes(n)),
      check: gate.check && leaveOut(gate.check, names),
    })
    toast.info(
      `Left ${names.length === 1 ? `@${names[0]}` : `${names.length} Channels`} out of the selection.`,
      { action: { label: "Undo", onClick: undo } },
    )
  }

  /** Into the Account's default group, as the Channels tab does; nothing else. */
  const unfreeze = async (name: string) => {
    const channel = channels.find((c) => c.name === name)
    const home = groups.find((g) => g.isDefault)
    if (!channel || !home) return
    await api.bulkAssignSettingGroup({
      channelIds: [channel.id],
      settingGroupId: home.id,
    })
    await loadChannels()
    await invalidateSettingGroups()
    if (gate.check)
      setGate({
        touched: true,
        check: {
          ...gate.check,
          channels: gate.check.channels.map((c) =>
            c.name === name ? unfrozen(c) : c,
          ),
        },
      })
    toast.success(
      `Unfroze @${name}: it is in ${home.name} now, so a sync can fix it.`,
    )
  }

  /** Run on the Complete Channels alone; the rest are Left out, with Undo. */
  const completeOnly = async () => {
    const excluded = incompleteOf(gate.check).map((c) => c.name)
    const undo = narrow(excluded)
    // Let the rows render the narrowed selection before the action reads it.
    await new Promise((resolve) => setTimeout(resolve, 150))
    toast.info(
      `Selection narrowed to the ${gate.names.length - excluded.length} complete Channels.`,
      { action: { label: "Undo", onClick: undo } },
    )
    await finish("complete_only", { leftOut: excluded })
  }

  return {
    begin,
    sync,
    leave,
    unfreeze,
    completeOnly,
    skip: () => finish("skipped"),
    cancel: () => {
      run++
      owed = false
      setGate({ phase: "idle" })
    },
  }
}

type Flow = ReturnType<typeof useGateFlow>

// ---- The dialog -------------------------------------------------------------

/** A row's progress while the gate syncs, or a banner sync it will join. */
function RowStatus({ name, syncing }: { name: string; syncing: string[] }) {
  const { scrapingChannels } = useSync()
  const banner = useBannerSync()
  const seen = useRef(false)
  if (syncing.includes(name)) {
    if (scrapingChannels.has(name)) {
      seen.current = true
      return <Loader2 size={13} className="animate-spin text-app-ink/50" />
    }
    return (
      <span className="text-[11px] text-app-ink/40">
        {seen.current ? "synced" : "queued"}
      </span>
    )
  }
  if (!banner?.names.has(name)) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-app-ink/50">
      <Loader2 size={11} className="animate-spin" /> syncing, started{" "}
      {span(Date.now() - banner.startedAt)} ago
    </span>
  )
}

function GateRows({
  rows,
  syncing,
  flow,
  stuck = false,
}: {
  rows: Verdict[]
  syncing: string[]
  flow: Flow
  stuck?: boolean
}) {
  return (
    <ul className="divide-y divide-app-ink/5 rounded-lg border border-app-ink/10">
      {rows.map((c) => (
        <li
          key={c.name}
          data-testid="gate-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]"
        >
          <span className="min-w-[8rem] flex-1 truncate font-medium">
            @{c.name}
          </span>
          <RowStatus name={c.name} syncing={syncing} />
          <span className="shrink-0 text-[11px] text-app-ink/60">
            {shortfall(c) || `synced ${stamp(c.lastSync)}`}
          </span>
          <Chips c={c} />
          {stuck && (
            <span className="inline-flex shrink-0 gap-2 text-[11px] font-bold">
              {canUnfreeze(c) && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => void flow.unfreeze(c.name)}
                >
                  Unfreeze
                </button>
              )}
              <button
                type="button"
                className="underline"
                onClick={() => flow.leave([c.name])}
              >
                Leave out
              </button>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

const Head = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-center justify-between gap-2 px-1 text-[11px] font-bold text-app-ink/70">
    {children}
  </p>
)

/** What a sync can fix, then the ones just behind folded, then the rest. */
function GroupedRows({ state, flow }: { state: GateState; flow: Flow }) {
  const { problems, behind, stuck } = gateGroups(state.check)
  const { syncing } = state
  return (
    <div className="max-h-[50vh] space-y-3 overflow-y-auto">
      {problems.length > 0 && (
        <div className="space-y-1">
          <Head>A sync can fix these · {problems.length}</Head>
          <GateRows rows={problems} syncing={syncing} flow={flow} />
        </div>
      )}
      {behind.length > 0 && (
        <details
          className="space-y-1"
          open={problems.length === 0 && stuck.length === 0}
        >
          <summary className="cursor-pointer px-1 text-[11px] font-bold text-app-ink/70">
            Just behind · {behind.length}, up to {span(behindLag(behind))}
          </summary>
          <GateRows rows={behind} syncing={syncing} flow={flow} />
        </details>
      )}
      {stuck.length > 0 && (
        <div className="space-y-1">
          <Head>
            No sync can fix these · {stuck.length}
            <button
              type="button"
              className="underline"
              onClick={() => flow.leave(stuck.map((c) => c.name))}
            >
              Leave all out
            </button>
          </Head>
          <GateRows rows={stuck} syncing={syncing} flow={flow} stuck />
        </div>
      )}
    </div>
  )
}

/**
 * The sync button, counting down to pressing itself, the countdown filling
 * it. Mounted only while the gate waits, so each review counts afresh; an
 * edit stops it for good.
 */
export function SyncButton({
  count,
  onSync,
  stopped,
}: {
  count: number
  onSync: () => void
  stopped: boolean
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
  const counting = !stopped && count > 0
  return (
    // A submit button: the gate is a form, so Enter syncs.
    <TgButton
      type="submit"
      autoFocus
      disabled={count === 0}
      title={counting ? `Syncs by itself in ${left}s` : undefined}
      className="relative overflow-hidden"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-app-bg/25 transition-[width] duration-1000 ease-linear"
        style={{
          width: counting
            ? `${((AUTO_SYNC_SECONDS - left) / AUTO_SYNC_SECONDS) * 100}%`
            : 0,
        }}
      />
      <RefreshCw size={13} className="relative" />
      <span className="relative">
        Sync {count}
        {counting && ` · ${left}s`}
      </span>
    </TgButton>
  )
}

function Controls({ state, flow }: { state: GateState; flow: Flow }) {
  if (state.phase === "syncing")
    return (
      <TgButton
        type="button"
        variant="secondary"
        onClick={() => continueNow?.()}
      >
        Continue now
      </TgButton>
    )
  const completeCount = state.names.length - incompleteOf(state.check).length
  return (
    <>
      <TgButton type="button" variant="ghost" onClick={flow.cancel}>
        Cancel
      </TgButton>
      <TgButton
        type="button"
        variant="secondary"
        onClick={() => void flow.skip()}
      >
        Continue without syncing
      </TgButton>
      {completeCount > 0 && (
        <TgButton
          type="button"
          variant="secondary"
          onClick={() => void flow.completeOnly()}
        >
          Continue with {completeCount} complete only
        </TgButton>
      )}
      <SyncButton
        count={fixableNames(state.check).length}
        onSync={() => void flow.sync()}
        stopped={state.touched}
      />
    </>
  )
}

/** "with ~6 Posts (67%) unproven", or "no Posts expected". */
const unprovenSaid = (phrase: string) =>
  phrase === "no Posts expected" ? phrase : `with ${phrase} unproven`

function Review({ state, flow }: { state: GateState; flow: Flow }) {
  const verb = ACTION_VERB[state.kind]
  const end = state.check?.end ?? state.frozenAt
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (state.phase === "review") void flow.sync()
      }}
    >
      <DialogTitle>{gateTitle(incompleteOf(state.check))}</DialogTitle>
      <DialogDescription>
        Before {verb.toLowerCase()}: the window ends {stamp(end)},{" "}
        {state.check && unprovenSaid(postsPhrase(state.check))}.
        {state.refreshing && (
          <span className="ml-1 inline-flex items-center gap-1 text-app-ink/50">
            <Loader2 size={11} className="animate-spin" /> refreshing
          </span>
        )}
      </DialogDescription>
      <GroupedRows state={state} flow={flow} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Controls state={state} flow={flow} />
      </div>
    </form>
  )
}

/**
 * The gate (ADR-043): every Action-tab button that freezes a Scope opens it.
 * Mounted once, on the Action tab.
 */
export function Gate() {
  const state = useGateState()
  const flow = useGateFlow()
  const kind = useRequested()
  // A request opens the gate on the render that holds it, so a Regenerate
  // reads the Scope it restored in the same click.
  useEffect(() => {
    if (!kind) return
    setRequested(null)
    void flow.begin(kind)
  }, [kind])
  return (
    <Dialog
      open={state.phase !== "idle"}
      onOpenChange={(open) =>
        !open && state.phase !== "syncing" && flow.cancel()
      }
    >
      <DialogContent className="max-w-xl" data-testid="gate">
        {state.phase === "checking" ? (
          <>
            <DialogTitle>{ACTION_VERB[state.kind]}</DialogTitle>
            <p className="flex items-center gap-2 text-[13px] text-app-ink/70">
              <Loader2 size={14} className="animate-spin" /> Checking the window
              for {state.names.length} Channels…
            </p>
          </>
        ) : (
          <Review state={state} flow={flow} />
        )}
      </DialogContent>
    </Dialog>
  )
}
