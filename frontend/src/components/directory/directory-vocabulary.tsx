/**
 * The Directory filter's Conditions as the shared condition picker and filter
 * row read them (DIR-02), grouped as Channel, Size and activity, Content and
 * References. A bound's editor is the container's, since it reads the server.
 */
import {
  CircleDot,
  CornerDownLeft,
  CornerUpRight,
  GitFork,
  Hash,
  Inbox,
  Languages,
  type LucideIcon,
  Tag,
  Type,
  Users,
} from "lucide-react"
import type React from "react"
import type { DirectoryLanguageCountResponse, TagResponse } from "@/client"
import type {
  ConditionOption,
  PickerEntry,
} from "@/components/filter-tree/ConditionPicker"
import type { FilterVocabulary } from "@/components/filter-tree/FilterRow"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import {
  isVirtualGroupTag,
  toVirtualGroupTagName,
} from "@/lib/channels/virtual-group-tags"
import {
  type DirectoryCond,
  type DirectoryFlag,
  directoryConditionLabel,
  FLAG_LABEL,
  HANDLES_LABEL,
  MEASURES,
  type Measure,
  type MeasureSection,
  type PickSets,
  SHARED_LABEL,
} from "@/lib/directory/directory-filter"
import { languageLabel } from "@/lib/posts/post-filter-bar"
import {
  HandlesEditor,
  MineEditor,
  NameEditor,
  SharedEditor,
} from "./DirectoryConditionEditors"

const ICON: Record<DirectoryCond["type"], LucideIcon> = {
  language: Languages,
  name: Type,
  tag: Tag,
  flag: CircleDot,
  mine: Inbox,
  citedby: CornerDownLeft,
  cites: CornerUpRight,
  parents: Users,
  children: GitFork,
  measure: Hash,
}

/** Renders one measure's bound editor, wired to the server by the container. */
export type MeasureEditorRender = (props: {
  measure: Measure
  initial?: MetricBound
  onSubmit: (cond: DirectoryCond) => void
  onBack: () => void
}) => React.ReactNode

const measureEntries = (
  section: MeasureSection,
  render: MeasureEditorRender,
): PickerEntry<DirectoryCond>[] =>
  MEASURES.filter((m) => m.section === section).map((measure) => ({
    kind: "editor",
    id: `measure:${measure.key}`,
    label: measure.label,
    icon: Hash,
    render: ({ start, onSubmit, onBack }) =>
      render({
        measure,
        initial: start?.type === "measure" ? start : undefined,
        onBack,
        onSubmit,
      }),
  }))

/** What "In the Tag" can name: the Account's Tags and its Setting groups' (DFP-04). */
export type TagChoices = {
  tags: TagResponse[]
  /** Setting group names; each is the Tag `group:<name>`. */
  groups: string[]
  /** Until both lists arrive, no Tag is known to be missing. */
  loaded: boolean
}

const lower = (s: string) => s.trim().toLowerCase()

/** Why a `tag` Condition matches nothing: the reader has no Tag of that name. */
export function staleTag(cond: DirectoryCond, choices: TagChoices) {
  if (cond.type !== "tag" || !choices.loaded) return undefined
  const known = isVirtualGroupTag(cond.name)
    ? choices.groups.some(
        (g) => lower(toVirtualGroupTagName(g)) === lower(cond.name),
      )
    : choices.tags.some((t) => lower(t.name) === lower(cond.name))
  return known
    ? undefined
    : `You have no Tag named "${cond.name}", so this matches nothing`
}

/** The Languages a count read named, as picker options; "no Language" has none. */
const languageOptions = (
  counts: DirectoryLanguageCountResponse[],
): ConditionOption[] =>
  counts.flatMap(({ language, count }) =>
    language
      ? [{ id: language, label: languageLabel(language), hint: String(count) }]
      : [],
  )

