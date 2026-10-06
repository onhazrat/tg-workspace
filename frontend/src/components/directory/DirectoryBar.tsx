/**
 * The Directory tab's bar (DIR-02), laid out like the Posts tab's and built
 * from the shared parts: the search box with its field segment (DIR-04), a
 * pill row (the facet menu for Language, the condition picker as Filters, the
 * on/off switches, Reference kinds, the sort picker, Show matches and
 * Columns), then the shared filter row, then a footer. Props only, so it
 * renders without a server; `DirectoryView` wires it.
 */
import { ChevronDown, Columns3, Link2, ListFilter, Search } from "lucide-react"
import { useState } from "react"
import type { DirectoryLanguageCountResponse } from "@/client"
import { BarHeading, BarPopover, BarSearch } from "@/components/BarPopover"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { ConditionPicker } from "@/components/filter-tree/ConditionPicker"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import {
  FilterRow,
  type FilterVocabulary,
} from "@/components/filter-tree/FilterRow"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { pillClass } from "@/components/PostFilterParts"
import {
  type DirectoryCond,
  type DirectoryFilter,
  type DirectoryFlag,
  sharedOn,
} from "@/lib/directory/directory-filter"
import {
  REF_KINDS,
  type RefKind,
  SEARCH_FIELDS,
  type SearchField,
  sortOptions,
  toggleField,
  type YoursSource,
} from "@/lib/directory/directory-view"
import {
  addFunnel,
  appendAnd,
  atoms,
  clearFunnels,
  funnelledValues,
  removeFunnel,
  setSwitch,
  switchOn,
} from "@/lib/filter-tree"
import { languageLabel } from "@/lib/posts/post-filter-bar"
import { COLUMNS } from "./DirectoryTable"

const matches = (query: string, ...texts: string[]) =>
  texts.join(" ").toLowerCase().includes(query.trim().toLowerCase())

/** The opening view's Conditions as one-click switches. DIR-06 adds Hide dismissed. */
const SWITCHES: {
  flag: DirectoryFlag
  not: boolean
  label: string
  title: string
}[] = [
  {
    flag: "followed",
    not: true,
    label: "Hide followed",
    title: "Leave out channels you follow",
  },
  {
    flag: "dismissed",
    not: true,
    label: "Hide dismissed",
    title: "Leave out channels you dismissed",
  },
  {
    flag: "followable",
    not: false,
    label: "Followable only",
    title: "Only channels the Directory found public and followable",
  },
]

/**
 * A switch is on only while its Condition sits on the filter's top-level AND,
 * so it and the chips never disagree; turning it on wraps an OR first.
 */
export function DirectorySwitches({
  filter,
  onFilter,
}: {
  filter: DirectoryFilter
  onFilter: (next: DirectoryFilter) => void
}) {
  return SWITCHES.map((s) => {
    const same = (c: DirectoryCond) => c.type === "flag" && c.value === s.flag
    const on = switchOn(filter, same, s.not)
    return (
      <BarToggle
        key={s.flag}
        on={on}
        label={s.label}
        title={s.title}
        testId={`directory-switch-${s.flag}`}
        onClick={() =>
          onFilter(
            setSwitch(
              filter,
              same,
              { type: "flag", value: s.flag },
              s.not,
              !on,
            ),
          )
        }
      />
    )
  })
}

/** The server refuses a longer search. */
const SEARCH_MAX = 256

/**
 * The Posts tab's search box, with Name, Bio and Posts as a segment inside
 * it; any mix of the three, never none.
 */
export function DirectorySearch({
  search,
  onSearch,
  fields,
  onFields,
}: {
  search: string
  onSearch: (text: string) => void
  fields: SearchField[]
  onFields: (next: SearchField[]) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-app-ink/10 bg-app-muted pl-3 pr-1.5 transition-colors focus-within:border-app-ink/30">
      <Search size={16} className="text-app-ink/50" />
      <input
        type="search"
        dir="auto"
        aria-label="Search the Directory"
        data-testid="directory-search"
        value={search}
        maxLength={SEARCH_MAX}
        placeholder="Search names, bios and posts"
        onChange={(e) => onSearch(e.target.value)}
        className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
      />
      <fieldset
        aria-label="Search in"
        className="flex items-center gap-0.5 rounded-lg bg-app-ink/5 p-0.5 text-[11px]"
      >
        {SEARCH_FIELDS.map((f) => {
          const on = fields.includes(f)
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              data-testid={`directory-search-field-${f}`}
              onClick={() => onFields(toggleField(fields, f))}
              className={`rounded-md px-2 py-1 capitalize ${on ? "bg-app-card font-semibold shadow-sm" : "text-app-ink/50 hover:text-app-ink"}`}
            >
              {f}
            </button>
          )
        })}
      </fieldset>
    </div>
  )
}

