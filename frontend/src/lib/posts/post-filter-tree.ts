/**
 * The Posts filter tree: the Channels filter's tree (`lib/filter-tree.ts`)
 * over Post Conditions. The shape is the wire shape `PostScopeRequest.filter`
 * takes, Condition for Condition, so the fold-in sends it unchanged.
 *
 * PROTOTYPE (post-card): the staging backend has no `filter` field yet, so
 * the prototype runs `matchesPostFilter` over the loaded pages and calls its
 * counts approximate. The server tree (`app/services/post_filters.py`) is
 * the real implementation; see docs/post-filter-tree-plan.md.
 */
import {
  boundText,
  inBound,
  type MetricBound,
} from "@/lib/channels/channel-metrics"
import { emptyTree, evalTree, type FilterTree } from "@/lib/filter-tree"
import { postViewValue, type ViewEstimate } from "@/lib/posts/estimated-views"
import { languageLabel, POST_TYPE_OPTIONS } from "@/lib/posts/post-filter-bar"
import {
  MEDIA_KIND_OPTIONS,
  type MediaKind,
  matchesMediaFilter,
} from "@/lib/posts/post-media"
import type { ViewMeasure } from "@/lib/posts/post-view"
import type { Channel, Post } from "@/types"

export type PostTypeValue = "forwarded" | "original" | "unfollowed_forwarded"

export type TypeCond = { type: "type"; value: PostTypeValue }
export type MediaCond = { type: "media"; value: MediaKind }
export type LanguageCond = { type: "language"; value: string }
/** A bound on one view measure; `none` passes only a Post with no value. */
export type ViewsCond = { type: "views"; measure: ViewMeasure } & MetricBound
export type PostCond = TypeCond | MediaCond | LanguageCond | ViewsCond
export type PostValueCond = TypeCond | MediaCond | LanguageCond

export type PostFilterTree = FilterTree<PostCond>

export const emptyPostFilter = (): PostFilterTree => emptyTree<PostCond>()

export type PostFilterInputs = {
  /** The followed Channels, for "forwarded from unfollowed". */
  channels: Channel[]
  estimate: ViewEstimate | null | undefined
}

/** One Condition on one Post; the facet menus count a row's selection with it. */
export function matchesPostCond(
  cond: PostCond,
  post: Post,
  inputs: PostFilterInputs,
): boolean {
  switch (cond.type) {
    case "type": {
      const from = post.forwardedFrom
      if (cond.value === "original") return !from
      if (cond.value === "forwarded") return !!from
      return (
        !!from &&
        !inputs.channels.some(
          (c) => c.name.toLowerCase() === from.toLowerCase(),
        )
      )
    }
    case "media":
      return matchesMediaFilter(post, [cond.value])
    case "language":
      // An unread Post (`language` null) has no Language to match.
      return post.language === cond.value
    case "views": {
      const v = postViewValue(post, cond.measure, inputs.estimate)
      if (cond.none) return v == null
      return v != null && inBound(v, cond)
    }
  }
}

/** Whether a Post passes the tree, as the server's tree will decide it. */
export const matchesPostFilter = (
  tree: PostFilterTree,
  post: Post,
  inputs: PostFilterInputs,
): boolean => evalTree(tree, (cond) => matchesPostCond(cond, post, inputs))

const MEASURE_LABEL: Record<ViewMeasure, string> = {
  views: "Views",
  estimated: "Est. views",
}

export function postConditionLabel(cond: PostCond): string {
  switch (cond.type) {
    case "type":
      return (
        POST_TYPE_OPTIONS.find((o) => o.value === cond.value)?.label ??
        cond.value
      )
    case "media":
      return (
        MEDIA_KIND_OPTIONS.find((o) => o.value === cond.value)?.label ??
        cond.value
      )
    case "language":
      return languageLabel(cond.value)
    case "views":
      return `${MEASURE_LABEL[cond.measure]} ${boundText(cond)}`
  }
}
