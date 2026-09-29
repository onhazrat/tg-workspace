import { getRouteApi } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { VALID_TABS } from "@/constants"
import { useArtifactTabLookup } from "@/hooks/useArtifacts"
import { scopedStorage } from "@/lib/storage/scoped"
import {
  type ArtifactTabKind,
  close,
  create,
  emptyTabSet,
  goTo,
  isFixed,
  open,
  reconcile,
  reopenLast,
  type Step,
  sameTab,
  strip,
  type Tab,
  type TabSet,
  tabFromSearch,
  tabKey,
  tabSearch,
  visit,
} from "@/lib/workspace-tabs"
import type { TabType } from "@/types"

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * Per account (through `scopedStorage`) and per device, like every preference.
 *
 * Not a schema setting: the open set is the current selection, which the
 * browser keeps as state of its own, like `hasSeenTour`. It has no default a
 * user picks, no catalog entry, and nothing for the backend to mirror.
 */
const STORAGE_KEY = "workspaceTabs"

/**
 * The stored open set, or the default one.
 *
 * Folded through `open` so a hand-edited or stale value cannot break the
 * model's invariants: unknown kinds, Fixed tabs and duplicates fall out.
 */
function loadTabSet(): TabSet {
  try {
    const raw = JSON.parse(scopedStorage.getItem(STORAGE_KEY) ?? "null")
    if (!raw || !Array.isArray(raw.tabs)) return emptyTabSet()
    const valid = (raw.tabs as Tab[]).filter(
      (t) => VALID_TABS.includes(t?.kind) && !isFixed(t.kind),
    )
    const set = valid.reduce<TabSet>(
      (acc, t) => open(acc, t.kind, typeof t.id === "string" ? t.id : null).set,
      emptyTabSet(),
    )
    return { ...set, historyClosed: raw.historyClosed === true }
  } catch {
    return emptyTabSet()
  }
}

function saveTabSet(set: TabSet): void {
  const { tabs, historyClosed } = set
  scopedStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, historyClosed }))
}

/**
 * The workspace tab strip, wired to the URL and to storage (TABS-01).
 *
 * The rules are `lib/workspace-tabs.ts`; this hook holds the set, writes it
 * through `scopedStorage`, and navigates to whatever tab an operation leaves
 * active. The URL stays the source of the active tab, so a Link, a pasted URL
 * and an operation all arrive the same way, and `visit` opens a tab for any
 * of them that has none.
 */
export function useWorkspaceTabs() {
  const search = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const active = tabFromSearch(search)
  const activeKey = tabKey(active)

  const [set, setSet] = useState(loadTabSet)
  // Operations read these rather than render-time values, so two calls in one
  // handler (a create and then a close, say) see each other's result.
  const setRef = useRef(set)
  const activeRef = useRef(active)
  // Follow the URL only when it moves: between an operation's `navigate` and
  // the URL catching up, a render still sees the old tab, and taking it would
  // hand the next operation a tab that was just closed.
  const urlKeyRef = useRef(activeKey)
  if (urlKeyRef.current !== activeKey) {
    urlKeyRef.current = activeKey
    activeRef.current = active
  }

  const apply = useCallback(
    (op: (current: TabSet, active: Tab) => Step) => {
      const step = op(setRef.current, activeRef.current)
      setRef.current = step.set
      setSet(step.set)
      if (!sameTab(step.active, activeRef.current)) {
        activeRef.current = step.active
        void navigate({
          search: (prev) => tabSearch(prev, step.active),
          replace: true,
        })
      }
      return step.active
    },
    [navigate],
  )

  useEffect(() => saveTabSet(set), [set])

  // Keyed on the active tab's identity, not on the object rebuilt every render.
  useEffect(() => {
    setRef.current = visit(setRef.current, activeRef.current)
    setSet(setRef.current)
  }, [activeKey])

  const keys = useMemo(
    () =>
      set.tabs
        .filter((t) => t.id)
        .map(tabKey)
        .sort(),
    [set.tabs],
  )
  const { data: lookup } = useArtifactTabLookup(keys)
  useEffect(() => {
    if (!lookup) return
    apply((current, now) => {
      // A tab opened after this lookup started is not the lookup's to judge.
      const known = new Set(lookup.found.keys())
      for (const t of current.tabs) {
        if (t.id && !lookup.wanted.has(tabKey(t))) known.add(tabKey(t))
      }
      return reconcile(current, now, { known, hasArtifacts: lookup.any })
    })
  }, [lookup, apply])

  // Stable across renders, because `apply` reads refs rather than props.
  const operations = useMemo(
    () => ({
      /** "Go to <kind>": the most recently active tab of it, or an empty one. */
      setActiveTab: (kind: TabType) => apply((s) => goTo(s, kind)),
      openTab: (kind: TabType, id?: string | null) =>
        apply((s) => open(s, kind, id)),
      /**
       * A new Artifact exists. `background` keeps the user where they are
       * whatever `create` would choose, for a prompt copied from Action,
       * whose paste box is on Action.
       */
      createTab: (
        kind: ArtifactTabKind,
        id: string,
        options?: { background?: boolean },
      ) =>
        apply((s, a) => {
          const step = create(s, a, kind, id)
          return options?.background ? { ...step, active: a } : step
        }),
      closeTab: (target: Tab) => apply((s, a) => close(s, a, target)),
      reopenLastTab: () => apply((s, a) => reopenLast(s, a)),
      /** Open these kinds' tabs without leaving the active one. */
      openTabs: (kinds: readonly TabType[]) =>
        apply((s, a) => ({
          set: kinds.reduce((acc, kind) => open(acc, kind).set, s),
          active: a,
        })),
      /** For the guided tour, which puts the user's strip back when it ends. */
      snapshot: (): Step => ({
        set: setRef.current,
        active: activeRef.current,
      }),
      restore: (saved: Step) => apply(() => saved),
    }),
    [apply],
  )

  return {
    ...operations,
    active,
    activeTab: active.kind,
    tabs: strip(set),
    artifactFor: (t: Tab) => lookup?.found.get(tabKey(t)),
  }
}

export type WorkspaceTabs = ReturnType<typeof useWorkspaceTabs>
