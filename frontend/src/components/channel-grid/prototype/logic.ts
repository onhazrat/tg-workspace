/**
 * PROTOTYPE, throwaway: how the filter chips combine. Each facet with funnels
 * (groups, tags, languages) is one condition, true when the channel matches
 * any of its values, or for tags optionally all of them. Numeric bounds are
 * one condition each, or one "all/any" condition in L2. Conditions join with
 * AND or OR; AND binds tighter, so `a AND b OR c` is `(a AND b) OR c`.
 * The search box is not a chip condition: it always narrows.
 */
import { getTagNames } from "@/lib/channels/channel-tag-model"
import { findChannelPseudoTag } from "@/lib/channels/channel-tags"
import type { Channel } from "@/types"
import {
  type MetricInputs,
  type NumericFilter,
  passesNumericFilters,
} from "./metrics"

export type Mode = "any" | "all"
export type Joiner = "and" | "or"

/**
 * fixed: N2 as it was, every join AND. global (L1): one switch for every
 * join. within (L2): tags and Filters each pick any/all. connectors (L3):
 * every join is its own toggle.
 */
export type LogicKind = "fixed" | "global" | "within" | "connectors"

export type FilterLogic = {
  global: Joiner
  tags: Mode
  numeric: Mode
  /** L3: the joiner in front of a condition, by condition id. */
  before: Record<string, Joiner>
}

export const DEFAULT_LOGIC: FilterLogic = {
  global: "and",
  tags: "any",
  numeric: "all",
  before: {},
}

export type ConditionInput = {
  groups: string[]
  tags: string[]
  languages: string[]
  numeric: NumericFilter[]
  metricInputs: MetricInputs
}

export type Condition = { id: string; test: (c: Channel) => boolean }

const hasTag = (c: Channel, tag: string) => {
  const pseudo = findChannelPseudoTag(tag)
  return pseudo ? pseudo.matches(c) : getTagNames(c.tags).includes(tag)
}

/** The conditions in force, in the order the active-filters bar shows them. */
export function buildConditions(
  f: ConditionInput,
  kind: LogicKind,
  logic: FilterLogic,
): Condition[] {
  const out: Condition[] = []
  if (f.groups.length)
    out.push({
      id: "groups",
      test: (c) => f.groups.includes(c.settingGroupId ?? ""),
    })
  if (f.tags.length) {
    const all = kind !== "fixed" && kind !== "global" && logic.tags === "all"
    out.push({
      id: "tags",
      test: (c) =>
        all
          ? f.tags.every((t) => hasTag(c, t))
          : f.tags.some((t) => hasTag(c, t)),
    })
  }
  if (f.languages.length)
    out.push({
      id: "languages",
      test: (c) => f.languages.includes(c.language ?? ""),
    })
  const split = kind === "global" || kind === "connectors"
  if (split) {
    for (const n of f.numeric)
      out.push({
        id: `num:${n.metric}`,
        test: (c) => passesNumericFilters(c, [n], f.metricInputs),
      })
  } else if (f.numeric.length) {
    const any = kind === "within" && logic.numeric === "any"
    out.push({
      id: "numeric",
      test: (c) =>
        any
          ? f.numeric.some((n) => passesNumericFilters(c, [n], f.metricInputs))
          : passesNumericFilters(c, f.numeric, f.metricInputs),
    })
  }
  return out
}

export function joinerBefore(
  id: string,
  kind: LogicKind,
  logic: FilterLogic,
): Joiner {
  if (kind === "global") return logic.global
  if (kind === "connectors") return logic.before[id] ?? "and"
  return "and"
}

/** Split at every OR: the channel passes when one run passes whole. */
export function clusters(
  conds: Condition[],
  kind: LogicKind,
  logic: FilterLogic,
): Condition[][] {
  const runs: Condition[][] = []
  conds.forEach((c, i) => {
    if (i === 0 || joinerBefore(c.id, kind, logic) === "or") runs.push([c])
    else runs[runs.length - 1].push(c)
  })
  return runs
}

export function passesLogic(
  c: Channel,
  conds: Condition[],
  kind: LogicKind,
  logic: FilterLogic,
): boolean {
  if (conds.length === 0) return true
  return clusters(conds, kind, logic).some((run) => run.every((x) => x.test(c)))
}
