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
import { type Panel, panelMatches, visiblePanels } from "./panels"
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
  const rows = filterRows(registry.rows, query, filters)
  // A panel holds no value, so a filter on values or an operator hides it.
  const panels =
    filters.modifiedOnly ||
    filters.editableOnly ||
    filters.scope !== "all" ||
    query.includes("@")
      ? []
      : visiblePanels(registry.permissions).filter((p) =>
          panelMatches(p, parsed.text),
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

function scrollToId(id: string, block: ScrollLogicalPosition) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block }),
    ),
  )
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
  const target = setting ?? sectionTopic(section)
  const loaded = !registry.isLoading
  useEffect(() => {
    if (!target || !loaded) return
    const row = registry.rows.find((r) => r.id === target)
    if (row && HIDDEN_SCOPES.includes(row.scope)) {
      setUnfolded((prev) => new Set(prev).add(`${row.topic}.${row.scope}`))
    }
    const isTopic = registry.topics.some((t) => t.id === target)
    setFlash(target)
    scrollToId(
      isTopic ? `settings-topic-${target}` : elementId(target),
      isTopic ? "start" : "center",
    )
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
    // Only a new link or the first load re-runs this, never a write.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
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
