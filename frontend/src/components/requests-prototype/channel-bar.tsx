// PROTOTYPE (request-stats): the Channels table's search and filter bar, built from the
// Channels tab's own pieces (filter-tree's FacetMenu, FilterRow, SortPicker, BoundFields
// and BoundHistogram) so it reads and behaves like that tab. Never merge.
import {
  ChevronDown,
  Gauge,
  Layers,
  Search,
  SlidersHorizontal,
} from "lucide-react"
import { useMemo, useState } from "react"
import {
  BarHeading,
  BarPopover,
  BarSearch,
  MenuRowLabel,
} from "@/components/BarPopover"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { histogram } from "@/components/channel-grid/ChannelMetricEditor"
import { BoundHistogram, nice } from "@/components/filter-tree/BarHistogram"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import {
  FilterRow,
  type FilterVocabulary,
} from "@/components/filter-tree/FilterRow"
import {
  type SortDirection,
  SortPicker,
} from "@/components/filter-tree/SortPicker"
import { pillClass } from "@/components/PostFilterParts"
import { useZoomState } from "@/components/SpreadZoom"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import {
  type BoundKind,
  boundKind,
  boundText,
  inBound,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import {
  addFunnel,
  appendAnd,
  atoms,
  clearFunnels,
  emptyTree,
  evalTree,
  type FilterTree,
  funnelledValues,
  removeFunnel,
  setSwitch,
  switchOn,
} from "@/lib/filter-tree"
import {
  type ChannelRow,
  KIND_LABEL,
  KINDS,
  type Kind,
  type Outcome,
} from "./data"

export type Measure =
  | "total"
  | "idle"
  | "wasted"
  | "idleShare"
  | "wasteShare"
  | "runs"
  | "failed"
  | "posts"
  | "perRun"
  | "postsPerReq"
export type Cond =
  | { type: "kind"; value: Kind }
  /** An aggregate row standing for Uncharged work: Directory probes, Handle checks. */
  | { type: "uncharged" }
  /** A number on the whole row, or with `kind` on that kind of work's share of it alone. */
  | { type: "measure"; measure: Measure; kind?: Kind; bound: MetricBound }
export type RowFilter = FilterTree<Cond>
export const emptyRowFilter = () => emptyTree<Cond>()
const isUncharged = (c: Cond) => c.type === "uncharged"

export const MEASURES: {
  id: Measure
  label: string
  unit?: string
  outcome?: Outcome
}[] = [
  { id: "total", label: "Requests" },
  { id: "idle", label: "Idle Requests", outcome: "idle" },
  { id: "wasted", label: "Wasted Requests", outcome: "wasted" },
  { id: "idleShare", label: "Idle share", unit: "%", outcome: "idle" },
  { id: "wasteShare", label: "Wasted share", unit: "%", outcome: "wasted" },
  { id: "runs", label: "Syncs" },
  { id: "failed", label: "Failed syncs" },
  { id: "posts", label: "New Posts" },
  { id: "perRun", label: "Requests per sync" },
  { id: "postsPerReq", label: "New Posts per Request" },
]
const MEASURE = Object.fromEntries(MEASURES.map((m) => [m.id, m])) as Record<
  Measure,
  (typeof MEASURES)[number]
>

/** The numbers on the whole row: the counts of syncs only mean something per kind. */
const ROW_MEASURES: Measure[] = [
  "total",
  "idle",
  "wasted",
  "idleShare",
  "wasteShare",
  "posts",
  "postsPerReq",
]
const SYNC_MEASURES: Measure[] = [
  "total",
  "idleShare",
  "wasteShare",
  "runs",
  "failed",
  "posts",
  "perRun",
  "postsPerReq",
]
/** What each kind of work can be filtered on; probes and handle checks have no Posts or Idle. */
const KIND_MEASURES: Record<Kind, Measure[]> = {
  auto: SYNC_MEASURES,
  bulk: SYNC_MEASURES,
  single: SYNC_MEASURES,
  follow: SYNC_MEASURES,
  probe: ["total", "wasteShare", "runs", "failed"],
  handle: ["total", "wasteShare", "runs", "failed"],
}
/** A probe's run is a handle probed, and its failure a handle found unavailable. */
const KIND_WORDS: Partial<Record<Kind, Partial<Record<Measure, string>>>> = {
  probe: {
    runs: "Handles probed",
    failed: "Found unavailable",
    perRun: "Requests per probe",
  },
  handle: { runs: "Handles checked", failed: "Not found" },
}
export const measureLabel = (m: Measure, kind?: Kind) =>
  kind
    ? `${KIND_LABEL[kind]} · ${KIND_WORDS[kind]?.[m] ?? MEASURE[m].label}`
    : MEASURE[m].label

/** A row's number, or null when the row has none of that kind of work. */
export function measureOf(
  r: ChannelRow,
  m: Measure,
  kind?: Kind,
): number | null {
  const t = kind ? r.perKind.get(kind) : r
  if (!t || (kind && t.total === 0 && t.runs === 0)) return null
  if (m === "idleShare") return t.total ? (100 * t.idle) / t.total : 0
  if (m === "wasteShare") return t.total ? (100 * t.wasted) / t.total : 0
  if (m === "perRun") return t.runs ? t.total / t.runs : null
  // What a Request yields: 20 is a full page of new Posts, 0 nothing new.
  if (m === "postsPerReq") return t.total ? t.posts / t.total : null
  return t[m]
}

/** Search, then the filter; a Condition on a hidden kind or outcome stands aside rather than failing. */
export function applyRowFilter(
  rows: ChannelRow[],
  search: string,
  filter: RowFilter,
  hiddenOutcomes: Set<Outcome>,
  hiddenKinds: Set<Kind>,
) {
  const needle = search.trim().toLowerCase().replace(/^@/, "")
  return rows.filter(
    (r) =>
      (!needle || r.channel.toLowerCase().includes(needle)) &&
      evalTree(filter, (c) =>
        c.type === "kind"
          ? r.kinds.has(c.value)
          : c.type === "uncharged"
            ? r.aggregate
            : hiddenOutcomes.has(MEASURE[c.measure].outcome as Outcome) ||
              (c.kind !== undefined && hiddenKinds.has(c.kind)) ||
              inBound(measureOf(r, c.measure, c.kind), c.bound),
      ),
  )
}

const label = (c: Cond) =>
  c.type === "kind"
    ? KIND_LABEL[c.value]
    : c.type === "uncharged"
      ? "Uncharged rows"
      : `${measureLabel(c.measure, c.kind)} ${boundText(c.bound)}${MEASURE[c.measure].unit ?? ""}`

/** Every number the menu offers, the row's first and then each shown kind's. */
function criteria(kinds: Kind[], hiddenOutcomes: Set<Outcome>) {
  const shown = (m: Measure) =>
    !MEASURE[m].outcome || !hiddenOutcomes.has(MEASURE[m].outcome as Outcome)
  return [
    {
      heading: "Whole row",
      kind: undefined,
      measures: ROW_MEASURES.filter(shown),
    },
    ...kinds.map((k) => ({
      heading: KIND_LABEL[k],
      kind: k as Kind | undefined,
      measures: KIND_MEASURES[k].filter(shown),
    })),
  ]
}

export const SORTS: { value: Measure | "channel"; label: string }[] = [
  ...ROW_MEASURES.map((m) => ({ value: m, label: MEASURE[m].label })),
  { value: "channel", label: "Channel name" },
]

export function ChannelBar({
  rows,
  shown,
  search,
  onSearch,
  filter,
  onFilter,
  sort,
  onSort,
  direction,
  onToggleDirection,
  hiddenKinds,
  hiddenOutcomes,
}: {
  /** Every row before the search and the filter, for the counts and histograms. */
  rows: ChannelRow[]
  shown: number
  search: string
  onSearch: (s: string) => void
  filter: RowFilter
  onFilter: (f: RowFilter) => void
  sort: Measure | "channel"
  onSort: (s: Measure | "channel") => void
  direction: SortDirection
  onToggleDirection: () => void
  hiddenKinds: Set<Kind>
  hiddenOutcomes: Set<Outcome>
}) {
  const kinds = KINDS.filter((k) => !hiddenKinds.has(k.id))
  const groups = criteria(
    kinds.map((k) => k.id),
    hiddenOutcomes,
  )
  const values = useMemo(() => {
    const cache = new Map<string, number[]>()
    return (m: Measure, kind?: Kind) => {
      const key = `${kind ?? ""}|${m}`
      if (!cache.has(key))
        cache.set(
          key,
          rows
            .flatMap((r) => {
              const v = measureOf(r, m, kind)
              return v === null ? [] : [v]
            })
            .sort((a, b) => a - b),
        )
      return cache.get(key) as number[]
    }
  }, [rows])
  const vocabulary: FilterVocabulary<Cond> = {
    sections: [
      {
        heading: "Kind",
        entries: [
          {
            kind: "list",
            id: "kind",
            label: "Kind of work",
            icon: Layers,
            options: kinds.map((k) => ({
              id: k.id,
              label: k.label,
              hint: k.charged ? undefined : "uncharged",
            })),
            make: (value) => ({ type: "kind", value: value as Kind }),
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
            start?: Cond
            onSubmit: (c: Cond) => void
            onBack: () => void
          }) => (
            <MeasureEditor
              label={measureLabel(m, g.kind)}
              unit={MEASURE[m].unit}
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
      c.type === "kind"
        ? "kind"
        : c.type === "uncharged"
          ? "uncharged"
          : `${c.kind ?? ""}|${c.measure}`,
    label,
    icon: (c) => (c.type === "kind" || c.type === "uncharged" ? Layers : Gauge),
    chipId: (c) =>
      c.type === "kind"
        ? c.value
        : c.type === "uncharged"
          ? "uncharged"
          : `${c.kind ?? "row"}-${c.measure}`,
    stale: (c) =>
      c.type === "kind" && hiddenKinds.has(c.value)
        ? `${KIND_LABEL[c.value]} is unticked above`
        : c.type === "measure" && c.kind && hiddenKinds.has(c.kind)
          ? `${KIND_LABEL[c.kind]} is unticked above, so this stands aside`
          : c.type === "measure" &&
              MEASURE[c.measure].outcome &&
              hiddenOutcomes.has(MEASURE[c.measure].outcome as Outcome)
            ? `${MEASURE[c.measure].label} is hidden above, so this stands aside`
            : undefined,
  }
  const funnelled = funnelledValues(filter, "kind")
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 my-auto text-app-ink/40"
          />
          <TgInput
            type="text"
            variant="muted"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search channels..."
            aria-label="Search channels"
            className="h-9 py-0 pl-9"
          />
        </div>
        <FacetMenu
          icon={<Layers size={12} />}
          label="Kinds"
          noun="kind"
          testId="requests-kinds"
          countLabel="channels"
          rows={kinds.map((k) => {
            const n = rows.filter((r) => r.kinds.has(k.id)).length
            return {
              id: k.id,
              label: k.label,
              hint: k.charged ? undefined : "uncharged",
              selected: 0,
              total: n,
              tick: "false" as const,
            }
          })}
          funnelled={funnelled}
          labelOf={(id) => KIND_LABEL[id as Kind] ?? id}
          onFunnel={(id, on) =>
            onFilter(
              on
                ? addFunnel(filter, { type: "kind", value: id as Kind })
                : removeFunnel(filter, "kind", id),
            )
          }
          onClearFunnels={() => onFilter(clearFunnels(filter, "kind"))}
        />
        <BarToggle
          on={switchOn(filter, isUncharged, true)}
          label="Hide uncharged"
          title="Leave out the Directory probes and Handle checks rows, which no Account pays for"
          testId="requests-switch-uncharged"
          onClick={() =>
            onFilter(
              setSwitch(
                filter,
                isUncharged,
                { type: "uncharged" },
                true,
                !switchOn(filter, isUncharged, true),
              ),
            )
          }
        />
        <MeasureMenu
          conditions={atoms(filter).flatMap((a) =>
            a.cond.type === "measure" ? [{ not: !!a.not, cond: a.cond }] : [],
          )}
          groups={groups}
          values={values}
          onAdd={(cond) => onFilter(appendAnd(filter, cond))}
        />
        <SortPicker
          options={SORTS.filter(
            (s) =>
              s.value === "channel" || groups[0].measures.includes(s.value),
          )}
          value={sort}
          onChange={onSort}
          direction={direction}
          onToggleDirection={onToggleDirection}
          testId="requests-sort"
        />
      </div>
      <FilterRow
        filter={filter}
        onChange={onFilter}
        vocabulary={vocabulary}
        testId="requests-filter"
        search={search}
        shownCount={shown}
        totalCount={rows.length}
        onClearSearch={() => onSearch("")}
        onClearAll={() => {
          onFilter(emptyRowFilter())
          onSearch("")
        }}
      />
    </>
  )
}

/** The Filters dropdown: every number, and picking one opens its editor, as on the Channels tab. */
function MeasureMenu({
  conditions,
  groups,
  values,
  onAdd,
}: {
  /** The number Conditions anywhere in the filter, to show beside their rows. */
  conditions: { not: boolean; cond: Extract<Cond, { type: "measure" }> }[]
  groups: ReturnType<typeof criteria>
  values: (m: Measure, kind?: Kind) => number[]
  onAdd: (cond: Cond) => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<{
    measure: Measure
    kind?: Kind
  } | null>(null)
  const [query, setQuery] = useState("")
  const active = conditions.length
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setPicked(null)
      setQuery("")
    }
  }
  // "auto fail" finds Auto sync · Failed syncs: every word has to appear somewhere in the label.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (text: string) =>
    words.every((w) => text.toLowerCase().includes(w))
  return (
    <BarPopover
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button
          type="button"
          data-testid="requests-filters"
          className={pillClass(active > 0)}
        >
          <SlidersHorizontal size={12} /> Filters
          {active > 0 && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {active}
            </span>
          )}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      {picked ? (
        <MeasureEditor
          label={measureLabel(picked.measure, picked.kind)}
          unit={MEASURE[picked.measure].unit}
          values={values(picked.measure, picked.kind)}
          onBack={() => setPicked(null)}
          onSubmit={(bound) => {
            onAdd({
              type: "measure",
              measure: picked.measure,
              kind: picked.kind,
              bound,
            })
            onOpenChange(false)
          }}
        />
      ) : (
        <div className="max-h-[60vh] space-y-0.5 overflow-y-auto text-xs">
          <BarSearch
            value={query}
            onChange={setQuery}
            placeholder="Search criteria..."
          />
          {groups.map((g) => {
            const rows = g.measures.filter((m) =>
              matches(measureLabel(m, g.kind)),
            )
            if (!rows.length) return null
            return (
              <div key={g.heading}>
                <BarHeading>{g.heading}</BarHeading>
                {rows.map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`requests-filters-${g.kind ?? "row"}-${m}`}
                    onClick={() => setPicked({ measure: m, kind: g.kind })}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
                  >
                    <MenuRowLabel
                      icon={Gauge}
                      label={
                        g.kind
                          ? (KIND_WORDS[g.kind]?.[m] ?? MEASURE[m].label)
                          : MEASURE[m].label
                      }
                    />
                    <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
                      {conditions
                        .filter(
                          (c) => c.cond.measure === m && c.cond.kind === g.kind,
                        )
                        .map(
                          (c) =>
                            `${c.not ? "not " : ""}${boundText(c.cond.bound)}${MEASURE[m].unit ?? ""}`,
                        )
                        .join(", ")}
                    </span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </BarPopover>
  )
}

/** One number's bound over the Channels rows: the Channels tab's histogram and fields. */
function MeasureEditor({
  label,
  unit,
  values,
  initial,
  onSubmit,
  onBack,
}: {
  label: string
  unit?: string
  values: number[]
  initial?: MetricBound
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(
    String(
      (op === "lte" ? initial?.max : initial?.min) ??
        (values.length ? nice(values[Math.floor(values.length / 2)]) : ""),
    ),
  )
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = parseBound(op, a, b, { min: 0 })
  const zoom = useZoomState()
  const kept = bound ? values.filter((v) => inBound(v, bound)).length : 0
  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (bound) onSubmit(bound)
      }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        {onBack && (
          <button
            type="button"
            aria-label="Back to the numbers"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {label}
        {unit && <span className="font-normal text-app-ink/50">{unit}</span>}
      </div>
      {values.length > 0 && (
        <BoundHistogram
          distribution={histogram(values, zoom.range)}
          bound={bound}
          noun="channels"
          onSelect={(next) => {
            setOp(boundKind(next))
            setA(String(next.min ?? next.max))
            setB(String(next.max ?? ""))
          }}
          zoom={zoom}
        />
      )}
      <BoundFields
        op={op}
        setOp={setOp}
        a={a}
        setA={setA}
        b={b}
        setB={setB}
        min={0}
        noValue={false}
      />
      <TgButton type="submit" size="sm" disabled={!bound} className="w-full">
        {initial ? "Update" : "Add"} · {kept} of {values.length} with this
        number
      </TgButton>
    </form>
  )
}