export function ReferenceKindsPill({
  kinds,
  onKinds,
}: {
  kinds: RefKind[]
  onKinds: (next: RefKind[]) => void
}) {
  const [query, setQuery] = useState("")
  const active = kinds.length > 0
  const shown = REF_KINDS.filter((k) => matches(query, k))
  return (
    <BarPopover
      onOpenChange={(open) => open || setQuery("")}
      trigger={
        <button
          type="button"
          data-testid="directory-kinds"
          className={pillClass(active)}
        >
          <Link2 size={12} /> Reference kinds
          <span className="font-semibold">
            {active ? kinds.join(", ") : "any"}
          </span>
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      <BarSearch
        value={query}
        onChange={setQuery}
        placeholder="Search reference kinds..."
      />
      <BarHeading>
        Which References count for Cited by your channels, Cited by @x and Cites
        @x; none is every kind. The Cited by and Cites counts always count every
        kind
      </BarHeading>
      {shown.length === 0 && (
        <p className="px-2 py-3 text-app-ink/50">
          No kind matches {query.trim()}
        </p>
      )}
      {shown.map((k) => (
        <label
          key={k}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 capitalize hover:bg-app-ink/5"
        >
          <input
            type="checkbox"
            className="accent-app-ink"
            checked={kinds.includes(k)}
            onChange={() =>
              onKinds(
                kinds.includes(k)
                  ? kinds.filter((x) => x !== k)
                  : REF_KINDS.filter((x) => x === k || kinds.includes(x)),
              )
            }
          />
          {k}
        </label>
      ))}
    </BarPopover>
  )
}

export function ColumnsPill({
  hidden,
  onHidden,
}: {
  hidden: string[]
  onHidden: (next: string[]) => void
}) {
  const [query, setQuery] = useState("")
  const shown = COLUMNS.filter((c) => matches(query, c.label, c.description))
  return (
    <BarPopover
      align="end"
      width="w-80"
      onOpenChange={(open) => open || setQuery("")}
      trigger={
        <button
          type="button"
          data-testid="directory-columns"
          className={pillClass(hidden.length > 0)}
        >
          <Columns3 size={12} /> Columns
          {hidden.length > 0 && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {hidden.length} hidden
            </span>
          )}
        </button>
      }
    >
      <BarSearch
        value={query}
        onChange={setQuery}
        placeholder="Search columns..."
      />
      <BarHeading>The Channel and Follow always show</BarHeading>
      {shown.length === 0 && (
        <p className="px-2 py-3 text-app-ink/50">
          No column matches {query.trim()}
        </p>
      )}
      {shown.map((c) => (
        <label
          key={c.key}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-app-ink/5"
        >
          <input
            type="checkbox"
            className="accent-app-ink"
            checked={!hidden.includes(c.key)}
            onChange={() =>
              onHidden(
                hidden.includes(c.key)
                  ? hidden.filter((k) => k !== c.key)
                  : [...hidden, c.key],
              )
            }
          />
          <span className="font-semibold">{c.label}</span>
          <span className="truncate text-[11px] text-app-ink/50">
            {c.description}
          </span>
        </label>
      ))}
    </BarPopover>
  )
}

const EMPTY_YOURS: Record<YoursSource, string> = {
  follows: "You follow no channels yet, so every Yours count is 0",
  selection:
    "Nothing is selected on the Channels tab, so every Yours count is 0",
  ticked: "No channels are ticked here yet, so every Yours count is 0",
}

