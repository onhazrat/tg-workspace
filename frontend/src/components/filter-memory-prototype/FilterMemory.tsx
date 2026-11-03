// PROTOTYPE (filter-memory): never merge. One timeline of every filter and
// selection change on the Channels, Posts, Directory and History tabs. D
// draws it above the tab content, E as three buttons in the app header.
import { getRouteApi } from "@tanstack/react-router"
import { Clock, Redo2, Star, Undo2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useData } from "@/contexts/DataContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import {
  usePostsViewEdits,
  usePostsViewState,
} from "@/contexts/PostsViewContext"
import { useScope } from "@/contexts/ScopeContext"
import { keyboardOn } from "@/lib/keyboard/mode"
import { queryClient } from "@/lib/queryClient"
import { scopedStorage } from "@/lib/storage/scoped"
import { isFixed, tabFromSearch } from "@/lib/workspace-tabs"
import {
  ancestors,
  canStep,
  childAt,
  deleteView,
  describe,
  describeChange,
  describeWindow,
  historyObs,
  isFilterKey,
  isMemoryTab,
  jump,
  kindLabel,
  line,
  parentAt,
  path,
  readTracked,
  recordAction,
  target,
  trackedObs,
  writeTracked,
  type MemoryTab,
  record,
  type SavedView,
  type Snapshot,
  savedViews,
  saveView,
  sliceOf,
  stateKey,
  step,
  storedObs,
  tabHasSelection,
  tabHasWindow,
  useVariant,
} from "./store"
import { hush, installServerUndo, onAction, run } from "./server-undo"

const workspaceRoute = getRouteApi("/_tg/")

/** In the app header, on every tab: E's filters and selections, F's everything. Never in 0. */
export function FilterMemory({ tab }: { tab: string }) {
  const variant = useVariant()
  if (variant === "E") return <TimelineBar key="E" tab={tab} lineKey="all" />
  if (variant === "F")
    return <TimelineBar key="F" tab={tab} lineKey="everything" />
  return null
}

/** E: records the four tabs' states; nothing to record on the others. */
function Recorder({ tab }: { tab: MemoryTab }) {
  useRecorder(useCurrent(tab), "all")
  return null
}

/** F: records the whole workspace, whichever tab is open. */
function EverythingRecorder() {
  const search = workspaceRoute.useSearch() as Record<string, unknown>
  const { workspaceTabs } = useUI()
  const { selectedChannels } = useData()
  const { windowKey } = useScope()
  const { view } = usePostsViewState()
  const ticks = useTicks()
  const settings = useSettings() as unknown as Record<string, unknown>
  trackedObs.use()
  const { variant: _, ...url } = search
  const ui = {
    ...readTracked(),
    ...Object.fromEntries(VIEW_PREFS.map((p) => [`pref:${p}`, settings[p]])),
  }
  useRecorder(
    {
      tab: String(search.tab ?? "channels"),
      params: {},
      url,
      tabs: [...workspaceTabs.tabs],
      selection: [...selectedChannels].sort(),
      window: windowKey,
      picks: view.selection,
      ticks: [...ticks].sort(),
      ui,
      at: Date.now(),
    },
    "everything",
  )
  return null
}

function TimelineBar({ tab, lineKey }: { tab: string; lineKey: string }) {
  const apply = useApply()
  historyObs.use()
  storedObs.use()
  const everything = lineKey === "everything"
  const travel = useTravel(lineKey, apply)
  useEffect(() => {
    if (!everything) return
    installServerUndo()
    onAction((a) => recordAction(lineKey, a))
    return () => onAction(null)
  }, [everything, lineKey])
  const back = () => {
    if (everything) return void travel(undoTarget(lineKey, -1))
    const snap = step(lineKey, -1)
    if (snap) apply(snap)
  }
  const forward = () => {
    if (everything) return void travel(undoTarget(lineKey, 1))
    const snap = step(lineKey, 1)
    if (snap) apply(snap)
  }
  const go = (i: number) =>
    everything ? void travel(i) : apply(jump(lineKey, i))
  useUndoKeys(back, forward)
  useClearedToast()
  const l = line(lineKey)
  return (
    <>
      {lineKey === "everything" ? (
        <EverythingRecorder />
      ) : (
        isMemoryTab(tab) && <Recorder key={tab} tab={tab} />
      )}
      <Timeline
        tab={tab}
        lineKey={lineKey}
        back={back}
        forward={forward}
        go={go}
        apply={apply}
        current={l.entries[l.cursor]}
      />
    </>
  )
}

