import type React from "react"
import { highlightText } from "@/lib/utils"
import type { ArtifactListItem } from "@/types"

import { RelativeTime } from "../RelativeTime"
import {
  ActedBy,
  type ArtifactActions,
  CardActions,
  ChannelsLine,
  FlagChips,
  KindLabel,
  StatusBadge,
  WindowLine,
} from "./ArtifactCardParts"
import {
  artifactDetail,
  failedAttempts,
  isPendingArtifact,
  plainTitle,
} from "./artifact-presentation"
import { PublishBody, PublishChip } from "./auto-publish-prototype"

/** A Failed card's title: what to do with it. */
const FAILED_TITLE =
  "Generation failed. Open it to retry, keep a Partial response or paste a response."

interface ArtifactCardProps {
  artifact: ArtifactListItem
  actions: ArtifactActions
  /** The search as typed; its matches are marked in the text. */
  search: string
  /** The Compact grid's card: no window, acted-by or note lines, icon actions. */
  compact?: boolean
  /** Keyboard mode's Highlight is on this card. */
  highlighted?: boolean
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
  actions,
  search,
  compact = false,
  highlighted = false,
}) => {
  const failed = failedAttempts(artifact) !== null
  const term = search.trim()
  const title = failed
    ? FAILED_TITLE
    : plainTitle(artifact.title || artifactDetail(artifact))

  /*
   * The `min-w-0`s make the card safe in any flex or grid parent: a grid item
   * defaults to `min-width: auto`, and one summary carries 1,722 channel names.
   * Guarded by `tests/open-artifact.spec.ts`, which measures the scroller.
   */
  return (
    <article
      data-testid="artifact-card"
      data-artifact-kind={artifact.kind}
      data-artifact-id={artifact.id}
      data-highlight={highlighted || undefined}
      className={`flex min-w-0 scroll-mt-24 flex-col gap-2 rounded-xl border bg-app-card px-4 pt-3 pb-1.5 transition-colors ${
        failed
          ? "border-red-500/30 hover:border-red-500/50"
          : "border-app-ink/10 hover:border-app-ink/20"
      }`}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
        <KindLabel artifact={artifact} />
        <StatusBadge artifact={artifact} />
        <FlagChips artifact={artifact} />
        <PublishChip artifact={artifact} target={actions.publishTarget} />
        <span className="ml-auto shrink-0 text-app-ink/50">
          <RelativeTime timestamp={artifact.timestamp} />
        </span>
      </header>
      <button
        type="button"
        onClick={() => actions.open(artifact)}
        className="flex min-w-0 flex-col gap-1 text-left"
      >
        <ChannelsLine channels={artifact.scope?.channels ?? []} search={term} />
        <span
          dir="auto"
          data-testid="artifact-title"
          className="line-clamp-2 text-start text-[13px] leading-relaxed text-app-ink/80"
        >
          {highlightText(title, term)}
        </span>
      </button>
      <PublishBody artifact={artifact} target={actions.publishTarget} />
      {!compact && (
        <>
          <WindowLine artifact={artifact} onUseScope={actions.useScope} />
          <ActedBy artifact={artifact} />
          {artifact.note && (
            <p
              dir="auto"
              data-testid="artifact-note"
              className="break-words rounded-lg bg-app-ink/5 px-3 py-2 text-[12px] text-app-ink/70"
            >
              {highlightText(artifact.note, term)}
            </p>
          )}
        </>
      )}
      <footer className="mt-auto flex items-center gap-x-2 border-t border-app-ink/5 pt-1.5 text-[12px] text-app-ink/50">
        {/* The header's badge already says Failed or Awaiting response. */}
        <span data-testid="artifact-detail" className="min-w-0 truncate">
          {failed || isPendingArtifact(artifact)
            ? ""
            : artifactDetail(artifact)}
        </span>
        <CardActions artifact={artifact} compact={compact} actions={actions} />
      </footer>
    </article>
  )
}