export type DirectoryBarProps = {
  filter: DirectoryFilter
  onFilter: (next: DirectoryFilter) => void
  vocabulary: FilterVocabulary<DirectoryCond>
  /** Per-Language counts for the view without its Language Conditions. */
  languages: DirectoryLanguageCountResponse[]
  kinds: RefKind[]
  onKinds: (next: RefKind[]) => void
  sortValue: string
  onSort: (value: string) => void
  descending: boolean
  onToggleDirection: () => void
  hidden: string[]
  onHidden: (next: string[]) => void
  /** The view's total, while known. */
  total?: number
  /** The whole Directory, for "N of M". */
  size?: number
  /** How long the list took, while it is not loading. */
  ms?: number
  /** "Your channels" resolved to nothing: which source it was. */
  emptyYours?: YoursSource
  /** The search box as typed. */
  search: string
  onSearch: (text: string) => void
  fields: SearchField[]
  onFields: (next: SearchField[]) => void
  /** Show matches: quote each row's matching bio and Post. */
  matches: boolean
  onMatches: (on: boolean) => void
  /** The filter row's Clear all: the search and every Condition, as one change. */
  onClearAll: () => void
}

export function DirectoryBar(p: DirectoryBarProps) {
  const conditions = atoms(p.filter).length
  const funnelled = funnelledValues(p.filter, "language")
  return (
    <section className="mb-3 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
      <div className="px-4 pt-4">
        <DirectorySearch
          search={p.search}
          onSearch={p.onSearch}
          fields={p.fields}
          onFields={p.onFields}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <FacetMenu
          label="Language"
          noun="language"
          testId="directory-language"
          countLabel="channels"
          rows={p.languages.flatMap(({ language, count }) =>
            language
              ? [
                  {
                    id: language,
                    label: languageLabel(language),
                    hint: language,
                    selected: 0,
                    total: count,
                    tick: "false" as const,
                  },
                ]
              : [],
          )}
          funnelled={funnelled}
          labelOf={(id) => languageLabel(id)}
          onFunnel={(value, on) =>
            p.onFilter(
              on
                ? addFunnel(p.filter, { type: "language", value })
                : removeFunnel(p.filter, "language", value),
            )
          }
          onClearFunnels={() => p.onFilter(clearFunnels(p.filter, "language"))}
        />
        <ConditionPicker
          vocabulary={p.vocabulary}
          onPick={(cond) => p.onFilter(appendAnd(p.filter, cond))}
          trigger={
            <button
              type="button"
              data-testid="directory-filters"
              className={pillClass(false)}
            >
              <ListFilter size={12} /> Filters
              {conditions > 0 && (
                <span className="rounded-full bg-app-ink/15 px-1.5 text-[10px] tabular-nums">
                  {conditions}
                </span>
              )}
              <ChevronDown size={12} className="opacity-60" />
            </button>
          }
        />
        <DirectorySwitches filter={p.filter} onFilter={p.onFilter} />
        <ReferenceKindsPill kinds={p.kinds} onKinds={p.onKinds} />
        <span className="mx-1 h-5 w-px bg-app-ink/10" />
        <SortPicker
          options={sortOptions(p.search.trim() !== "", sharedOn(p.filter))}
          value={p.sortValue}
          onChange={p.onSort}
          direction={p.descending ? "desc" : "asc"}
          onToggleDirection={p.onToggleDirection}
          testId="directory-sort"
        />
        <BarToggle
          on={p.matches}
          label="Show matches"
          title="Quote the matching bio and post under each row while searching"
          testId="directory-switch-matches"
          onClick={() => p.onMatches(!p.matches)}
        />
        <span className="ml-auto" />
        <ColumnsPill hidden={p.hidden} onHidden={p.onHidden} />
      </div>

      <FilterRow
        filter={p.filter}
        onChange={p.onFilter}
        vocabulary={p.vocabulary}
        testId="directory-filter"
        search={p.search}
        shownCount={p.total ?? 0}
        totalCount={p.size ?? 0}
        onClearSearch={() => p.onSearch("")}
        onClearAll={p.onClearAll}
      />

      <div
        data-testid="directory-footer"
        className="flex flex-wrap items-center gap-2 border-t border-app-ink/5 bg-app-muted/30 px-4 py-2.5 text-xs"
      >
        <span className="font-semibold">
          {p.total === undefined ? "…" : p.total.toLocaleString()} channels
        </span>
        <span className="text-app-ink/50">
          {p.ms === undefined ? "loading…" : `${p.ms} ms`}
        </span>
        {p.emptyYours && (
          <span className="text-amber-600">{EMPTY_YOURS[p.emptyYours]}</span>
        )}
        {p.size !== undefined && (
          <span className="ml-auto text-app-ink/40">
            of {p.size.toLocaleString()} in the Directory
          </span>
        )}
      </div>
    </section>
  )
}
