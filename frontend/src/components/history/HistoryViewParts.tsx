/**
 * The History tab's controls and note editor. Each takes props only; the list
 * itself stays in `HistoryView`, because `ArtifactCard` needs the workspace
 * contexts to restore a Scope.
 */
import { Search, Star } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import type { ArtifactKind, ArtifactListItem } from "@/types"
import { ARTIFACT_KIND_LABELS } from "./artifact-presentation"
import { kindFilterChip } from "./history-view-model"

const KIND_FILTERS: (ArtifactKind | null)[] = [
  null,
  "summary",
  "chat",
  "tag",
  "discovery",
]

/** All, then one chip per artifact kind; the active one is pressed. */
export const HistoryKindFilters: React.FC<{
  kind: ArtifactKind | null
  onSelect: (kind: ArtifactKind | null) => void
}> = ({ kind, onSelect }) => (
  <nav aria-label="Artifact kinds" className="flex flex-wrap gap-2">
    {KIND_FILTERS.map((candidate) => {
      const active = kind === candidate
      const { label, testId } = kindFilterChip(candidate)
      return (
        <button
          key={label}
          type="button"
          aria-pressed={active}
          data-testid={testId}
          onClick={() => onSelect(candidate)}
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
)

/** The text search and the starred-only toggle. */
export const HistorySearchControls: React.FC<{
  searchQuery: string
  onSearchChange: (query: string) => void
  starredOnly: boolean
  onStarredOnlyChange: (starredOnly: boolean) => void
}> = ({ searchQuery, onSearchChange, starredOnly, onStarredOnlyChange }) => (
  <div className="flex items-center gap-2">
    <div className="relative">
      <Search
        size={13}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40"
      />
      <input
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search channels, titles, notes"
        aria-label="Search history"
        className="w-64 rounded-md border border-app-ink/10 bg-app-card py-1.5 pl-8 pr-3 text-xs focus:border-app-ink/40 focus:outline-none"
      />
    </div>
    <button
      type="button"
      aria-pressed={starredOnly}
      aria-label="Show starred only"
      onClick={() => onStarredOnlyChange(!starredOnly)}
      className={`rounded-md border p-1.5 transition-all ${
        starredOnly
          ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
          : "border-app-ink/10 text-app-ink/50 hover:border-app-ink/40"
      }`}
    >
      <Star size={14} className={starredOnly ? "fill-amber-500" : ""} />
    </button>
  </div>
)

/** The note box under the list, for the one artifact being annotated. */
export const ArtifactNoteEditor: React.FC<{
  artifact: ArtifactListItem
  draft: string
  onDraftChange: (draft: string) => void
  onCancel: () => void
  onSave: () => void
}> = ({ artifact, draft, onDraftChange, onCancel, onSave }) => (
  <div className="space-y-2 rounded-xl border border-app-ink/10 bg-app-card p-4">
    <label
      htmlFor="artifact-note"
      className="font-mono text-[10px] uppercase tracking-widest opacity-50"
    >
      Note on {ARTIFACT_KIND_LABELS[artifact.kind]}
    </label>
    <textarea
      id="artifact-note"
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
      rows={3}
      className="w-full rounded-md border border-app-ink/10 bg-app-muted/30 p-2 text-xs focus:border-app-ink/40 focus:outline-none"
    />
    <div className="flex justify-end gap-2">
      <TgButton variant="ghost" onClick={onCancel}>
        Cancel
      </TgButton>
      <TgButton onClick={onSave}>Save note</TgButton>
    </div>
  </div>
)
