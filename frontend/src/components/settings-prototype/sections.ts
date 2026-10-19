/**
 * PROTOTYPE, throw away. Rows and panels grouped into one page of topics,
 * after search and filters. Both variants draw this; neither decides it.
 */
import { getRouteApi } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import useAuth from "@/hooks/useAuth"
import {
  type Filters,
  filterRows,
  parseQuery,
  type Row,
  SCOPES,
  type Scope,
  useRegistry,
} from "./model"
import { PANEL_TOPICS, type Panel, panelMatches, visiblePanels } from "./panels"

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

export function elementId(id: string) {
  return `setting-${id.replace(/\./g, "-")}`
}

export function useSettingsPage() {
  const registry = useRegistry()
  const { user } = useAuth()
  const { setting } = workspaceRoute.useSearch()
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Filters>({
    scope: "all",
    modifiedOnly: false,
    editableOnly: false,
  })
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set())

  const permissions = registry.user?.permissions ?? []
  const parsed = parseQuery(query)
  const searching = parsed.text.length > 0 || query.includes("@")
  const askedForHidden =
    filters.scope === "env" ||
    filters.scope === "code" ||
    parsed.filters.scope === "env" ||
    parsed.filters.scope === "code"

  const sections = useMemo(() => {
    const rows = filterRows(registry.rows, query, filters)
    const panels =
      filters.modifiedOnly || filters.editableOnly || filters.scope !== "all"
        ? []
        : visiblePanels(
            registry.asMember ? [] : permissions,
            Boolean(user?.is_superuser) && !registry.asMember,
          ).filter((p) => panelMatches(p, query))
    const order = [
      PANEL_TOPICS[0],
      ...registry.topics.filter((t) => t.id !== "account"),
      PANEL_TOPICS[1],
    ]
    const out: Section[] = []
    for (const topic of order) {
      const topicRows = rows.filter((r) => r.topic === topic.id)
      const topicPanels = panels.filter((p) => p.topic === topic.id)
      if (!topicRows.length && !topicPanels.length) continue
      const groups = SCOPES.map((s) => ({
        scope: s.id,
        rows: topicRows.filter((r) => r.scope === s.id),
        folded:
          (s.id === "env" || s.id === "code") &&
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
  }, [
    registry.rows,
    registry.topics,
    registry.asMember,
    query,
    filters,
    permissions,
    user?.is_superuser,
    searching,
    askedForHidden,
    unfolded,
  ])

  const totals = useMemo(
    () => ({
      all: registry.rows.length,
      shown: sections.reduce((n, s) => n + s.rowCount, 0),
      modified: registry.rows.filter((r) => r.modified).length,
    }),
    [registry.rows, sections],
  )

  // `?setting=<id>`: unfold its group, scroll to it, flash it.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!setting || registry.isLoading) return
    const row = registry.rows.find((r) => r.id === setting)
    if (row && (row.scope === "env" || row.scope === "code")) {
      setUnfolded((prev) => new Set(prev).add(`${row.topic}.${row.scope}`))
    }
    setFlash(setting)
    const target = setting
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .getElementById(elementId(target))
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      ),
    )
    const t = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(t)
  }, [setting, registry.isLoading])

  return {
    ...registry,
    query,
    setQuery,
    filters,
    setFilters,
    sections,
    totals,
    searching,
    flash,
    unfold: (key: string) => setUnfolded((prev) => new Set(prev).add(key)),
  }
}

export type SettingsPage = ReturnType<typeof useSettingsPage>