/** View preferences a click changes: `pref:<name>` in a snapshot, put back by `set<Name>`. */
const VIEW_PREFS = [
  "showChannelBio",
  "showChannelSubscribers",
  "showChannelTelegramChatId",
  "showChannelPhotos",
  "showChannelVideos",
  "showChannelFiles",
  "showChannelLinks",
  "showChannelStartId",
  "channelCardZoom",
  "channelGridGroupBySelection",
  "directorySelectedFirst",
  "discoverSortKey",
  "discoverMinTotal",
  "discoverFollowState",
  "linkPreviews",
  "summaryTextSize",
  "citationStyle",
  "workspaceFocusMode",
  "theme",
  "timeZone",
]

/**
 * F's undo and redo pass over rows that cannot be undone (a sync, an AI run)
 * and land one row past them, so a press always takes something back.
 */
function undoTarget(key: string, by: number): number {
  const l = line(key)
  const irreversible = (i: number) =>
    !!l.entries[i]?.action && !l.entries[i].action?.undo
  if (by < 0) {
    let at = l.cursor
    while (at >= 0 && irreversible(at)) at = parentAt(key, at)
    return at < 0 ? -1 : parentAt(key, at)
  }
  let to = target(key, 1)
  while (to >= 0 && irreversible(to)) to = childAt(key, to)
  return to
}

/**
 * F: goes to row `to`, undoing each server write on the way up to the shared
 * ancestor and sending each one again on the way down, then puts that row's
 * view back. Writes that cannot be undone are skipped, and a toast says so.
 */
function useTravel(key: string, apply: (s: Snapshot) => void) {
  return async (to: number) => {
    if (to < 0) return
    const l = line(key)
    const { up, down } = path(key, to)
    const skipped: string[] = []
    const failed: string[] = []
    let sent = false
    for (const [rows, way] of [
      [up, "undo"],
      [down, "redo"],
    ] as const)
      for (const i of rows) {
        const a = l.entries[i]?.action
        if (!a) continue
        if (!a.undo) {
          skipped.push(a.label)
          continue
        }
        try {
          await run(way === "undo" ? a.undo : a.redo)
          sent = true
        } catch {
          failed.push(a.label)
        }
      }
    hush()
    apply(jump(key, to))
    if (sent) void queryClient.invalidateQueries()
    if (skipped.length)
      toast(`Can't undo, skipped: ${skipped.join(", ")}`, {
        id: "proto-skipped",
      })
    if (failed.length)
      toast.error(`The server refused: ${failed.join(", ")}`, {
        id: "proto-failed",
      })
  }
}

/** From C: clearing the Channel selection offers it back, as the app's other Undo toasts do. */
function useClearedToast() {
  const { selectedChannels, setSelectedChannels } = useData()
  const previous = useRef(selectedChannels)
  useEffect(() => {
    const before = previous.current
    previous.current = selectedChannels
    if (before.size === 0 || selectedChannels.size > 0) return
    toast(`Selection cleared (${before.size} Channels)`, {
      id: "proto-selection-cleared",
      action: {
        label: "Undo",
        onClick: () => setSelectedChannels(new Set(before)),
      },
    })
  }, [selectedChannels])
}

