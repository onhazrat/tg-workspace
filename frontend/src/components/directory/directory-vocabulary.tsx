/**
 * The Directory filter's Conditions as the shared condition picker and filter
 * row read them (DIR-02), grouped as Channel, Size and activity, Content and
 * References. A bound's editor is the container's, since it reads the server.
 */
import {
  CircleDot,
  Clock,
  CornerDownLeft,
  CornerUpRight,
  GitFork,
  Hash,
  Inbox,
  Languages,
  Layers,
  type LucideIcon,
  Shapes,
  ShieldAlert,
  Tag,
  Type,
  Users,
} from "lucide-react"
import type React from "react"
import type { DirectoryLanguageCountResponse } from "@/client"
import type {
  ConditionOption,
  PickerEntry,
} from "@/components/filter-tree/ConditionPicker"
import type { FilterVocabulary } from "@/components/filter-tree/FilterRow"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { type ColumnKey, isInternal } from "@/lib/directory/directory-columns"
import {
  type DirectoryCond,
  type DirectoryFlag,
  type DirectoryTimeCond,
  directoryConditionLabel,
  FLAG_LABEL,
  HANDLES_LABEL,
  IS_LABEL,
  IS_VALUES,
  type IsField,
  MEASURES,
  type Measure,
  type MeasureSection,
  MOMENTS,
  type Moment,
  type SeedSets,
  SHARED_LABEL,
  seedForms,
} from "@/lib/directory/directory-filter"
import {
  staleTag,
  type TagChoices,
  tagNames,
} from "@/lib/directory/directory-tags"
import {
  languageLabel,
  languageValue,
  sortLanguages,
} from "@/lib/language-name"
import {
  ErrorEditor,
  HandlesEditor,
  MineEditor,
  NameEditor,
  SharedEditor,
} from "./DirectoryConditionEditors"

const ICON: Record<DirectoryCond["type"], LucideIcon> = {
  language: Languages,
  name: Type,
  tag: Tag,
  group: Layers,
  flag: CircleDot,
  mine: Inbox,
  citedby: CornerDownLeft,
  cites: CornerUpRight,
  parents: Users,
  children: GitFork,
  measure: Hash,
  is: Shapes,
  contains: ShieldAlert,
  time: Clock,
}

/** Renders one measure's bound editor, wired to the server by the container. */
export type MeasureEditorRender = (props: {
  measure: Measure
  initial?: MetricBound
  onSubmit: (cond: DirectoryCond) => void
  onBack: () => void
}) => React.ReactNode

/** Renders one moment's Time bound editor, wired to the server by the container. */
export type MomentEditorRender = (props: {
  moment: Moment
  initial?: DirectoryTimeCond
  onSubmit: (cond: DirectoryCond) => void
  onBack: () => void
}) => React.ReactNode

