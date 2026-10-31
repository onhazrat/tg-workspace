/**
 * An Artifact's completeness record said in words (CW-02), for the banner on its
 * page, the re-check now, and History's pill. The server froze the record;
 * this only phrases it.
 */

import type { Completeness, CompletenessMark } from "@/client"
import type { ArtifactKind } from "@/types"
import type { ActionKind } from "./gate"
import {
  byFix,
  measure,
  unprovenCount,
  type Verdict,
  type WindowCheck,
} from "./window-check"

export type { ArtifactKind }

/** The record as a check, so the live banner can show it. */
export function recordCheck(record: Completeness): WindowCheck {
  return {
    frozenAt: record.frozenAt,
    start: record.start,
    end: record.end,
    channels: record.channels,
    heldPosts: record.heldPosts,
    unprovenPosts: record.unprovenPosts,
    unprovenFloor: record.unprovenFloor,
  }
}

/** A read carries the whole record; a list only the mark. */
export function isRecord(
  value: Completeness | CompletenessMark | null | undefined,
): value is Completeness {
  return !!value && "channels" in value
}

/** "~6 Posts unproven", "~40+ Posts unproven", "no Posts expected". */
export function pillPhrase(mark: CompletenessMark): string {
  const count = unprovenCount(mark.unprovenPosts, mark.unprovenFloor)
  return mark.unprovenPosts === 0 && !mark.unprovenFloor
    ? count
    : `${count} unproven`
}

/** "now 2 holes", or "complete now", for the window checked again. */
export function nowPhrase(now: Verdict[]): string {
  return now.length === 0 ? "complete now" : `now ${measure(now)}`
}

/** The action a Regenerate runs; a Chat has none. */
export function regenerateAction(kind: ArtifactKind): ActionKind | null {
  return (
    {
      summary: "summary",
      chat: null,
      tag: "tags",
      discovery: "discover",
    } as const
  )[kind]
}

/**
 * Regenerate is offered when a sync can change the answer, or the window is
 * Complete now; never for a Chat.
 */
export function offersRegenerate(kind: ArtifactKind, now: Verdict[]): boolean {
  if (!regenerateAction(kind)) return false
  const { problems, behind } = byFix(now)
  return now.length === 0 || problems.length + behind.length > 0
}