const TICKS_KEY = "directory.ticks"
const readTicks = (): string[] => {
  try {
    return JSON.parse(scopedStorage.getItem(TICKS_KEY) ?? "[]") as string[]
  } catch {
    return []
  }
}

/** The Directory's ticks, re-read whenever the Directory writes them. */
function useTicks(): string[] {
  const [ticks, setTicks] = useState(readTicks)
  useEffect(() => {
    const onStored = (e: Event) => {
      if ((e as CustomEvent).detail === TICKS_KEY) setTicks(readTicks())
    }
    window.addEventListener("proto:stored", onStored)
    return () => window.removeEventListener("proto:stored", onStored)
  }, [])
  return ticks
}

function useCurrent(tab: MemoryTab): Snapshot {
  const search = workspaceRoute.useSearch() as Record<string, unknown>
  const { selectedChannels } = useData()
  const { windowKey } = useScope()
  const { view } = usePostsViewState()
  const ticks = useTicks()
  return {
    tab,
    params: sliceOf(search, tab),
    selection: tabHasSelection(tab) ? [...selectedChannels].sort() : null,
    window: tabHasWindow(tab) ? windowKey : null,
    picks: tab === "posts" ? view.selection : null,
    ticks: tab === "directory" ? [...ticks].sort() : null,
    at: Date.now(),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 60))

/** Puts a snapshot back: its tab, its filter and, where it has one, its selection. */
function useApply() {
  const navigate = workspaceRoute.useNavigate()
  const { setSelectedChannels } = useData()
  const scope = useScope()
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const { replaceSelection } = usePostsViewEdits()
  const { workspaceTabs } = useUI()
  const settings = useSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  return (snap: Omit<Snapshot, "at">) => {
    if (snap.tabs) {
      const url = (snap.url ?? {}) as Parameters<typeof tabFromSearch>[0]
      workspaceTabs.restore({
        set: {
          ...workspaceTabs.snapshot().set,
          tabs: snap.tabs.filter((t) => !isFixed(t.kind)),
        },
        active: tabFromSearch(url),
      })
    }
    if (snap.url)
      navigate({
        search: (prev) =>
          ({
            variant: (prev as Record<string, unknown>).variant,
            ...snap.url,
          }) as typeof prev,
        replace: true,
      })
    else
      navigate({
        search: (prev) => {
          const next: Record<string, unknown> = { ...prev, tab: snap.tab }
          for (const key of Object.keys(next))
            if (isFilterKey(snap.tab as MemoryTab, key) || key === "dirPage")
              delete next[key]
          return { ...next, ...snap.params } as typeof prev
        },
        replace: true,
      })
    if (snap.selection) setSelectedChannels(new Set(snap.selection))
    if (snap.ui) {
      const prefs = settingsRef.current as unknown as Record<string, unknown>
      writeTracked(snap.ui)
      for (const [key, value] of Object.entries(snap.ui)) {
        if (!key.startsWith("pref:")) continue
        const name = key.slice(5)
        const set = prefs[`set${name[0].toUpperCase()}${name.slice(1)}`]
        if (
          typeof set === "function" &&
          JSON.stringify(prefs[name]) !== JSON.stringify(value)
        )
          set(value)
      }
    }
    if (snap.picks) replaceSelection(snap.picks)
    if (snap.ticks)
      window.dispatchEvent(
        new CustomEvent("proto:restore", {
          detail: { key: TICKS_KEY, value: snap.ticks },
        }),
      )
    const w = snap.window
    if (w && JSON.stringify(w) !== JSON.stringify(scope.windowKey)) {
      if (w.mode === "fixed") scope.setFixedRange(w.start, w.end)
      // ponytail: the Scope reads its state from a ref set on render, so a
      // live window goes back one field per render; a setter taking a whole
      // WindowState would do it at once.
      else
        void (async () => {
          scopeRef.current.setMode("live")
          await tick()
          scopeRef.current.applyValue("duration", w.durationMs)
          await tick()
          scopeRef.current.applyValue("endGap", w.endGapMs)
        })()
    }
  }
}

