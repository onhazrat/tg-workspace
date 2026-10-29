import { Gauge, Layers, Search, Tag } from "lucide-react"
import { useMemo } from "react"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import {
  FilterRow,
  type FilterVocabulary,
} from "@/components/filter-tree/FilterRow"
import {
  type GroupRow,
  GroupsDropdown,
  useGroupRows,
  useOpenSettingGroup,
} from "@/components/filter-tree/GroupsDropdown"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { TagsDropdown } from "@/components/filter-tree/TagsDropdown"
import { TgInput } from "@/components/ui/tg-input"
import { useTags } from "@/hooks/useTags"
import { useTagUses } from "@/hooks/useTagUses"
import { isVirtualGroupTag } from "@/lib/channels/virtual-group-tags"
import {
  addFunnel,
  atoms,
  clearFunnels,
  funnelledValues,
  removeFunnel,
  setSwitch,
  switchOn,
} from "@/lib/filter-tree"
import {
  type ChannelRow,
  type ChannelSort,
  KINDS,
  kindMeta,
  type Measure,
  measureOf,
  type Outcome,
  type SortDirection,
  selectHandles,
} from "@/lib/requests/breakdown"
import {
  addCond,
  type ChannelCond,
  type ChannelFilter,
  type CriteriaGroup,
  condLabel,
  criteria,
  emptyChannelFilter,
  isUncharged,
  measureLabel,
  measureMeta,
  staleReason,
} from "@/lib/requests/channel-filter"
import { byTagUse } from "@/lib/tags/tag-use"
import {
  MeasureMenu,
  MeasureNumberEditor,
  type MeasureValues,
} from "./MeasureMenu"

export interface ChannelBarProps {
  /** Every row before the search and the filter: the counts and histograms. */
  rows: readonly ChannelRow[]
  /** How many rows the search and the filter keep. */
  shown: number
  search: string
  onSearch: (search: string) => void
  filter: ChannelFilter
  onFilter: (filter: ChannelFilter) => void
  sort: ChannelSort
  onSort: (sort: ChannelSort) => void
  direction: SortDirection
  onToggleDirection: () => void
  hiddenKinds: ReadonlySet<string>
  hiddenOutcomes: ReadonlySet<Outcome>
  /** The rows out of the Requests selection, which a Tag's select sets. */
  leftOut: ReadonlySet<string>
  onLeftOut: (leftOut: Set<string>) => void
}

/**
 * The Channel table's search and filters (RQS-04), built from the Channels
 * tab's own pieces: a Kinds facet, Hide uncharged, the Filters menu over every
 * measure, the sort picker, and the filter row under them.
 */
export function ChannelBar(p: ChannelBarProps) {
  const kinds = KINDS.map((k) => k.id).filter((k) => !p.hiddenKinds.has(k))
  const groups = criteria(kinds, p.hiddenOutcomes)
  const values = useMeasureValues(p.rows)
  const tagNames = useRequestsTagNames()
  const groupRows = useGroupRows(null)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
        <SearchBox value={p.search} onChange={p.onSearch} />
        <KindsFacet {...p} kinds={kinds} />
        <RequestsTags {...p} />
        <RequestsGroups {...p} />
        <BarToggle
          on={switchOn(p.filter, isUncharged, true)}
          label="Hide uncharged"
          title="Leave out the rows of work with no Channel, such as Directory probes and Handle checks, which no Account pays for"
          testId="requests-switch-uncharged"
          onClick={() =>
            p.onFilter(
              setSwitch(
                p.filter,
                isUncharged,
                { type: "uncharged" },
                true,
                !switchOn(p.filter, isUncharged, true),
              ),
            )
          }
        />
        <MeasureMenu
          conditions={atoms(p.filter).flatMap((a) =>
            a.cond.type === "measure" ? [{ not: !!a.not, cond: a.cond }] : [],
          )}
          groups={groups}
          values={values}
          onAdd={(cond) => p.onFilter(addCond(p.filter, cond))}
        />
        <SortPicker<ChannelSort>
          options={[
            ...groups[0].measures.map((m) => ({
              value: m as ChannelSort,
              label: measureMeta(m).label,
            })),
            { value: "channel", label: "Channel name" },
          ]}
          value={p.sort}
          onChange={p.onSort}
          direction={p.direction}
          onToggleDirection={p.onToggleDirection}
          testId="requests-sort"
        />
      </div>
      <FilterRow
        filter={p.filter}
        onChange={p.onFilter}
        vocabulary={vocabulary(p, kinds, groups, values, tagNames, groupRows)}
        testId="requests-filter"
        search={p.search}
        shownCount={p.shown}
        totalCount={p.rows.length}
        onClearSearch={() => p.onSearch("")}
        onClearAll={() => {
          p.onFilter(emptyChannelFilter())
          p.onSearch("")
        }}
      />
    </>
  )
}