export function directoryVocabulary(
  languageCounts: DirectoryLanguageCountResponse[],
  renderMeasure: MeasureEditorRender,
  /** What Shared parents / children can compare with, as it is now (DIR-07). */
  sets: PickSets,
  tags: TagChoices = { tags: [], groups: [], loaded: false },
): FilterVocabulary<DirectoryCond> {
  const languages = languageOptions(languageCounts)
  return {
    sections: [
      {
        heading: "Channel",
        entries: [
          {
            kind: "list",
            id: "language",
            label: "Language",
            icon: Languages,
            options: languages,
            make: (value) => ({ type: "language", value }),
            current: (c) => (c.type === "language" ? c.value : undefined),
          },
          {
            kind: "list",
            id: "flag",
            label: "Followed, dismissed or followable",
            icon: CircleDot,
            options: (Object.keys(FLAG_LABEL) as DirectoryFlag[]).map((id) => ({
              id,
              label: FLAG_LABEL[id],
            })),
            make: (value) => ({ type: "flag", value: value as DirectoryFlag }),
            current: (c) => (c.type === "flag" ? c.value : undefined),
          },
          {
            kind: "list",
            id: "tag",
            label: "In the Tag",
            icon: Tag,
            options: [
              ...tags.tags.map((t) => ({
                id: t.name,
                label: t.name,
                hint: String(t.channels),
              })),
              ...tags.groups.map((g) => ({
                id: toVirtualGroupTagName(g),
                label: toVirtualGroupTagName(g),
              })),
            ],
            make: (name) => ({ type: "tag", name }),
            current: (c) => (c.type === "tag" ? c.name : undefined),
          },
          {
            kind: "editor",
            id: "name",
            label: "Name contains",
            icon: Type,
            render: ({ start, ...rest }) => (
              <NameEditor
                start={start?.type === "name" ? start : undefined}
                {...rest}
              />
            ),
          },
        ],
      },
      {
        heading: "Size and activity",
        entries: measureEntries("Size and activity", renderMeasure),
      },
      { heading: "Content", entries: measureEntries("Content", renderMeasure) },
      {
        heading: "References",
        entries: [
          {
            kind: "editor",
            id: "mine",
            label: "Cited by your channels",
            icon: Inbox,
            render: ({ start, ...rest }) => (
              <MineEditor
                start={start?.type === "mine" ? start : undefined}
                {...rest}
              />
            ),
          },
          ...measureEntries("References", renderMeasure),
          ...(["citedby", "cites"] as const).map(
            (type): PickerEntry<DirectoryCond> => ({
              kind: "editor",
              id: type,
              label: `${HANDLES_LABEL[type]} @channel`,
              icon: ICON[type],
              render: ({ start, ...rest }) => (
                <HandlesEditor
                  type={type}
                  start={start?.type === type ? start : undefined}
                  {...rest}
                />
              ),
            }),
          ),
          ...(["parents", "children"] as const).map(
            (type): PickerEntry<DirectoryCond> => ({
              kind: "editor",
              id: type,
              label: `${SHARED_LABEL[type]} with…`,
              icon: ICON[type],
              render: ({ start, ...rest }) => (
                <SharedEditor
                  type={type}
                  sets={sets}
                  start={start?.type === type ? start : undefined}
                  {...rest}
                />
              ),
            }),
          ),
        ],
      },
    ],
    entryOf: (c) => (c.type === "measure" ? `measure:${c.measure}` : c.type),
    label: (c) => directoryConditionLabel(c),
    icon: (c) => ICON[c.type],
    stale: (c) => staleTag(c, tags),
    chipId: (c) =>
      c.type === "measure"
        ? `measure-${c.measure}`
        : c.type === "parents" || c.type === "children"
          ? `${c.type}-${c.picks}`
          : c.type === "tag"
            ? `tag-${c.name}`
            : "value" in c
              ? `${c.type}-${c.value}`
              : "handles" in c
                ? `${c.type}-${c.handles.join("-")}`
                : c.type,
  }
}