const measureEntries = (
  section: MeasureSection,
  render: MeasureEditorRender,
  internals: boolean,
): PickerEntry<DirectoryCond>[] =>
  MEASURES.filter(
    (m) => m.section === section && (internals || !isInternal(m.key)),
  ).map((measure) => ({
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

const momentEntries = (
  section: MeasureSection,
  render: MomentEditorRender,
  internals: boolean,
): PickerEntry<DirectoryCond>[] =>
  MOMENTS.filter(
    (m) => m.section === section && (internals || !isInternal(m.key)),
  ).map((moment) => ({
    kind: "editor",
    id: `time:${moment.key}`,
    label: moment.label,
    icon: Clock,
    render: ({ start, onSubmit, onBack }) =>
      render({
        moment,
        initial:
          start?.type === "time" && start.moment === moment.key
            ? start
            : undefined,
        onBack,
        onSubmit,
      }),
  }))

/** The verdict or the kind is exactly a value (DPF). */
const isEntry = (field: IsField): PickerEntry<DirectoryCond> => ({
  kind: "list",
  id: field,
  label: `${IS_LABEL[field]} is`,
  icon: Shapes,
  options: IS_VALUES[field].map((id) => ({ id, label: id })),
  make: (value) => ({ type: "is", field, value }),
  current: (c) => (c.type === "is" && c.field === field ? c.value : undefined),
})

/** The values a count read named, as picker options, in every menu's order. */
const languageOptions = (
  counts: DirectoryLanguageCountResponse[],
): ConditionOption[] =>
  sortLanguages(
    counts.map(({ language, count }) => ({
      value: languageValue(language),
      count,
    })),
  ).map(({ value }) => ({
    id: value,
    label: languageLabel(value),
    hint: value,
  }))

export function directoryVocabulary(
  languageCounts: DirectoryLanguageCountResponse[],
  renderMeasure: MeasureEditorRender,
  /** What Shared parents / children can compare with, as it is now (DIR-07). */
  sets: SeedSets,
  tags: TagChoices = { tags: [], groups: [], loaded: false },
  renderMoment: MomentEditorRender = () => null,
  /** A `DATA_ADMIN` reader, offered the probe queue's internals too (DPF). */
  internals = false,
): FilterVocabulary<DirectoryCond> {
  const languages = languageOptions(languageCounts)
  const offered = (column: ColumnKey) => internals || !isInternal(column)
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
          isEntry("status"),
          {
            kind: "list",
            id: "tag",
            label: "In the Tag",
            icon: Tag,
            options: tagNames(tags).map((name) => {
              const listed = tags.tags.find((t) => t.name === name)
              return {
                id: name,
                label: name,
                hint: listed && String(listed.channels),
              }
            }),
            make: (name) => ({ type: "tag", name }),
            current: (c) => (c.type === "tag" ? c.name : undefined),
          },
          {
            kind: "list",
            id: "group",
            label: "In the Setting group",
            icon: Layers,
            options: tags.groups.map((name) => ({ id: name, label: name })),
            make: (name) => ({ type: "group", name }),
            current: (c) => (c.type === "group" ? c.name : undefined),
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
        entries: [
          ...measureEntries("Size and activity", renderMeasure, internals),
          ...momentEntries("Size and activity", renderMoment, internals),
        ],
      },
      {
        heading: "Content",
        entries: measureEntries("Content", renderMeasure, internals),
      },
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
          ...measureEntries("References", renderMeasure, internals),
          ...(["citedby", "cites"] as const).map(
            (type): PickerEntry<DirectoryCond> => ({
              kind: "editor",
              id: type,
              label: `${HANDLES_LABEL[type]} @channel`,
              icon: ICON[type],
              render: ({ start, ...rest }) => (
                <HandlesEditor
                  type={type}
                  sets={sets}
                  tags={tags}
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
                  tags={tags}
                  start={start?.type === type ? start : undefined}
                  {...rest}
                />
              ),
            }),
          ),
        ],
      },
      {
        heading: "Probe queue",
        entries: [
          ...(offered("kind") ? [isEntry("kind")] : []),
          ...(offered("last_error")
            ? [
                {
                  kind: "editor" as const,
                  id: "contains",
                  label: "Last error contains",
                  icon: ShieldAlert,
                  render: ({ start, ...rest }) => (
                    <ErrorEditor
                      start={start?.type === "contains" ? start : undefined}
                      {...rest}
                    />
                  ),
                } satisfies PickerEntry<DirectoryCond>,
              ]
            : []),
          ...momentEntries("Probe queue", renderMoment, internals),
          ...measureEntries("Probe queue", renderMeasure, internals),
        ],
      },
    ],
    entryOf: (c) =>
      c.type === "measure"
        ? `measure:${c.measure}`
        : c.type === "time"
          ? `time:${c.moment}`
          : c.type === "is"
            ? c.field
            : c.type,
    label: (c) => directoryConditionLabel(c),
    icon: (c) => ICON[c.type],
    stale: (c) => staleTag(c, tags),
    chipId: (c) =>
      c.type === "measure"
        ? `measure-${c.measure}`
        : c.type === "time"
          ? `time-${c.moment}`
          : c.type === "tag" || c.type === "group"
            ? `${c.type}-${c.name}`
            : "value" in c
              ? `${c.type}-${c.value}`
              : "seeds" in c
                ? `${c.type}-${seedForms(c.seeds).id}`
                : c.type,
  }
}