function SearchBox({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative min-w-[180px] flex-1">
      <Search
        size={13}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 my-auto text-app-ink/40"
      />
      <TgInput
        type="search"
        variant="muted"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search Channels"
        aria-label="Search Channels"
        className="h-8 py-0 pl-9"
      />
    </div>
  )
}

/** The Kinds facet: each shown kind with how many rows have that work. */
function KindsFacet({
  rows,
  filter,
  onFilter,
  kinds,
}: ChannelBarProps & { kinds: string[] }) {
  return (
    <FacetMenu
      icon={<Layers size={12} />}
      label="Kinds"
      noun="kind"
      testId="requests-kinds"
      countLabel="rows"
      rows={kinds.map((id) => ({
        id,
        label: kindMeta(id).label,
        hint: kindMeta(id).charged ? undefined : "uncharged",
        selected: 0,
        total: rows.filter((r) => r.kinds.has(id)).length,
        tick: "false" as const,
      }))}
      funnelled={funnelledValues(filter, "kind")}
      labelOf={(id) => kindMeta(id).label}
      onFunnel={(id, on) =>
        onFilter(
          on
            ? addFunnel(filter, { type: "kind", value: id })
            : removeFunnel(filter, "kind", id),
        )
      }
      onClearFunnels={() => onFilter(clearFunnels(filter, "kind"))}
    />
  )
}

/** The Tags dropdown (TGU-03): selecting a Tag puts its rows back in the
 * Requests selection, unselecting takes them out of every total. */
function RequestsTags(p: ChannelBarProps) {
  const channels = p.rows.filter((r) => !r.aggregate)
  return (
    <TagsDropdown
      tab="requests"
      testId="requests-tags"
      tickHint="Unselecting takes out, the funnel shows only"
      scope={channels.map((r) => r.key)}
      selected={channels.filter((r) => !p.leftOut.has(r.id)).map((r) => r.key)}
      onSelect={(handles, on) =>
        p.onLeftOut(selectHandles(p.leftOut, p.rows, handles, on))
      }
      funnelled={funnelledValues(p.filter, "tag")}
      onFunnel={(value, on) =>
        p.onFilter(
          on
            ? addFunnel(p.filter, { type: "tag", value })
            : removeFunnel(p.filter, "tag", value),
        )
      }
      onClearFunnels={() => p.onFilter(clearFunnels(p.filter, "tag"))}
    />
  )
}

/** The Groups dropdown (TGU-04): selecting a Setting group puts its rows back
 * in the Requests selection; its funnel is the Setting group Condition. */
function RequestsGroups(p: ChannelBarProps) {
  const openSettingGroup = useOpenSettingGroup()
  const channels = p.rows.filter((r) => !r.aggregate)
  const scoped = useGroupRows(channels.map((r) => r.key))
  return (
    <GroupsDropdown
      testId="requests-groups"
      tickHint="Unselecting takes out, the funnel shows only"
      groups={scoped}
      selected={
        new Set(
          channels
            .filter((r) => !p.leftOut.has(r.id))
            .map((r) => r.key.toLowerCase()),
        )
      }
      onSelect={(handles, on) =>
        p.onLeftOut(selectHandles(p.leftOut, p.rows, handles, on))
      }
      funnelled={funnelledValues(p.filter, "group")}
      onFunnel={(value, on) =>
        p.onFilter(
          on
            ? addFunnel(p.filter, { type: "group", value })
            : removeFunnel(p.filter, "group", value),
        )
      }
      onClearFunnels={() => p.onFilter(clearFunnels(p.filter, "group"))}
      onOpen={openSettingGroup}
    />
  )
}

