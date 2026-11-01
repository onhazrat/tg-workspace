/**
 * The gate's flow (ADR-043, CW-02), a snapshot of one action frozen at its
 * click, and the steps from there to the action running. Module state, as
 * `banner-sync.ts` is, because the click that opens it (an Action row, the
 * palette, Regenerate) and the dialog that shows it are far apart; it holds
 * no server cache, only what this one gate is doing. The rules each step
 * applies are `gate.ts`'s; the component injects the I/O.
 */

import { useSyncExternalStore } from "react"
import { toast } from "sonner"

import type { toWireWindow } from "@/lib/scope/window"
import {
  type ActionKind,
  afterWait,
  DEADLINE_MS,
  fixableOf,
  type GateChoice,
  type OutcomeNames,
  outcomeOf,
  setGateOutcome,
  syncedSaid,
  syncPlan,
  verdictOf,
  type WaitEnd,
  walkBack,
  withEdits,
} from "./gate"
import { type Change, merged, touched } from "./live"
import { incompleteOf, type WindowCheck } from "./window-check"

export type WireWindow = ReturnType<typeof toWireWindow>
type Phase = "idle" | "checking" | "review" | "syncing"

export interface GateState {
  phase: Phase
  kind: ActionKind
  frozenAt: number
  names: string[]
  window?: WireWindow
  check?: WindowCheck
  /** Showing the banner's cached check while the one frozen at the click runs. */
  refreshing: boolean
  /** An edit stopped the countdown, so only a choice acts now. */
  touched: boolean
  /** The Channels the gate's own Sync waits on. */
  syncing: string[]
  leftOut: string[]
  unfrozen: string[]
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
  unfrozen: [],
}

let state = IDLE
/** A request to open the gate, from a row's click, the palette or Regenerate. */
let requested: ActionKind | null = null
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const setGate = (next: Partial<GateState>) => {
  state = { ...state, ...next }
  notify()
}

export const useGateState = () => useSyncExternalStore(subscribe, () => state)
export const useRequested = () =>
  useSyncExternalStore(subscribe, () => requested)

/** The Action rows' handlers, registered as each render commits. */
const handlers: Partial<Record<ActionKind, () => unknown>> = {}

/** Register an Action row's handler; answers its unregister. */
export function registerAction(kind: ActionKind, run: () => unknown) {
  handlers[kind] = run
  return () => {
    if (handlers[kind] === run) delete handlers[kind]
  }
}

/** Whether the open gate still owes its action a run; cancel clears it. */
let owed = false
/** Bumped by every open and cancel, so a check that lands late is dropped. */
let run = 0
/** Ends the wait on the syncs early, as "Continue now". */
let continueNow: (() => void) | null = null
/**
 * Each wait for the next merged change. Module state, as the listener is:
 * the page builds the flow again on every render.
 */
const merges = new Set<() => void>()
/** Resolved by the next merge of a change, or by `stop`. */
const nextMerge = (stop: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      merges.delete(done)
      resolve()
    }
    merges.add(done)
    stop.addEventListener("abort", done, { once: true })
  })
/** Stops the open gate hearing which Channels a sync changed. */
let unlisten: (() => void) | null = null
const stopListening = () => {
  unlisten?.()
  unlisten = null
}

/** Open the gate for this action, as a row's click does. */
export function runGated(kind: ActionKind) {
  owed = true
  requested = kind
  notify()
}

/** The request the gate takes, once. */
export function takeRequest(): ActionKind | null {
  const kind = requested
  requested = null
  return kind
}

export const continueGate = () => continueNow?.()

/** What the flow asks of the page, the Scope, the server and the selection. */
export interface GateIO {
  names: () => string[]
  window: () => WireWindow
  /** The banner's check of this Scope, when it already has one. */
  cached: (names: string[]) => WindowCheck | undefined
  check: (
    names: string[],
    window: WireWindow,
    frozenAt?: number,
  ) => Promise<WindowCheck>
  /** The gate's own sync, walking back per Channel name where asked. */
  sync: (names: string[], walkBackTo: Record<string, number>) => Promise<void>
  /** After the wait, so what a sync added shows. */
  synced: () => void
  /** Hear which Channels a sync just changed; answers the unsubscribe. */
  changes: (listener: (change: Change) => void) => () => void
  /** Narrow the selection; answers the Undo. */
  narrow: (names: string[]) => () => void
  /** Into the default group; answers that group's name, or null. */
  unfreeze: (name: string) => Promise<string | null>
}

/** The check as the gate shows it, its own edits laid over. */
const edited = (check: WindowCheck) => withEdits(check, state)

/** The gate's outcome goes to the action's submission, then the action runs. */
async function finish(choice: GateChoice, named: OutcomeNames = {}, said = "") {
  const { kind, frozenAt, check, leftOut } = state
  setGateOutcome(outcomeOf(choice, frozenAt, check, named, leftOut))
  stopListening()
  setGate({ phase: "idle" })
  if (said) toast.success(said)
  if (!owed) return
  owed = false
  try {
    await handlers[kind]?.()
  } finally {
    setGateOutcome(null)
  }
}

/** Cancelled, or the person already chose on the cached answer. */
const superseded = (mine: number) =>
  mine !== run || !["checking", "review"].includes(state.phase)

/**
 * The check frozen at the click landed: it replaces the cached one, edits
 * kept, and runs the action at once when there is nothing to review. An edit
 * stops only the countdown and that run; only a choice stops the swap.
 */
