/**
 * The Account's Tags as the Directory reads them (DFP-04, ADR-029): the one
 * tagging shape every picker takes, what "In the Tag" can name, and the one
 * case-insensitive name comparison.
 */
import type { TagResponse } from "@/client"
import {
  isVirtualGroupTag,
  toVirtualGroupTagName,
} from "@/lib/channels/virtual-group-tags"
import { type DirectoryCond, namedTag } from "./directory-filter"

/** Put a Tag on handles or take it off: a row, the panel and the bulk bar. */
export type Tagging = {
  tags: TagResponse[]
  onTag: (name: string, handles: string[]) => void
  onUntag: (name: string, handles: string[]) => void
}

/** What "In the Tag" can name: the Account's Tags and its Setting groups' (DFP-04). */
export type TagChoices = {
  tags: TagResponse[]
  /** Setting group names; each is the Tag `group:<name>`. */
  groups: string[]
  /** Until both lists arrive, no Tag is known to be missing. */
  loaded: boolean
}

/** Whether two names are one Tag: trimmed, compared case-insensitively. */
export const sameTag = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Every name "In the Tag" and a Seed source can take: the listed Tags, then
 * each Setting group the list leaves out because it has no followed Channel.
 */
export function tagNames(choices: TagChoices): string[] {
  const listed = choices.tags.map((t) => t.name)
  const groups = choices.groups
    .map(toVirtualGroupTagName)
    .filter((g) => !listed.some((name) => sameTag(name, g)))
  return [...listed, ...groups]
}

/** The Tags a person can put on or take off: a `group:` one is derived. */
export const ownTags = (tags: TagResponse[]) =>
  tags.filter((t) => !isVirtualGroupTag(t.name))

/**
 * Why a Condition naming a Tag matches nothing: the reader has no Tag of that
 * name, as In the Tag or as its Seeds (DFP-05).
 */
export function staleTag(cond: DirectoryCond, choices: TagChoices) {
  const name = namedTag(cond)
  if (name === undefined || !choices.loaded) return undefined
  const known = isVirtualGroupTag(name)
    ? choices.groups.some((g) => sameTag(toVirtualGroupTagName(g), name))
    : choices.tags.some((t) => sameTag(t.name, name))
  return known
    ? undefined
    : `You have no Tag named "${name}", so this matches nothing`
}
