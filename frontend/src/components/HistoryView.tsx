import { History as HistoryIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { ArtifactCard } from "@/components/history/ArtifactCard"
import { ARTIFACT_KIND_LABELS } from "@/components/history/artifact-presentation"
import {
  ArtifactNoteEditor,
  HistoryKindFilters,
  HistorySearchControls,
} from "@/components/history/HistoryViewParts"
import {
  deleteDialogCopy,
  historyEmptyDescription,
  historyShowsEmpty,
  type SummaryFlag,
  summaryFlagChange,
} from "@/components/history/history-view-model"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import { useArtifacts, useInvalidateArtifacts } from "@/hooks/useArtifacts"
import {
  deleteArtifact,
  setArtifactNote,
  setArtifactStarred,
  setSummaryFlag,
} from "@/lib/history/artifact-actions"
import type { ArtifactKind, ArtifactListItem, TabType } from "@/types"

import { useUI } from "../contexts/UIContext"

interface HistoryViewProps {
  /** Restores an artifact's scope and opens the tab that renders it. */
  openArtifact: (artifact: ArtifactListItem) => void
  setActiveTab: (tab: TabType) => void
}

/**
 * Everything you have made, newest first.
 *
 * One list over four aggregates, not a summary list with the others bolted on
 * beside it. The interleaving is decided server-side by `/data/artifacts` — see
 * `useArtifactsQuery` for why merging four capped lists in the browser gives a
 * "load more" that cannot mean anything.
 *
 * The card is the same for every kind on purpose. History answers "what have I
 * made, and when"; the differences between a summary and a tag run belong on
 * the tab that renders the artifact.
 */
export const HistoryView: React.FC<HistoryViewProps> = ({ openArtifact }) => {
  const {
    historySearchQuery,
    setHistorySearchQuery,
    starredOnly,
    setStarredOnly,
  } = useUI()

  const [kind, setKind] = useState<ArtifactKind | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ArtifactListItem | null>(
    null,
  )
  const [editingNoteFor, setEditingNoteFor] = useState<ArtifactListItem | null>(
    null,
  )
  const [noteDraft, setNoteDraft] = useState("")

  const { rows: visible, query } = useArtifacts(
    kind,
    historySearchQuery,
    starredOnly,
  )
  const invalidate = useInvalidateArtifacts()
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

  const handleToggleStar = async (artifact: ArtifactListItem) => {
    await setArtifactStarred(artifact, !artifact.isStarred)
    await invalidate()
    toast[artifact.isStarred ? "info" : "success"](
      artifact.isStarred ? "Item unstarred." : "Item starred.",
    )
  }

  const handleToggleSummaryFlag = async (
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

  const closeNoteEditor = () => {
    setEditingNoteFor(null)
    setNoteDraft("")
  }

  const handleSaveNote = async () => {
    if (!editingNoteFor) return
    await setArtifactNote(editingNoteFor, noteDraft.trim() || null)
    await invalidate()
    closeNoteEditor()
    toast.success(noteDraft.trim() ? "Note saved." : "Note deleted.")
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

  return (
    <motion.div
      key="history"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <HistoryKindFilters kind={kind} onSelect={setKind} />
        <HistorySearchControls
          searchQuery={historySearchQuery}
          onSearchChange={setHistorySearchQuery}
          starredOnly={starredOnly}
          onStarredOnlyChange={setStarredOnly}
        />
      </div>

      {historyShowsEmpty(visible.length, query.isLoading) ? (
        <TgHeroEmptyState
          icon={<HistoryIcon size={28} className="opacity-40" />}
          title="Nothing here yet"
          description={historyEmptyDescription(
            historySearchQuery,
            starredOnly,
            kind,
          )}
        />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {visible.map((artifact) => (
              /*
               * `min-w-0` is load-bearing. A grid item defaults to
               * `min-width: auto`, so the track sizes to the item's
               * max-content — and one summary here carries 1,722 channel names
               * on a single `truncate` line. Without it the card measured
               * 17,374px and every row ran off the panel. Guarded by
               * `tests/open-artifact.spec.ts`, which measures the scroller.
               */
              <motion.div
                key={`${artifact.kind}:${artifact.id}`}
                className="min-w-0"
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <ArtifactCard
                  artifact={artifact}
                  onOpen={openArtifact}
                  onToggleStar={handleToggleStar}
                  onEditNote={(item) => {
                    setEditingNoteFor(item)
                    setNoteDraft(item.note ?? "")
                  }}
                  onDelete={setPendingDelete}
                  onToggleAutoRegenerate={(item) =>
                    void handleToggleSummaryFlag(item, "autoRegenerate")
                  }
                  onToggleAutoPublish={(item) =>
                    void handleToggleSummaryFlag(item, "autoPublish")
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div ref={loadMoreRef} className="h-8" aria-hidden="true">
        {query.isFetchingNextPage && (
          <p className="text-center font-mono text-[10px] uppercase tracking-widest opacity-40">
            Loading more…
          </p>
        )}
      </div>

      {editingNoteFor && (
        <ArtifactNoteEditor
          artifact={editingNoteFor}
          draft={noteDraft}
          onDraftChange={setNoteDraft}
          onCancel={closeNoteEditor}
          onSave={() => void handleSaveNote()}
        />
      )}

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
    </motion.div>
  )
}