/** The Tag names "In the Tag" offers, in the Requests tab's Tag use order. */
function useRequestsTagNames() {
  const tags = useTags().tags.filter((t) => !isVirtualGroupTag(t.name))
  const score = useTagUses("requests")
  return byTagUse(
    tags,
    score,
    (t) => t.name,
    (t) => t.channels,
  ).map((t) => t.name)
}

/** Each measure's values across the rows, sorted once and kept per render of `rows`. */
function useMeasureValues(rows: readonly ChannelRow[]): MeasureValues {
  return useMemo(() => {
    const cache = new Map<string, number[]>()
    return (m: Measure, kind?: string) => {
      const key = `${kind ?? ""}|${m}`
      let found = cache.get(key)
      if (!found) {
        found = rows
          .flatMap((r) => {
            const v = measureOf(r, m, kind)
            return v === null ? [] : [v]
          })
          .sort((a, b) => a - b)
        cache.set(key, found)
      }
      return found
    }
  }, [rows])
}

/** What the filter row needs to name, edit and add Conditions. */
function vocabulary(
  p: ChannelBarProps,
  kinds: string[],
  groups: CriteriaGroup[],
  values: MeasureValues,
  tagNames: string[],
  settingGroups: GroupRow[],
): FilterVocabulary<ChannelCond> {
  const groupName = (id: string) =>
    settingGroups.find((g) => g.id === id)?.name ?? id
  return {
    sections: [
      {
        heading: "Tag",
        entries: [
          {
            kind: "list",
            id: "tag",
            label: "In the Tag",
            icon: Tag,
            options: tagNames.map((name) => ({ id: name, label: name })),
            make: (value) => ({ type: "tag", value }),
            current: (c) => (c.type === "tag" ? c.value : undefined),
          },
          {
            kind: "list",
            id: "group",
            label: "In the Setting group",
            icon: Layers,
            options: settingGroups.map((g) => ({ id: g.id, label: g.name })),
            make: (value) => ({ type: "group", value }),
            current: (c) => (c.type === "group" ? c.value : undefined),
          },
        ],
      },
      {
        heading: "Kind",
        entries: [
          {
            kind: "list",
            id: "kind",
            label: "Kind of work",
            icon: Layers,
            options: kinds.map((id) => ({
              id,
              label: kindMeta(id).label,
              hint: kindMeta(id).charged ? undefined : "uncharged",
            })),
            make: (value) => ({ type: "kind", value }),
            current: (c) => (c.type === "kind" ? c.value : undefined),
          },
        ],
      },
      ...groups.map((g) => ({
        heading: g.heading,
        entries: g.measures.map((m) => ({
          kind: "editor" as const,
          id: `${g.kind ?? ""}|${m}`,
          label: measureLabel(m, g.kind),
          icon: Gauge,
          render: ({
            start,
            onSubmit,
            onBack,
          }: {
            start?: ChannelCond
            onSubmit: (c: ChannelCond) => void
            onBack: () => void
          }) => (
            <MeasureNumberEditor
              measure={m}
              kind={g.kind}
              values={values(m, g.kind)}
              initial={start?.type === "measure" ? start.bound : undefined}
              onSubmit={(bound) =>
                onSubmit({ type: "measure", measure: m, kind: g.kind, bound })
              }
              onBack={onBack}
            />
          ),
        })),
      })),
    ],
    entryOf: (c) =>
      c.type === "measure" ? `${c.kind ?? ""}|${c.measure}` : c.type,
    label: (c) => condLabel(c, groupName),
    icon: (c) =>
      c.type === "measure" ? Gauge : c.type === "tag" ? Tag : Layers,
    chipId: (c) =>
      c.type === "measure"
        ? `${c.kind ?? "row"}-${c.measure}`
        : c.type === "tag" || c.type === "group"
          ? `${c.type}-${c.value}`
          : c.type === "kind"
            ? c.value
            : "uncharged",
    stale: (c) => staleReason(c, p.hiddenKinds, p.hiddenOutcomes),
  }
}
