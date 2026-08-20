import { History as HistoryIcon, Search, Star } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { ArtifactCard } from "@/components/history/ArtifactCard"
import { ARTIFACT_KIND_LABELS } from "@/components/history/artifact-presentation"
import { TgButton } from "@/components/ui/tg-button"
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

const KIND_FILTERS: (ArtifactKind | null)[] = [
  null,
  "summary",
  "chat",
  "tag",
  "discovery",
]

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
    flag: "autoRegenerate" | "autoPublish",
  ) => {
    if (artifact.kind !== "summary") return
    const next = !artifact[flag]
    if (flag === "autoRegenerate" && next) {
      // A scope shorter than a minute would have the job re-running over a
      // window that barely moves.
      const span = (artifact.endDate ?? 0) - (artifact.startDate ?? 0)
      if (span < 60_000) {
        toast.error(
          "Cannot auto-regenerate a summary whose range is under a minute.",
        )
        return
      }
    }
    await setSummaryFlag(artifact, flag, next)
    await invalidate()
  }

  const handleSaveNote = async () => {
    if (!editingNoteFor) return
    await setArtifactNote(editingNoteFor, noteDraft.trim() || null)
    await invalidate()
    setEditingNoteFor(null)
    setNoteDraft("")
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

  return (
    <motion.div
      key="history"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Artifact kinds" className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((candidate) => {
            const active = kind === candidate
            const label = candidate ? ARTIFACT_KIND_LABELS[candidate] : "All"
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                data-testid={`history-kind-${candidate ?? "all"}`}
                onClick={() => setKind(candidate)}
                className={`rounded-md border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-all ${
                  active
                    ? "border-app-ink bg-app-ink text-app-bg"
                    : "border-app-ink/10 text-app-ink/60 hover:border-app-ink/40"
                }`}
              >
                {label}
              </button>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40"
            />
            <input
              type="search"
              value={historySearchQuery}
              onChange={(event) => setHistorySearchQuery(event.target.value)}
              placeholder="Search channels, titles, notes"
              aria-label="Search history"
              className="w-64 rounded-md border border-app-ink/10 bg-app-card py-1.5 pl-8 pr-3 text-xs focus:border-app-ink/40 focus:outline-none"
            />
          </div>
          <button
            type="button"
            aria-pressed={starredOnly}
            aria-label="Show starred only"
            onClick={() => setStarredOnly(!starredOnly)}
            className={`rounded-md border p-1.5 transition-all ${
              starredOnly
                ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                : "border-app-ink/10 text-app-ink/50 hover:border-app-ink/40"
            }`}
          >
            <Star size={14} className={starredOnly ? "fill-amber-500" : ""} />
          </button>
        </div>
      </div>

      {visible.length === 0 && !query.isLoading ? (
        <TgHeroEmptyState
          icon={<HistoryIcon size={28} className="opacity-40" />}
          title="Nothing here yet"
          description={
            historySearchQuery || starredOnly || kind
              ? "No artifacts match these filters."
              : "Summaries, chats, tag runs and discovery reports you create will appear here."
          }
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
        <div className="space-y-2 rounded-xl border border-app-ink/10 bg-app-card p-4">
          <label
            htmlFor="artifact-note"
            className="font-mono text-[10px] uppercase tracking-widest opacity-50"
          >
            Note on {ARTIFACT_KIND_LABELS[editingNoteFor.kind]}
          </label>
          <textarea
            id="artifact-note"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-app-ink/10 bg-app-muted/30 p-2 text-xs focus:border-app-ink/40 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <TgButton
              variant="ghost"
              onClick={() => {
                setEditingNoteFor(null)
                setNoteDraft("")
              }}
            >
              Cancel
            </TgButton>
            <TgButton onClick={handleSaveNote}>Save note</TgButton>
          </div>
        </div>
      )}

      <TgConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete this ${
          pendingDelete ? ARTIFACT_KIND_LABELS[pendingDelete.kind] : "item"
        }?`}
        /*
         * Clamped for the same reason the card is: some summaries name over a
         * thousand channels, and the un-clamped join filled the dialog and
         * pushed the buttons off-screen.
         */
        descriptionClassName="line-clamp-3 break-words text-sm text-app-ink/70"
        description={
          pendingDelete?.channels?.join(", ") || "This cannot be undone."
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </motion.div>
  )
}