async function onFrozen(check: WindowCheck, mine: number) {
  if (superseded(mine)) return
  const frozen = edited(check)
  setGate({ frozenAt: frozen.frozenAt, refreshing: false, check: frozen })
  if (state.touched) return
  const next = verdictOf(frozen)
  if (next === "review") setGate({ phase: "review" })
  else await finish(next)
}

/** Wait for the syncs, "Continue now" or the deadline: how it ended. */
async function waitOrDeadline(job: Promise<unknown>): Promise<WaitEnd> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const end = await Promise.race([
    job.then(
      () => "synced" as const,
      () => "synced" as const,
    ),
    new Promise<WaitEnd>((resolve) => {
      continueNow = () => resolve("continued")
      timer = setTimeout(() => resolve("deadline"), DEADLINE_MS)
    }),
  ])
  clearTimeout(timer)
  continueNow = null
  return end
}

/** The flow's steps over the page's I/O; each reads the gate as it is now. */
export function gateFlow(io: GateIO) {
  const recheck = async () =>
    edited(
      await io.check(state.names, state.window as WireWindow, state.frozenAt),
    )

  /**
   * A sync changed some of the gate's Channels (WR-02): ask the check for
   * those alone, as frozen at the click, and merge their rows.
   */
  const onChange = async (change: Change) => {
    const names = touched(change, state.names)
    if (!names.length) return
    const fresh = await io
      .check(names, state.window as WireWindow, state.frozenAt)
      .catch(() => undefined)
    if (fresh && state.check)
      setGate({ check: edited(merged(state.check, fresh)) })
    for (const done of [...merges]) done()
  }

  /** Until the check shows none of `names` still syncing, or `stop`. */
  const landed = async (names: string[], stop: AbortSignal) => {
    while (
      !stop.aborted &&
      state.check?.channels.some(
        (c) => names.includes(c.name) && c.syncingSince,
      )
    )
      await nextMerge(stop)
  }

  const begin = async (kind: ActionKind) => {
    const names = io.names()
    const window = io.window()
    const mine = ++run
    setGate({
      ...IDLE,
      phase: "checking",
      kind,
      names,
      window,
      frozenAt: Date.now(),
    })
    // Listening before the check, so a sync landing between them is heard,
    // until the gate finishes or is cancelled.
    stopListening()
    unlisten = io.changes(onChange)
    // The banner already checked this Scope: open on its answer at once.
    const cached = io.cached(names)
    if (cached && fixableOf(cached).length)
      setGate({ phase: "review", check: cached, refreshing: true })
    try {
      await onFrozen(await io.check(names, window), mine)
    } catch (err) {
      if (mine !== run) return
      stopListening()
      setGate({ phase: "idle" })
      toast.error(`The window check failed (${String(err)}).`)
    }
  }

  /**
   * Sync what a sync can fix, planned on the syncs in flight right now: join
   * them, queue behind those that read their head before E, sync the rest.
   */
  const sync = async () => {
    setGate({ phase: "syncing", refreshing: false })
    const now = await recheck().catch(() => state.check as WindowCheck)
    const wanted = fixableOf(now)
    const plan = syncPlan(wanted)
    const back = walkBack(wanted, now.start)
    setGate({ check: now, syncing: wanted.map((c) => c.name) })
    const stop = new AbortController()
    const job = Promise.all([
      plan.atOnce.length ? io.sync(plan.atOnce, back) : undefined,
      landed(plan.join, stop.signal),
      landed(plan.after, stop.signal).then(() =>
        !stop.signal.aborted && plan.after.length
          ? io.sync(plan.after, back)
          : undefined,
      ),
    ])
    const end = await waitOrDeadline(job)
    stop.abort()
    io.synced()
    const again = await recheck()
    setGate({ check: again })
    const names = wanted.map((c) => c.name)
    const { choice, timedOut } = afterWait(end, names, again)
    await finish(choice, { timedOut }, syncedSaid(names, incompleteOf(again)))
  }

  /** Leave these out of the selection, and of the Artifact (Left out). */
  const leave = (names: string[]) => {
    const undo = io.narrow(names)
    setGate({
      touched: true,
      leftOut: [...state.leftOut, ...names],
      names: state.names.filter((n) => !names.includes(n)),
    })
    if (state.check) setGate({ check: edited(state.check) })
    toast.info(
      `Left ${names.length === 1 ? `@${names[0]}` : `${names.length} Channels`} out of the selection.`,
      { action: { label: "Undo", onClick: undo } },
    )
  }

  /** Into the Account's default group, as the Channels tab does; nothing else. */
  const unfreeze = async (name: string) => {
    const group = await io.unfreeze(name)
    if (group === null) return
    setGate({ touched: true, unfrozen: [...state.unfrozen, name] })
    if (state.check) setGate({ check: edited(state.check) })
    toast.success(
      `Unfroze @${name}. It is in ${group} now, so a sync can fix it.`,
    )
  }

  /**
   * Run on the Complete Channels alone, with Undo. The server takes Left out
   * out of the Scope, so the action needs no wait for the narrowed selection.
   */
  const completeOnly = async () => {
    const leftOut = incompleteOf(state.check).map((c) => c.name)
    const undo = io.narrow(leftOut)
    toast.info(
      `Selection narrowed to the ${state.names.length - leftOut.length} complete Channels.`,
      { action: { label: "Undo", onClick: undo } },
    )
    await finish("complete_only", { leftOut })
  }

  const cancel = () => {
    run++
    owed = false
    stopListening()
    setGate({ phase: "idle" })
  }

  return {
    begin,
    sync,
    leave,
    unfreeze,
    completeOnly,
    skip: () => finish("skipped"),
    cancel,
  }
}

export type GateFlow = ReturnType<typeof gateFlow>
