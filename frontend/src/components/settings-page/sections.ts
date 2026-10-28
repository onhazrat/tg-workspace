/**
 * Rows and panels grouped into one page of topics, after search and filters
 * (SET-02), plus the `?setting=` and `?section=` landing.
 */
import { getRouteApi } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import {
  elementId,
  type Filters,
  filterRows,
  parseQuery,
  type Row,
  SCOPES,
  type Scope,
  sectionTopic,
} from "./model"
import {
  absorbingPanel,
  type Panel,
  panelMatches,
  visiblePanels,
} from "./panels"
import { type SettingsRegistry, useSettingsRegistry } from "./registry"

export interface ScopeGroup {
  scope: Scope
  rows: Row[]
  /** `.env` and code groups start folded unless the search asked for them. */
  folded: boolean
}

export interface Section {
  id: string
  title: string
  panels: Panel[]
  groups: ScopeGroup[]
  rowCount: number
  modifiedCount: number
}

const workspaceRoute = getRouteApi("/_tg/")

const HIDDEN_SCOPES: readonly Scope[] = ["env", "code"]

/** The topic or row a link names, and how long it stays highlighted. */
const FLASH_MS = 2500

export function buildSections(
  registry: Pick<SettingsRegistry, "rows" | "topics" | "permissions">,
  query: string,
  filters: Filters,
  unfolded: ReadonlySet<string>,
): Section[] {
  const parsed = parseQuery(query)
  const searching = parsed.text.length > 0 || query.includes("@")
  const askedForHidden = [filters.scope, parsed.filters.scope].some(
    (s) => s === "env" || s === "code",
  )
  const hits = filterRows(registry.rows, query, filters)
  // A row a panel shows is found through the panel, never listed twice.
  const rows = hits.filter((r) => !absorbingPanel(r.id, registry.permissions))
  // A panel holds no value, so a filter on values or an operator hides it.
  const panels =
    filters.modifiedOnly ||
    filters.editableOnly ||
    filters.scope !== "all" ||
    query.includes("@")
      ? []
      : visiblePanels(registry.permissions).filter(
          (p) =>
            panelMatches(p, parsed.text) ||
            hits.some((r) => p.absorbs?.includes(r.id)),
        )
  const out: Section[] = []
  for (const topic of registry.topics) {
    const topicRows = rows.filter((r) => r.topic === topic.id)
    const topicPanels = panels.filter((p) => p.topic === topic.id)
    if (!topicRows.length && !topicPanels.length) continue
    const groups = SCOPES.map((s) => ({
      scope: s.id,
      rows: topicRows.filter((r) => r.scope === s.id),
      folded:
        HIDDEN_SCOPES.includes(s.id) &&
        !searching &&
        !askedForHidden &&
        !unfolded.has(`${topic.id}.${s.id}`),
    })).filter((g) => g.rows.length)
    out.push({
      id: topic.id,
      title: topic.title,
      panels: topicPanels,
      groups,
      rowCount: topicRows.length,
      modifiedCount: topicRows.filter((r) => r.modified).length,
    })
  }
  return out
}

/**
 * Where a link to `target` lands: a topic or panel at the top, a row
 * in the middle, and a `.env` or code row's folded group opened first.
 */
export function landingFor(
  target: string,
  registry: Pick<SettingsRegistry, "rows" | "topics">,
): { elementId: string; block: ScrollLogicalPosition; unfold: string | null } {
  if (registry.topics.some((t) => t.id === target))
    return {
      elementId: `settings-topic-${target}`,
      block: "start",
      unfold: null,
    }
  const row = registry.rows.find((r) => r.id === target)
  return {
    elementId: elementId(target),
    // A panel can be a long table, and centring it puts its forms off screen.
    block: row ? "center" : "start",
    unfold:
      row && HIDDEN_SCOPES.includes(row.scope)
        ? `${row.topic}.${row.scope}`
        : null,
  }
}

/** What a link lands on: a Setting a panel shows lands on the panel. */
export function linkTarget(
  asked: string | undefined,
  permissions: readonly string[],
): string | undefined {
  return (asked && absorbingPanel(asked, permissions)?.id) || asked
}

/**
 * Scrolls to `id` now and again while the panels above it load, so a link
 * still lands once their content has pushed the row down. Returns a cancel.
 */
function scrollToId(id: string, block: ScrollLogicalPosition): () => void {
  const go = () =>
    document.getElementById(id)?.scrollIntoView({ behavior: "auto", block })
  const timers = [0, 300, 900].map((ms) => setTimeout(go, ms))
  return () => {
    for (const timer of timers) clearTimeout(timer)
  }
}

export function useSettingsPage() {
  const registry = useSettingsRegistry()
  const { setting, section } = workspaceRoute.useSearch()
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Filters>({
    scope: "all",
    modifiedOnly: false,
    editableOnly: false,
  })
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set())

  const sections = useMemo(
    () => buildSections(registry, query, filters, unfolded),
    [registry, query, filters, unfolded],
  )

  const totals = useMemo(
    () => ({
      all: registry.rows.length,
      shown: sections.reduce((n, s) => n + s.rowCount, 0),
      modified: registry.rows.filter((r) => r.modified).length,
    }),
    [registry.rows, sections],
  )

  // `?setting=<id>` scrolls to a row, panel or topic and flashes it; an old
  // `?section=` lands on the topic that holds what it showed.
  const [flash, setFlash] = useState<string | null>(null)
  const target = linkTarget(
    setting ?? sectionTopic(section),
    registry.permissions,
  )
  const loaded = !registry.isLoading
  useEffect(() => {
    if (!target || !loaded) return
    const land = landingFor(target, registry)
    const unfold = land.unfold
    if (unfold) setUnfolded((prev) => new Set(prev).add(unfold))
    setFlash(target)
    const cancelScroll = scrollToId(land.elementId, land.block)
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => {
      cancelScroll()
      clearTimeout(timer)
    }
    // Only a new link or the first load re-runs this, never a write.
  }, [target, loaded])

  return {
    ...registry,
    query,
    setQuery,
    filters,
    setFilters,
    sections,
    totals,
    flash,
    unfold: (key: string) => setUnfolded((prev) => new Set(prev).add(key)),
  }
}

export type SettingsPageState = ReturnType<typeof useSettingsPage>
