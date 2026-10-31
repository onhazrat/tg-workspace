import { useQueryClient } from "@tanstack/react-query"
import { Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

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
import { useUI } from "@/contexts/UIContext"
import { queryKeys } from "@/hooks/queryKeys"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { assignChannelsToSettingGroup } from "@/lib/channels/assign-setting-group"
import {
  ACTION_VERB,
  type ActionKind,
  AUTO_SYNC_SECONDS,
  canUnfreeze,
  fixableNames,
  gateTitle,
} from "@/lib/complete-window/gate"
import {
  continueGate,
  type GateFlow,
  type GateIO,
  type GateState,
  gateFlow,
  registerAction,
  runGated,
  takeRequest,
  useGateState,
  useRequested,
} from "@/lib/complete-window/gate-flow"
import {
  behindLag,
  byFix,
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

/**
 * An Action row's handler, run after the gate and never instead of it. It
 * registers as each render commits, so the gate runs the latest one; it
 * should return its promise, so the outcome reaches its submission before
 * the next one can take it.
 */
export function useGated(kind: ActionKind, run: () => unknown) {
  useEffect(() => registerAction(kind, run))
  return () => runGated(kind)
}

/**
 * Open the Action tab and the gate there for this action, as a row's click
 * does, for the palette, a Summary tab's Generate and Regenerate.
 */
export function useRunGated() {
  const { workspaceTabs } = useUI()
  return useCallback(
    (kind: ActionKind) => {
      workspaceTabs.openTab("action")
      runGated(kind)
    },
    [workspaceTabs],
  )
}

/** The page's I/O for the gate's flow. */
function useGateIO(): GateIO {
  const queryClient = useQueryClient()
  const {
    channels,
    selectedChannels,
    setSelectedChannels,
    setChannels,
    loadChannels,
  } = useData()
  const { windowKey, liveTick } = useScope()
  const { scrapeChannelsInParallel } = useSync()
  const { data: groups = [] } = useSettingGroupsQuery()
  const invalidateSettingGroups = useInvalidateSettingGroups()
  const byName = new Map(channels.map((c) => [c.name, c]))
  return {
    names: () => [...selectedChannels].sort(),
    window: () => toWireWindow(windowKey),
    cached: (names) =>
      queryClient.getQueryData<WindowCheck>(
        queryKeys.windowCheck(names, windowKey, liveTick),
      ),
    check: (channelNames, window, frozenAt) =>
      dataWindowCheck({ body: { channelNames, window, frozenAt } }),
    sync: (names, walkBackTo) => {
      const picked = names.flatMap((n) => byName.get(n) ?? [])
      const byId = Object.fromEntries(
        picked
          .filter((c) => walkBackTo[c.name] != null)
          .map((c) => [c.id, walkBackTo[c.name]]),
      )
      return scrapeChannelsInParallel(picked, "Before an action", "bulk", {
        walkBackTo: byId,
      })
    },
    synced: () => invalidatePostsReads(queryClient),
    narrow: (names) => {
      const before = new Set(selectedChannels)
      setSelectedChannels(
        new Set([...before].filter((n) => !names.includes(n))),
      )
      return () => setSelectedChannels(before)
    },
    unfreeze: async (name) => {
      const channel = byName.get(name)
      const home = groups.find((g) => g.isDefault)
      if (!channel || !home) return null
      await assignChannelsToSettingGroup([channel.id], home.id, {
        settingGroups: groups,
        setChannels,
        loadChannels,
        invalidateSettingGroups,
      })
      return home.name
    },
  }
}

// ---- The dialog -------------------------------------------------------------

/** A row's progress while the gate syncs, or a sync in flight it will join. */
function RowStatus({ c, syncing }: { c: Verdict; syncing: boolean }) {
  const { scrapingChannels } = useSync()
  const seen = useRef(false)
  if (syncing && scrapingChannels.has(c.name)) {
    seen.current = true
    return <Loader2 size={13} className="animate-spin text-app-ink/50" />
  }
  if (c.syncingSince != null)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-app-ink/50">
        <Loader2 size={11} className="animate-spin" /> syncing, started{" "}
        {span(Date.now() - c.syncingSince)} ago
        {c.syncAgain && ", another to follow"}
      </span>
    )
  if (!syncing) return null
  return (
    <span className="text-[11px] text-app-ink/40">
      {seen.current ? "synced" : "queued"}
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
  flow: GateFlow
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
          <RowStatus c={c} syncing={syncing.includes(c.name)} />
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
function GroupedRows({ state, flow }: { state: GateState; flow: GateFlow }) {
  const { problems, behind, stuck } = byFix(incompleteOf(state.check))
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
    // A submit button. The gate is a form, so Enter syncs.
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

function Controls({ state, flow }: { state: GateState; flow: GateFlow }) {
  if (state.phase === "syncing")
    return (
      <TgButton type="button" variant="secondary" onClick={continueGate}>
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

/** "with ~6 Posts (67%) unproven", or "with no Posts expected". */
function unprovenSaid(check: WindowCheck) {
  const phrase = postsPhrase(check)
  return check.unprovenPosts === 0 && !check.unprovenFloor
    ? phrase
    : `with ${phrase} unproven`
}

function Review({ state, flow }: { state: GateState; flow: GateFlow }) {
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
        Before {verb.toLowerCase()}, the window ends {stamp(end)}
        {state.check && `, ${unprovenSaid(state.check)}`}.
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
 * The gate (ADR-043), which every Action-tab button that freezes a Scope opens.
 * Mounted once, on the Action tab.
 */
export function Gate() {
  const state = useGateState()
  const flow = gateFlow(useGateIO())
  const requested = useRequested()
  // A request opens the gate on the render that holds it, so a Regenerate
  // reads the Scope it restored in the same click.
  useEffect(() => {
    const kind = requested && takeRequest()
    if (kind) void flow.begin(kind)
  }, [requested])
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
