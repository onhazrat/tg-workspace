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

/**
 * Each kind's icon colour, clear of Failed red, Pending amber and the green
 * and blue of the schedule flags, so colour never says a state.
 */
export const ARTIFACT_KIND_COLORS: Record<ArtifactKind, string> = {
  summary: "text-sky-500",
  chat: "text-violet-500",
  tag: "text-orange-500",
  discovery: "text-teal-500",
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

/**
 * A title as plain text: no markdown emphasis or code marks, no leading
 * heading marks, then no leading emoji or whitespace. A Summary's title is
 * the start of its markdown body.
 */
export const plainTitle = (text: string) =>
  text
    .replace(/\*\*|__|`|^#+\s*/g, "")
    .replace(/^(?:\s|\p{Extended_Pictographic}|\uFE0F)+/u, "")
    .trim()

/**
 * The channel line's order under a search: the matching channels first, so a
 * match is never hidden in the "+N", each part in Scope order.
 */
export function channelsMatchingFirst(
  channels: readonly string[],
  search: string,
): string[] {
  const term = search.trim().toLowerCase()
  if (!term) return [...channels]
  const hit = (c: string) => c.toLowerCase().includes(term)
  return [...channels.filter(hit), ...channels.filter((c) => !hit(c))]
}

/** An Artifact's id in History's list: `kind:id`, since ids are per kind. */
export const artifactKey = (a: ArtifactListItem) => `${a.kind}:${a.id}`
