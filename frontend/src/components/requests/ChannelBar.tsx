import { Gauge, Layers, Search, Tag } from "lucide-react"
import { useMemo } from "react"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import {
  canManage,
  useVariant,
} from "@/components/channel-tags-prototype/store"
import { TagFacet } from "@/components/channel-tags-prototype/TagFacet"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import {
  FilterRow,
  type FilterVocabulary,
} from "@/components/filter-tree/FilterRow"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { TgInput } from "@/components/ui/tg-input"
import { useTags } from "@/hooks/useTags"
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
  /** PROTOTYPE (channel-tags-usage): the pick boxes, which a Tag's tick sets. */
  leftOut?: ReadonlySet<string>
  onLeftOut?: (leftOut: Set<string>) => void
}

/**
 * The Channel table's search and filters (RQS-04), built from the Channels
 * tab's own pieces: a Kinds facet, Hide uncharged, the Filters menu over every
 * measure, the sort picker, and the filter row under them.
 */
export function ChannelBar(p: ChannelBarProps) {
  const variant = useVariant()
  return canManage(variant) ? (
    <ChannelBarWithTags {...p} variant={variant} />
  ) : (
    <ChannelBarBody {...p} variant={variant} tagNames={null} />
  )
}

/** PROTOTYPE (channel-tags-usage): variant A's hooks, kept out of variant 0. */
function ChannelBarWithTags(p: ChannelBarProps & { variant: string }) {
  const tagNames = useTags().tags.map((t) => t.name)
  return <ChannelBarBody {...p} tagNames={tagNames} />
}

function ChannelBarBody({
  variant,
  tagNames,
  ...p
}: ChannelBarProps & { variant: string; tagNames: string[] | null }) {
  const kinds = KINDS.map((k) => k.id).filter((k) => !p.hiddenKinds.has(k))
  const groups = criteria(kinds, p.hiddenOutcomes)
  const values = useMeasureValues(p.rows)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
        <SearchBox value={p.search} onChange={p.onSearch} />
        <KindsFacet {...p} kinds={kinds} />
        {tagNames && (
          <TagFacet
            tab="requests"
            variant={variant}
            testId="requests-tags"
            scope={p.rows.filter((r) => !r.aggregate).map((r) => r.key)}
            tickHint="Unticking leaves out, the funnel shows only"
            members={(handles) =>
              p.rows
                .filter((r) => !r.aggregate && handles.has(r.key.toLowerCase()))
                .map((r) => r.id)
            }
            selected={
              new Set(
                p.rows.map((r) => r.id).filter((id) => !p.leftOut?.has(id)),
              )
            }
            onSelect={(ids, on) => {
              const next = new Set(p.leftOut)
              for (const id of ids) on ? next.delete(id) : next.add(id)
              p.onLeftOut?.(next)
            }}
            funnelled={funnelledValues(p.filter, "tag")}
            onFunnel={(id, on) =>
              p.onFilter(
                on
                  ? addFunnel(p.filter, { type: "tag", value: id })
                  : removeFunnel(p.filter, "tag", id),
              )
            }
            onClearFunnels={() => p.onFilter(clearFunnels(p.filter, "tag"))}
          />
        )}
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
        vocabulary={vocabulary(p, kinds, groups, values, tagNames)}
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
  /** PROTOTYPE: the Tag names "In the Tag" offers; null outside variant A. */
  tagNames: string[] | null,
): FilterVocabulary<ChannelCond> {
  return {
    sections: [
      ...(tagNames
        ? [
            {
              heading: "Tag",
              entries: [
                {
                  kind: "list" as const,
                  id: "tag",
                  label: "In the Tag",
                  icon: Tag,
                  options: tagNames.map((name) => ({ id: name, label: name })),
                  make: (value: string): ChannelCond => ({
                    type: "tag",
                    value,
                  }),
                  current: (c: ChannelCond) =>
                    c.type === "tag" ? c.value : undefined,
                },
              ],
            },
          ]
        : []),
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
    label: condLabel,
    icon: (c) =>
      c.type === "measure" ? Gauge : c.type === "tag" ? Tag : Layers,
    chipId: (c) =>
      c.type === "tag"
        ? `tag-${c.value}`
        : c.type === "kind"
          ? c.value
          : c.type === "uncharged"
            ? "uncharged"
            : `${c.kind ?? "row"}-${c.measure}`,
    stale: (c) => staleReason(c, p.hiddenKinds, p.hiddenOutcomes),
  }
}
