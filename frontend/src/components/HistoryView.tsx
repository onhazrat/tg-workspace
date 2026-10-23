import { getRouteApi } from "@tanstack/react-router"
import { History as HistoryIcon } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { ArtifactActions } from "@/components/history/ArtifactCardParts"
import { ARTIFACT_KIND_LABELS } from "@/components/history/artifact-presentation"
import {
  PrototypeSwitcher,
  setPick,
  VARIANTS,
  VariantContext,
} from "@/components/history/auto-publish-prototype"
import { HistoryBar } from "@/components/history/HistoryBar"
import { useHistoryKeys } from "@/components/history/HistoryKeyboard"
import { HistoryList } from "@/components/history/HistoryList"
import { HistorySpread } from "@/components/history/HistorySpread"
import {
  deleteDialogCopy,
  historyEmptyDescription,
  historyShowsEmpty,
  type SummaryFlag,
  summaryFlagChange,
  toggleStar,
} from "@/components/history/history-view-model"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import { useApplyArtifactScope } from "@/hooks/useApplyArtifactScope"
import {
  useArtifactCounts,
  useArtifacts,
  useInvalidateArtifacts,
} from "@/hooks/useArtifacts"
import { useBotsQuery } from "@/hooks/useBots"
import { useHistoryParams } from "@/hooks/useHistoryParams"
import { useIsMobile } from "@/hooks/useMobile"
import { useSessionFlag } from "@/hooks/useSessionFlag"
import {
  deleteArtifact,
  setArtifactNote,
  setArtifactStarred,
  setSummaryFlag,
} from "@/lib/history/artifact-actions"
import { LISTS } from "@/lib/keyboard/key-list"
import type { ArtifactListItem, TabType } from "@/types"

interface HistoryViewProps {
  /** Restores an artifact's scope and opens the tab that renders it. */
  openArtifact: (artifact: ArtifactListItem) => void
  setActiveTab: (tab: TabType) => void
}

/**
 * Everything you have made, newest Written first unless sorted otherwise.
 *
 * One list over four aggregates, not a summary list with the others bolted on
 * beside it. The interleaving, the time filter, the sort and the counts are
 * decided server-side by `/data/artifacts`. See `useArtifactsQuery` for why
 * merging four capped lists in the browser gives a "load more" that cannot
 * mean anything. Every filter lives in the URL (`useHistoryParams`).
 */
const workspaceRoute = getRouteApi("/_tg/")
// PROTOTYPE: History's - / + row, shown in the key list on variants past 0.
const COMPACT_ROW = ["- / +", "compact / full cards"] as const

export const HistoryView: React.FC<HistoryViewProps> = ({ openArtifact }) => {
  const { params, setParams } = useHistoryParams()
  const search = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const variant = VARIANTS.some((v) => v.key === search.variant)
    ? (search.variant as string)
    : "0"
  useEffect(() => {
    const moves = LISTS.history.moves
    const at = moves.findIndex((r) => r[0] === COMPACT_ROW[0])
    if (variant !== "0" && at < 0) moves.splice(2, 0, COMPACT_ROW)
    if (variant === "0" && at >= 0) moves.splice(at, 1)
  }, [variant])
  const phone = useIsMobile()
  // Off at the start of each session: the full card carries the window and
  // the note that are History's point.
  const [compact, setCompact] = useSessionFlag("history_compactGrid")
  const [pendingDelete, setPendingDelete] = useState<ArtifactListItem | null>(
    null,
  )

  const { rows, query } = useArtifacts(params)
  const counts = useArtifactCounts(params).data
  const invalidate = useInvalidateArtifacts()
  const applyScope = useApplyArtifactScope()
  const bots = useBotsQuery().data
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
        ) {
          void query.fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage])

  const toggleSummaryFlag = async (
    artifact: ArtifactListItem,
    flag: SummaryFlag,
  ) => {
    const change = summaryFlagChange(artifact, flag)
    if (!change) return
    if ("refusal" in change) {
      toast.error(change.refusal)
      return
    }
    await setSummaryFlag(artifact, flag, change.next)
    await invalidate()
  }

  const actions: ArtifactActions = {
    open: openArtifact,
    star: (artifact) =>
      toggleStar(artifact, {
        setStarred: setArtifactStarred,
        refresh: invalidate,
      }),
    saveNote: async (artifact, note) => {
      await setArtifactNote(artifact, note)
      await invalidate()
      toast.success(note ? "Note saved." : "Note deleted.")
    },
    remove: setPendingDelete,
    autoRegenerate: (artifact) =>
      void toggleSummaryFlag(artifact, "autoRegenerate"),
    autoPublish: (artifact) => void toggleSummaryFlag(artifact, "autoPublish"),
    publishTarget: {
      bots: bots?.credentials ?? [],
      destinations: bots?.destinations ?? [],
      // PROTOTYPE: picks stay in memory; nothing is written to the server.
      set: (artifact, botId, chatId) =>
        setPick(`${artifact.kind}:${artifact.id}`, botId, chatId),
    },
    useScope: applyScope,
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    await deleteArtifact(pendingDelete)
    await invalidate()
    const label = ARTIFACT_KIND_LABELS[pendingDelete.kind]
    setPendingDelete(null)
    toast.success(`${label} deleted.`)
  }

  const deleteCopy = deleteDialogCopy(pendingDelete)

  const highlight = useHistoryKeys({
    artifacts: rows,
    onOpen: openArtifact,
    onCompact: variant === "0" ? undefined : setCompact,
  })

  return (
    <VariantContext.Provider value={variant}>
      <motion.div
        key="history"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <HistoryBar
          params={params}
          onChange={setParams}
          counts={counts}
          spread={
            <HistorySpread
              params={params}
              onPick={(bound) => setParams({ bound })}
            />
          }
          compact={compact}
          onCompact={setCompact}
          phone={phone}
        />

        {historyShowsEmpty(rows.length, query.isLoading) ? (
          <TgHeroEmptyState
            icon={<HistoryIcon size={28} className="opacity-40" />}
            title="Nothing here yet"
            description={historyEmptyDescription(params)}
          />
        ) : (
          <HistoryList
            rows={rows}
            actions={actions}
            search={params.search}
            compact={compact}
            days={params.sort === "written"}
            highlight={highlight}
          />
        )}

        <div ref={loadMoreRef} className="h-8" aria-hidden="true">
          {query.isFetchingNextPage && (
            <p className="pt-2 text-center text-[11px] text-app-ink/40">
              Loading more…
            </p>
          )}
        </div>

        <TgConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title={deleteCopy.title}
          /*
           * Clamped for the same reason the card is: some summaries name over a
           * thousand channels, and the un-clamped join filled the dialog and
           * pushed the buttons off-screen.
           */
          descriptionClassName="line-clamp-3 break-words text-sm text-app-ink/70"
          description={deleteCopy.description}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
        />
        <PrototypeSwitcher
          variants={VARIANTS}
          current={variant}
          onChange={(key) =>
            navigate({
              search: (prev) => ({ ...prev, variant: key }),
              replace: true,
            })
          }
        />
      </motion.div>
    </VariantContext.Provider>
  )
}
