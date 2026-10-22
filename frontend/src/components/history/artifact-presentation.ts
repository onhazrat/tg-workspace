import type { ArtifactKind, ArtifactListItem } from "@/types"

/**
 * How each artifact kind presents itself in the unified History list.
 *
 * One table rather than a branch per call site: the kind badge, the icon and
 * the "what does this row count" line are all per-kind, and keeping them
 * together is what stops a fifth kind being added to three of the four places
 * that need it.
 */
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  summary: "Summary",
  chat: "Chat",
  tag: "Tag run",
  discovery: "Discovery",
}

/** Lucide icon names, resolved by the card. */
export const ARTIFACT_KIND_ICONS: Record<ArtifactKind, string> = {
  summary: "FileText",
  chat: "MessageSquare",
  tag: "Tag",
  discovery: "Compass",
}

/**
 * The one line of detail that distinguishes this row from its siblings.
 *
 * Deliberately not "everything the row knows" — the list is a list, and each
 * kind has exactly one number worth reading at a glance.
 */
export function artifactDetail(artifact: ArtifactListItem): string {
  switch (artifact.kind) {
    case "summary": {
      const failed = failedAttempts(artifact)
      if (failed !== null)
        return `${failed} failed attempt${failed === 1 ? "" : "s"}`
      return artifact.status === "pending"
        ? "Awaiting response"
        : `${artifact.postCount ?? 0} posts`
    }
    case "chat":
      return `${artifact.messageCount ?? 0} messages · ${
        artifact.mode === "semantic" ? "Semantic" : "Selected posts"
      }`
    case "tag":
      return `${artifact.mode === "remove" ? "Remove" : "Add"} mode · ${
        artifact.status
      }`
    case "discovery":
      return `${artifact.candidateCount ?? 0} candidates`
  }
}

/** The channels an artifact was made from, as the card's heading. */
export function artifactChannelsLine(artifact: ArtifactListItem): string {
  const channels = artifact.scope?.channels
  return channels?.length ? channels.join(", ") : "No channels"
}

/** An Artifact's name for a screen reader or a toast: kind, then title or Channels. */
export function artifactName(artifact: ArtifactListItem): string {
  const what = artifact.title || artifactChannelsLine(artifact)
  const shown = what.length > 40 ? `${what.slice(0, 40)}…` : what
  return `${ARTIFACT_KIND_LABELS[artifact.kind]}: ${shown}`
}

/**
 * A Failed Summary's count of failed Attempts (SFR-01), or `null` for any
 * other row. Failed is a Summary's state only; Tag runs join later.
 */
export function failedAttempts(artifact: ArtifactListItem): number | null {
  return artifact.kind === "summary" && artifact.status === "failed"
    ? (artifact.failedAttempts ?? 0)
    : null
}

/** A pending artifact is one whose externally-run prompt has not come back. */
export function isPendingArtifact(artifact: ArtifactListItem): boolean {
  return (
    (artifact.kind === "summary" || artifact.kind === "tag") &&
    artifact.status === "pending"
  )
}
