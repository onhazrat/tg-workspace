/**
 * The Directory tab's bar (DIR-02), laid out like the Posts tab's and built
 * from the shared parts: the search box with its field segment (DIR-04), a
 * pill row (the facet menu for Language, the condition picker as Filters, the
 * on/off switches, Reference kinds, the sort picker, Show matches and
 * Columns), then the shared filter row, then a footer. Props only, so it
 * renders without a server; `DirectoryView` wires it.
 */
import {
  ChevronDown,
  Columns3,
  Languages,
  Link2,
  ListFilter,
  RotateCcw,
  Search,
} from "lucide-react"
import { useState } from "react"
import type {
  DirectoryColumnResponse,
  DirectoryLanguageCountResponse,
} from "@/client"
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
  type ColumnCatalogue,
  type ColumnChoices,
  choiceCount,
  isOn,
  seesInternals,
  setChoice,
} from "@/lib/directory/directory-columns"
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
import {
  languageLabel,
  languageValue,
  sortLanguages,
} from "@/lib/language-name"
import { DirectoryAddBox, type DirectoryAddBoxProps } from "./DirectoryAddBox"
import { columnOf } from "./DirectoryTable"

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

const FIELD_NOUN: Record<SearchField, string> = {
  name: "names",
  bio: "bios",
  posts: "posts",
}

/** What a search reaches, said to a reader listed every kind of entry. */
export const CHANNELS_ONLY =
  "Finds Channels only. Name contains, under Filters, also finds bots, groups, user accounts and handles not fetched yet."

/** "Search names", "Search names and bios", "Search names, bios and posts". */
function searchPlaceholder(fields: SearchField[]): string {
  const words = SEARCH_FIELDS.filter((f) => fields.includes(f)).map(
    (f) => FIELD_NOUN[f],
  )
  const last = words.pop()
  return `Search ${words.length ? `${words.join(", ")} and ` : ""}${last}`
}

/**
 * The Posts tab's search box, with Name, Bio and Posts as a segment inside
 * it; any mix of the three, never none. On a phone the segment leaves the box
 * for the controls sheet, so the box keeps the width (DFP-02). A reader
 * listed every kind of entry is told the search reaches Channels only (DPF).
 */
export function DirectorySearch({
  search,
  onSearch,
  fields,
  onFields,
  phone = false,
  everyKind = false,
}: {
  search: string
  onSearch: (text: string) => void
  fields: SearchField[]
  onFields: (next: SearchField[]) => void
  phone?: boolean
  everyKind?: boolean
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
        placeholder={searchPlaceholder(fields)}
        title={everyKind ? CHANNELS_ONLY : undefined}
        onChange={(e) => onSearch(e.target.value)}
        className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
      />
      {!phone && <SearchFields fields={fields} onFields={onFields} />}
    </div>
  )
}