/** Every settled state goes to the timeline. */
function useRecorder(current: Snapshot, lineKey: string) {
  const key = stateKey(current)
  const latest = useRef(current)
  latest.current = current
  useEffect(() => {
    const t = setTimeout(() => {
      const snap = { ...latest.current, at: Date.now() }
      // The timeline skips a tab's state it already holds, so switching tabs is no entry.
      if (lineKey === "everything") return record(lineKey, snap)
      const all = line("all")
      const lastOfTab = ancestors("all")
        .map((i) => all.entries[i])
        .find((e) => e.tab === snap.tab)
      if (!lastOfTab || stateKey(lastOfTab) !== stateKey(snap))
        record("all", snap)
    }, 700)
    return () => clearTimeout(t)
  }, [key])
}

function useUndoKeys(undo: () => void, redo: () => void) {
  const handlers = useRef({ undo, redo })
  handlers.current = { undo, redo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest("input, textarea, select, [contenteditable='true']"))
        return
      e.preventDefault()
      if (e.shiftKey) handlers.current.redo()
      else handlers.current.undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

const button =
  "inline-flex items-center gap-1 rounded-md border border-app-ink/15 px-2 py-1 hover:border-app-ink/40 disabled:opacity-30 disabled:hover:border-app-ink/15"
const icon =
  "inline-flex items-center gap-1 rounded-md border border-app-ink/10 p-1.5 hover:border-app-ink/40 disabled:opacity-30 disabled:hover:border-app-ink/10"

type Row =
  | { kind: "saved"; v: SavedView }
  | { kind: "entry"; e: Snapshot; i: number }

/** The parts a saved view may hold besides its filter, which it always holds. */
const PARTS = ["tabs", "selection", "window", "picks", "ticks"] as const
type Part = (typeof PARTS)[number]
function partLabel(part: Part, e: Snapshot): string {
  if (part === "tabs") return `open tabs (${e.tabs?.length})`
  if (part === "selection") return `Channel selection (${e.selection?.length})`
  if (part === "window")
    return `window (${e.window ? describeWindow(e.window) : ""})`
  if (part === "picks") return `Post selection (${e.picks?.length} steps)`
  return `Directory ticks (${e.ticks?.length})`
}

const typing = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest("input, textarea, select, [contenteditable='true']")

function Timeline({
  tab,
  lineKey,
  back,
  forward,
  go,
  apply,
  current,
}: {
  tab: string
  lineKey: string
  back: () => void
  forward: () => void
  go: (i: number) => void
  apply: (s: Snapshot) => void
  current: Snapshot | undefined
}) {
  const everything = lineKey === "everything"
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  // From B: the drawer narrowed to the open tab.
  const [onlyTab, setOnlyTab] = useState(false)
  // From C: a save names the view and picks what it holds besides the filter.
  const [saving, setSaving] = useState<{
    i: number
    name: string
    parts: Part[]
  } | null>(null)
  const l = line(lineKey)
  const narrowed = onlyTab && (everything || isMemoryTab(tab))
  const saved = savedViews().filter((v) => !narrowed || v.tab === tab)
  const rows: Row[] = [
    ...saved.map((v) => ({ kind: "saved" as const, v })),
    ...l.entries
      .map((e, i) => ({ kind: "entry" as const, e, i }))
      .reverse()
      .filter((r) => !narrowed || r.e.tab === tab),
  ]
  const cursorRow = Math.max(
    0,
    rows.findIndex((r) => r.kind === "entry" && r.i === l.cursor),
  )
  const onPath = new Set(ancestors(lineKey))

  const activate = (row: Row | undefined) => {
    if (!row) return
    if (row.kind === "saved") {
      apply(row.v)
      setOpen(false)
    } else go(row.i)
  }
  const star = (row: Row | undefined) => {
    if (row?.kind === "entry") setSaving({ i: row.i, name: "", parts: [] })
  }
  const save = () => {
    if (!saving?.name.trim()) return
    const e = l.entries[saving.i]
    const view = { ...e }
    for (const part of PARTS)
      if (!saving.parts.includes(part)) view[part] = null
    saveView(view, saving.name.trim())
    setSaving(null)
    // The new saved row lands above the timeline; keep the highlight on this row.
    setHi((h) => h + 1)
  }
  const openDrawer = () => {
    setHi(cursorRow)
    setOpen(true)
  }

  // h opens and closes the drawer, u / U step back and forward (keyboard mode);
  // in the drawer j / k move, Enter goes there, s saves the row, t narrows to this tab.
  const live = { open, hi, rows, back, forward, activate, star, openDrawer }
  const keys = useRef(live)
  keys.current = live
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const k = keys.current
      if (!k.open) {
        if (!keyboardOn()) return
        if (e.key === "h") k.openDrawer()
        else if (e.key === "u") k.back()
        else if (e.key === "U") k.forward()
        else return
        e.preventDefault()
        return
      }
      const move = (by: number) =>
        setHi(Math.max(0, Math.min(k.rows.length - 1, k.hi + by)))
      if (e.key === "j" || e.key === "ArrowDown") move(1)
      else if (e.key === "k" || e.key === "ArrowUp") move(-1)
      else if (e.key === "Enter") k.activate(k.rows[k.hi])
      else if (e.key === "s") k.star(k.rows[k.hi])
      else if (e.key === "t") {
        setOnlyTab((v) => !v)
        setHi(0)
      } else if (e.key === "h") setOpen(false)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])
  useEffect(() => {
    if (open)
      document
        .querySelector(`[data-proto-row="${hi}"]`)
        ?.scrollIntoView({ block: "nearest" })
  }, [open, hi])

  const ring = (index: number) =>
    index === hi ? "ring-2 ring-fuchsia-500/70" : ""
  const here = current ? describe(current) : "Nothing recorded yet"
  const allSaved = savedViews().length
  const controls = (
    <div className="flex items-center gap-1.5 font-mono text-xs">
      <button
        type="button"
        className={icon}
        onClick={back}
        disabled={!canStep(lineKey, -1)}
        aria-label="Undo"
        title="Undo (⌘Z, or u in keyboard mode)"
      >
        <Undo2 size={14} />
      </button>
      <button
        type="button"
        className={icon}
        onClick={forward}
        disabled={!canStep(lineKey, 1)}
        aria-label="Redo"
        title="Redo (⌘⇧Z, or U in keyboard mode)"
      >
        <Redo2 size={14} />
      </button>
      <button
        type="button"
        className={icon}
        onClick={openDrawer}
        aria-label="Timeline"
        title={`${current ? `${kindLabel(current.tab)}: ` : ""}${here}\nTimeline (h in keyboard mode)`}
      >
        <Clock size={14} />
        <span className="px-0.5">{l.entries.length}</span>
        {allSaved > 0 && (
          <>
            <Star size={12} />
            <span className="pr-0.5">{allSaved}</span>
          </>
        )}
      </button>
    </div>
  )

  const saveForm = (e: Snapshot) =>
    saving && (
      <form
        className="mt-1 space-y-2 rounded-md border border-app-ink/20 p-2"
        onSubmit={(ev) => {
          ev.preventDefault()
          save()
        }}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: prototype
          autoFocus
          value={saving.name}
          onChange={(ev) => setSaving({ ...saving, name: ev.target.value })}
          placeholder="Name this view"
          className="w-full rounded-md border border-app-ink/20 bg-app-bg px-2 py-1"
        />
        <p className="text-app-ink/50">
          {everything
            ? "Holds the URL (the tab and every filter), and also:"
            : "Holds the filter, and also:"}
        </p>
        {PARTS.filter((part) => e[part]).map((part) => (
          <label key={part} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={saving.parts.includes(part)}
              onChange={(ev) =>
                setSaving({
                  ...saving,
                  parts: ev.target.checked
                    ? [...saving.parts, part]
                    : saving.parts.filter((p) => p !== part),
                })
              }
            />
            {partLabel(part, e)}
          </label>
        ))}
        <div className="flex gap-2">
          <button type="submit" className={button}>
            Save
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setSaving(null)}
          >
            Cancel
          </button>
        </div>
      </form>
    )

  return (
    <>
      {controls}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto font-mono text-xs sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {everything ? "Everything you did" : "Filters and selections"}
            </SheetTitle>
            <p className="text-[10px] text-app-ink/50">
              j / k move · Enter go there · s save · t this tab · h or Esc close
            </p>
            <div className="flex gap-1 pt-1">
              {[false, true].map((only) => (
                <button
                  key={String(only)}
                  type="button"
                  disabled={only && !everything && !isMemoryTab(tab)}
                  onClick={() => {
                    setOnlyTab(only)
                    setHi(0)
                  }}
                  className={`${button} ${onlyTab === only ? "border-app-ink bg-app-ink text-app-bg" : ""}`}
                >
                  {only ? `${kindLabel(tab)} only` : "Every tab"}
                </button>
              ))}
            </div>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <section className="space-y-1">
              <h3 className="text-[10px] text-app-ink/50">Saved</h3>
              {saved.length === 0 && (
                <p className="text-app-ink/40">
                  Star a timeline row (or press s on it) to keep it.
                </p>
              )}
              {saved.map((v, index) => (
                <div key={v.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    data-proto-row={index}
                    className={`flex-1 rounded-md border border-app-ink/10 px-2 py-1.5 text-left hover:border-app-ink/40 ${ring(index)}`}
                    onClick={() => activate({ kind: "saved", v })}
                  >
                    <span className="font-bold">{v.name}</span>{" "}
                    <span className="text-app-ink/50">
                      {kindLabel(v.tab)} · {describe(v)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${v.name}`}
                    onClick={() => deleteView(v.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </section>
            <section className="space-y-1">
              <h3 className="text-[10px] text-app-ink/50">
                Timeline, newest first · kept across reloads · a change after an
                undo branches, nothing is dropped · faded rows are off your
                current path
              </h3>
              {rows.map((row, index) => {
                if (row.kind !== "entry") return null
                const { e, i } = row
                return (
                  <div key={`${i}-${e.at}`}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-proto-row={index}
                        className={`flex-1 rounded-md border px-2 py-1.5 text-left ${i === l.cursor ? "border-app-ink" : "border-app-ink/10 hover:border-app-ink/40"} ${onPath.has(i) ? "" : "opacity-50"} ${ring(index)}`}
                        onClick={() => activate(row)}
                      >
                        <span className="font-bold">{kindLabel(e.tab)}</span>{" "}
                        {e.action ? (
                          <>
                            {e.action.label}
                            {!e.action.undo && (
                              <span className="ml-1 rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-400">
                                can't undo
                              </span>
                            )}
                          </>
                        ) : everything ? (
                          describeChange(l.entries[e.parent ?? i - 1], e)
                        ) : (
                          describe(e)
                        )}
                        <span className="block text-app-ink/40">
                          #{i + 1} · {ago(e.at)}
                          {(e.parent ?? i - 1) !== i - 1 &&
                            (e.parent ?? -1) >= 0 &&
                            ` · branched from #${(e.parent ?? 0) + 1}`}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Save this state"
                        onClick={() => star(row)}
                      >
                        <Star size={14} />
                      </button>
                    </div>
                    {saving?.i === i && saveForm(e)}
                  </div>
                )
              })}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function ago(at: number): string {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
