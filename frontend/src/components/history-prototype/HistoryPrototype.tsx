// PROTOTYPE: History tab redesign. Variant 0 is today's HistoryView; 1 is
// the cards that won, inside the shared bar, switchable via `?variant=`.
// Star, note, the Summary flags and delete are stubbed: nothing writes.
// Never merge (docs/history-tab-redesign-plan.md).
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { History as HistoryIcon, LayoutGrid } from "lucide-react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { request } from "@/api/base"
import { HistoryView } from "@/components/HistoryView"
import { historyEmptyDescription } from "@/components/history/history-view-model"
import { pillClass } from "@/components/PostFilterParts"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import { useUI } from "@/contexts/UIContext"
import { useHistoryStatusParam } from "@/hooks/useHistoryStatusParam"
import { useIsMobile } from "@/hooks/useMobile"
import { useSessionFlag } from "@/hooks/useSessionFlag"
import type { TimeBound } from "@/lib/time-bound/bound"
import type { ArtifactKind, ArtifactListItem, TabType } from "@/types"
import {
  HistoryBar,
  type HistoryCounts,
  type HistoryMoment,
  type HistorySort,
} from "./FilterBar"
import { PrototypeSwitcher } from "./PrototypeSwitcher"
import { type Acts, CardsVariant, type ListProps } from "./variants"

const workspaceRoute = getRouteApi("/_tg/")

const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "1", name: "Cards" },
]

const LISTS: Record<string, React.FC<ListProps>> = {
  "1": CardsVariant,
}

export const HistoryPrototype: React.FC<{
  openArtifact: (artifact: ArtifactListItem) => void
  setActiveTab: (tab: TabType) => void
}> = ({ openArtifact, setActiveTab }) => {
  // The router reads `?variant=2` as a number.
  const variant = String(workspaceRoute.useSearch().variant ?? "0")
  const navigate = workspaceRoute.useNavigate()
  const List = LISTS[variant] as React.FC<ListProps> | undefined
  return (
    <>
      {List ? (
        <Redesign List={List} openArtifact={openArtifact} />
      ) : (
        <HistoryView openArtifact={openArtifact} setActiveTab={setActiveTab} />
      )}
      <PrototypeSwitcher
        variants={VARIANTS}
        current={List ? variant : "0"}
        onChange={(key) =>
          navigate({
            search: (prev) => ({
              ...prev,
              variant: key === "0" ? undefined : key,
            }),
            replace: true,
          })
        }
      />
    </>
  )
}

const PAGE = 40

/** The prototype list's query string: every History filter, Written and Sort too. */
function listQuery(p: {
  kind: ArtifactKind | null
  search: string
  starred: boolean
  status: string | null
  written: TimeBound
  moment: HistoryMoment
  sort: HistorySort
  descending: boolean
  offset: number
}): string {
  const qs = new URLSearchParams({
    sort: p.sort,
    descending: String(p.descending),
    moment: p.moment,
    limit: String(PAGE),
    offset: String(p.offset),
  })
  if (p.kind) qs.set("kind", p.kind)
  if (p.search.trim()) qs.set("search", p.search.trim())
  if (p.starred) qs.set("starred", "true")
  if (p.status) qs.set("status", p.status)
  if (p.written.start !== undefined || p.written.end !== undefined) {
    qs.set("mode", p.written.mode)
    if (p.written.start !== undefined) qs.set("start", String(p.written.start))
    if (p.written.end !== undefined) qs.set("end", String(p.written.end))
  }
  return qs.toString()
}

const stub = (what: string) => toast.info(`Prototype: ${what}, not saved.`)