/** Name, Bio and Posts: where the search looks. */
function SearchFields({
  fields,
  onFields,
}: {
  fields: SearchField[]
  onFields: (next: SearchField[]) => void
}) {
  return (
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

/** The Columns menu's state and actions (DCOL). */
export type ColumnsMenu = {
  /** The columns this caller may show, with their defaults; none while loading. */
  catalogue: ColumnCatalogue
  choices: ColumnChoices
  onChoices: (next: ColumnChoices) => void
  /** Present only for an Account that may set the deployment's defaults. */
  onMakeDefaults?: () => void
}

function ColumnRow({
  column,
  menu,
}: {
  column: DirectoryColumnResponse
  menu: ColumnsMenu
}) {
  const { label, description } = columnOf(column.key)
  const on = isOn(column, menu.choices)
  const chosen = menu.choices[column.key] !== undefined
  return (
    <div className="flex items-center gap-1 rounded-md hover:bg-app-ink/5">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5">
        <input
          type="checkbox"
          className="accent-app-ink"
          checked={on}
          onChange={() =>
            menu.onChoices(
              setChoice(menu.choices, column.key, on ? "off" : "on"),
            )
          }
        />
        <span
          data-chosen={chosen || undefined}
          className={`shrink-0 whitespace-nowrap font-semibold ${chosen ? "text-blue-600 dark:text-blue-400" : ""}`}
        >
          {label}
          {chosen && <span title="Your choice"> •</span>}
        </span>
        <span className="truncate text-[11px] text-app-ink/50">
          {description}
        </span>
      </label>
      {chosen && (
        <button
          type="button"
          aria-label={`Put ${label} back to its default`}
          title="Back to the default"
          onClick={() =>
            menu.onChoices(setChoice(menu.choices, column.key, undefined))
          }
          className="shrink-0 rounded-md p-1 text-app-ink/50 hover:text-app-ink"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  )
}

export function ColumnsPill({ menu }: { menu: ColumnsMenu }) {
  const [query, setQuery] = useState("")
  const [armed, setArmed] = useState(false)
  const set = choiceCount(menu.catalogue, menu.choices)
  const found = menu.catalogue.filter((c) => {
    const { label, description } = columnOf(c.key)
    return matches(query, label, description)
  })
  const sections = [
    { heading: "Default columns", columns: found.filter((c) => c.default) },
    { heading: "More columns", columns: found.filter((c) => !c.default) },
  ].filter((s) => s.columns.length > 0)
  return (
    <BarPopover
      align="end"
      width="w-96"
      onOpenChange={(open) => {
        if (open) return
        setQuery("")
        setArmed(false)
      }}
      trigger={
        <button
          type="button"
          data-testid="directory-columns"
          className={pillClass(set > 0)}
        >
          <Columns3 size={12} /> Columns
          {set > 0 && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {set} set
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
      <div className="flex flex-wrap items-center gap-x-3 px-2 pt-1 text-[11px]">
        <span className="text-app-ink/50">
          The Channel (handle, name, photo) and Follow always show; every entry
          here is a Channel, so there is no Kind
        </span>
        {set > 0 && (
          <button
            type="button"
            onClick={() => menu.onChoices({})}
            className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
          >
            Reset to default columns
          </button>
        )}
        {menu.onMakeDefaults && (
          // Two clicks, because it changes every Account's table.
          <button
            type="button"
            onClick={() => {
              if (!armed) return setArmed(true)
              setArmed(false)
              menu.onMakeDefaults?.()
            }}
            className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
          >
            {armed
              ? "Click again to change everyone's defaults"
              : "Make these the defaults for everyone"}
          </button>
        )}
      </div>
      {found.length === 0 && (
        <p className="px-2 py-3 text-app-ink/50">
          No column matches {query.trim()}
        </p>
      )}
      {sections.map((section) => (
        <div key={section.heading}>
          <BarHeading>{section.heading}</BarHeading>
          {section.columns.map((c) => (
            <ColumnRow key={c.key} column={c} menu={menu} />
          ))}
        </div>
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
  columns: ColumnsMenu
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
  /** Selected first: the ticked rows lead, each part in the sort. */
  selectedFirst: boolean
  onSelectedFirst: (on: boolean) => void
  /** The filter row's Clear all: the search and every Condition, as one change. */
  onClearAll: () => void
  /**
   * Below `md` (DFP-02): the controls fold into a full-screen sheet behind
   * one button beside the search box.
   */
  phone?: boolean
  /** Add to Directory (DADD), shown to a reader who sees the internals. */
  onAdd?: DirectoryAddBoxProps["onAdd"]
}

export function DirectoryBar(p: DirectoryBarProps) {
  const conditions = atoms(p.filter).length
  const funnelled = funnelledValues(p.filter, "language")
  const [sheet, setSheet] = useState(false)
  const search = (
    <DirectorySearch
      search={p.search}
      onSearch={p.onSearch}
      fields={p.fields}
      onFields={p.onFields}
      phone={p.phone}
      everyKind={seesInternals(p.columns.catalogue)}
    />
  )
  const controls = (
    <>
      {p.onAdd && seesInternals(p.columns.catalogue) && (
        <DirectoryAddBox onAdd={p.onAdd} />
      )}
      <FacetMenu
        icon={<Languages size={12} />}
        label="Language"
        noun="language"
        testId="directory-language"
        countLabel="channels"
        rows={sortLanguages(
          p.languages.map(({ language, count }) => ({
            value: languageValue(language),
            count,
          })),
        ).map(({ value, count }) => ({
          id: value,
          label: languageLabel(value),
          hint: value,
          selected: 0,
          total: count,
          tick: "false" as const,
        }))}
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
        options={sortOptions(
          p.search.trim() !== "",
          sharedOn(p.filter),
          seesInternals(p.columns.catalogue),
        )}
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
      <BarToggle
        on={p.selectedFirst}
        label="Selected first"
        title="Ticked channels first, each part in the list's order"
        testId="directory-switch-selected-first"
        onClick={() => p.onSelectedFirst(!p.selectedFirst)}
      />
      <span className="ml-auto" />
      <ColumnsPill menu={p.columns} />
    </>
  )
  return (
    <section className="mb-3 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
      {p.phone ? (
        <div className="flex items-center gap-2 px-4 pt-4">
          <div className="min-w-0 flex-1">{search}</div>
          <button
            type="button"
            data-testid="directory-controls-button"
            aria-label={`Filters and sort${conditions > 0 ? `, ${conditions} on` : ""}`}
            onClick={() => setSheet(true)}
            className={`${pillClass(conditions > 0)} h-9 shrink-0`}
          >
            <ListFilter size={14} />
            {conditions > 0 ? conditions : "Filters"}
          </button>
        </div>
      ) : (
        <div className="px-4 pt-4">{search}</div>
      )}
      {!p.phone && (
        <div className="flex flex-wrap items-center gap-2 p-4">{controls}</div>
      )}
      {p.phone && sheet && (
        // z-40 covers the list; the controls' popovers open at z-50, above it.
        <div
          role="dialog"
          aria-label="Filters and sort"
          className="fixed inset-0 z-40 flex flex-wrap content-start items-center gap-2.5 overflow-y-auto bg-app-bg p-4 pb-24"
        >
          <div className="mb-1 flex w-full items-center justify-between">
            <b className="text-sm">Filters and sort</b>
            <button
              type="button"
              onClick={() => setSheet(false)}
              className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white"
            >
              Done
            </button>
          </div>
          <div className="mb-1 flex w-full items-center gap-2 text-xs">
            <span className="text-app-ink/60">Search in</span>
            <SearchFields fields={p.fields} onFields={p.onFields} />
          </div>
          {controls}
        </div>
      )}

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
