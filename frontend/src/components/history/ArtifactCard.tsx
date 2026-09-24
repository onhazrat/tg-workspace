import type React from "react"
import { ArtifactScopeLine } from "@/components/ArtifactScopeLine"
import type { ArtifactListItem } from "@/types"

import { RelativeTime } from "../RelativeTime"
import {
  ArtifactCardActions,
  ArtifactCardHeading,
  ArtifactCardNotes,
} from "./ArtifactCardParts"
import { artifactDetail, isPendingArtifact } from "./artifact-presentation"

interface ArtifactCardProps {
  artifact: ArtifactListItem
  onOpen: (artifact: ArtifactListItem) => void
  onToggleStar: (artifact: ArtifactListItem) => void
  onEditNote: (artifact: ArtifactListItem) => void
  onDelete: (artifact: ArtifactListItem) => void
  /** Summaries only — the two scheduled-regeneration flags. */
  onToggleAutoRegenerate: (artifact: ArtifactListItem) => void
  onToggleAutoPublish: (artifact: ArtifactListItem) => void
}

/**
 * One row of the unified History list.
 *
 * Deliberately the same card for all four kinds. History's job is "what have I
 * made, and when" — the differences between a summary and a tag run belong on
 * the tab that renders the artifact, not in four subtly different cards that
 * have to be kept in visual step with each other.
 */
export const ArtifactCard: React.FC<ArtifactCardProps> = ({
  artifact,
  onOpen,
  ...actions
}) => {
  const pending = isPendingArtifact(artifact)

  /*
   * The `min-w-0`s below make the card safe to drop into any flex or grid
   * parent; the one that actually fixed History is on the grid item in
   * `HistoryView`, and the reasoning lives there. Either way `truncate` on the
   * channel line only ellipsizes once something upstream clamps the width.
   */
  return (
    <div
      data-testid="artifact-card"
      data-artifact-kind={artifact.kind}
      data-artifact-id={artifact.id}
      className={`group relative flex min-w-0 flex-col gap-3 rounded-xl border p-5 shadow-sm transition-all hover:shadow-md ${
        pending
          ? "border-amber-500/30 bg-amber-500/[0.03] hover:border-amber-500/50"
          : "border-app-ink/10 hover:border-app-ink/20"
      }`}
    >
      <ArtifactCardHeading
        artifact={artifact}
        pending={pending}
        onOpen={onOpen}
      />

      <div className="flex min-w-0 items-center justify-between gap-3 text-[11px] font-mono text-app-ink/60">
        <span className="truncate">{artifactDetail(artifact)}</span>
        <RelativeTime timestamp={artifact.timestamp} />
      </div>

      {/*
       * The frozen Analysis window, on the card rather than only on the detail
       * view: "which hours was this made from" is asked while scanning the
       * list, and it is the whole of what distinguishes two runs over the same
       * channels. The relative stamp above it is the *creation* time, which is
       * a fact about the row and not about its window.
       */}
      <ArtifactScopeLine artifact={artifact} />

      <ArtifactCardNotes artifact={artifact} />

      <ArtifactCardActions artifact={artifact} pending={pending} {...actions} />
    </div>
  )
}