function Redesign({
  List,
  openArtifact,
}: {
  List: React.FC<ListProps>
  openArtifact: (artifact: ArtifactListItem) => void
}) {
  const phone = useIsMobile()
  const [compact, setCompact] = useSessionFlag("historyPrototype_compactGrid")
  const {
    historySearchQuery: search,
    setHistorySearchQuery,
    starredOnly: starred,
    setStarredOnly,
  } = useUI()
  const { status, setStatus } = useHistoryStatusParam()
  const [kind, setKind] = useState<ArtifactKind | null>(null)
  const [written, setWritten] = useState<TimeBound>({ mode: "live" })
  const [moment, setMoment] = useState<HistoryMoment>("written")
  const [sort, setSort] = useState<HistorySort>("written")
  const [descending, setDescending] = useState(true)
  // Stubbed writes show on the row, so each variant can be judged with them.
  const [local, setLocal] = useState<Record<string, object>>({})

  const query = useInfiniteQuery({
    queryKey: [
      "artifacts",
      "proto",
      { kind, search, starred, status, written, moment, sort, descending },
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      request<ArtifactListItem[]>(
        `/api/v1/data/artifacts/proto-list?${listQuery({
          kind,
          search,
          starred,
          status,
          written,
          moment,
          sort,
          descending,
          offset: pageParam,
        })}`,
      ),
    getNextPageParam: (last, all) =>
      last.length < PAGE ? undefined : all.length * PAGE,
  })
  const rows = query.data?.pages.flat() ?? []
  const counts = useQuery({
    queryKey: [
      "artifacts",
      "proto-counts",
      { kind, search, starred, status, written, moment },
    ],
    queryFn: () =>
      request<HistoryCounts>(
        `/api/v1/data/artifacts/proto-counts?${listQuery({
          kind,
          search,
          starred,
          status,
          written,
          moment,
          sort,
          descending,
          offset: 0,
        })}`,
      ),
    placeholderData: keepPreviousData,
  }).data
  const shown = rows.map(
    (a) => ({ ...a, ...local[`${a.kind}:${a.id}`] }) as ArtifactListItem,
  )
  const patch = (a: ArtifactListItem, p: Partial<ArtifactListItem>) =>
    setLocal((prev) => {
      const key = `${a.kind}:${a.id}`
      return { ...prev, [key]: { ...prev[key], ...p } }
    })

  const acts: Acts = {
    open: openArtifact,
    star: (a) => {
      patch(a, { isStarred: !a.isStarred })
      stub(a.isStarred ? "unstarred" : "starred")
    },
    saveNote: (a, note) => {
      patch(a, { note: note.trim() || null })
      stub(note.trim() ? "note saved" : "note deleted")
    },
    del: () => stub("delete"),
    autoRegenerate: (a) => {
      if (a.kind !== "summary") return
      if (!a.autoRegenerate && (a.scope?.durationMinutes ?? 0) < 1) {
        toast.error(
          "Cannot auto-regenerate a summary whose range is under a minute.",
        )
        return
      }
      patch(a, { autoRegenerate: !a.autoRegenerate })
      stub("auto-regenerate")
    },
    autoPublish: (a) => {
      if (a.kind !== "summary") return
      patch(a, { autoPublish: !a.autoPublish })
      stub("auto-publish")
    },
  }

  const loadMoreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = loadMoreRef.current
    if (!target) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        )
          void query.fetchNextPage()
      },
      { threshold: 0.1 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage])

  return (
    <div>
      <HistoryBar
        phone={phone}
        counts={counts}
        state={{
          search,
          kind,
          status,
          starred,
          written,
          moment,
          sort,
          descending,
        }}
        onChange={(p) => {
          if (p.search !== undefined) setHistorySearchQuery(p.search)
          if (p.kind !== undefined) setKind(p.kind)
          if (p.status !== undefined) setStatus(p.status)
          if (p.starred !== undefined) setStarredOnly(p.starred)
          if (p.written) setWritten(p.written)
          if (p.moment) setMoment(p.moment)
          if (p.sort) setSort(p.sort)
          if (p.descending !== undefined) setDescending(p.descending)
        }}
        trailing={
          <button
            type="button"
            aria-pressed={compact}
            onClick={() => setCompact(!compact)}
            className={`${pillClass(compact)} ml-auto`}
          >
            <LayoutGrid size={12} /> Compact grid
          </button>
        }
        footer={
          <>
            <span className="font-semibold">
              {counts ? counts.total.toLocaleString() : "…"} artifacts
            </span>
            <span className="text-app-ink/50">
              Sorted by {sort === "written" ? "Written" : "Window start"},{" "}
              {descending ? "newest first" : "oldest first"}
            </span>
          </>
        }
      />
      {rows.length === 0 && !query.isLoading ? (
        <TgHeroEmptyState
          icon={<HistoryIcon size={28} className="opacity-40" />}
          title="Nothing here yet"
          description={historyEmptyDescription(search, starred, kind, status)}
        />
      ) : (
        <List
          rows={shown}
          acts={acts}
          compact={compact}
          days={sort === "written"}
        />
      )}
      <div ref={loadMoreRef} className="h-8" aria-hidden="true">
        {query.isFetchingNextPage && (
          <p className="pt-2 text-center text-[11px] text-app-ink/40">
            Loading more…
          </p>
        )}
      </div>
    </div>
  )
}
