/**
 * The Account's Tags as the Directory reads them (DFP-04, ADR-029): the one
 * tagging shape every picker takes, what "In the Tag" can name, and the one
 * case-insensitive name comparison.
 */
import type { TagResponse } from "@/client"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import { type DirectoryCond, namedTag } from "./directory-filter"

/** Put a Tag on handles or take it off: a row, the panel and the bulk bar. */
export type Tagging = {
  tags: TagResponse[]
  onTag: (name: string, handles: string[]) => void
  onUntag: (name: string, handles: string[]) => void
}

/** What "In the Tag" and "In the Setting group" can name (DFP-04, TGU-04). */
export type TagChoices = {
  tags: TagResponse[]
  /** The Account's Setting group names. */
  groups: string[]
  /** Until both lists arrive, no Tag is known to be missing. */
  loaded: boolean
}

/** Whether two names are one Tag: trimmed, compared case-insensitively. */
export const sameTag = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/** Every name "In the Tag" and a Tag Seed source can take: no `group:` one. */
export const tagNames = (choices: TagChoices): string[] =>
  ownTags(choices.tags).map((t) => t.name)

/** The Tags a person can put on or take off: a `group:` one is derived. */
export const ownTags = (tags: TagResponse[]) =>
  tags.filter((t) => !isVirtualGroupTag(t.name))

/** The Setting group a Condition names, as In the group or as its Seeds. */
function namedGroup(cond: DirectoryCond): string | undefined {
  if (cond.type === "group") return cond.name
  if ("seeds" in cond && cond.seeds.kind === "group") return cond.seeds.name
  return undefined
}

/**
 * Why a Condition naming a Tag or a Setting group matches nothing: the reader
 * has none of that name, as In the Tag or the group or as its Seeds (DFP-05).
 */
export function staleTag(cond: DirectoryCond, choices: TagChoices) {
  if (!choices.loaded) return undefined
  const tag = namedTag(cond)
  if (tag !== undefined && !choices.tags.some((t) => sameTag(t.name, tag)))
    return `You have no Tag named "${tag}", so this matches nothing`
  const group = namedGroup(cond)
  if (group !== undefined && !choices.groups.some((g) => sameTag(g, group)))
    return `You have no Setting group named "${group}", so this matches nothing`
  return undefined
}
