// PROTOTYPE (find-prototype): variant T, "Tab parity". E's bar rebuilt from
// the Channels and Posts tabs' own components: the Posts tab's search row
// (one big box, the fields as a segment inside it), a pill row of the shared
// FacetMenu, BarToggles, the ConditionPicker as "Filters" and the searchable
// SortPicker, then the shared FilterRow editing the AND/OR/NOT tree, and the
// Posts tab's footer.

import {
  ChevronDown,
  Columns3,
  ListFilter,
  Search,
  Sparkles,
} from "lucide-react"
import { BarHeading, BarPopover } from "@/components/BarPopover"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { ConditionPicker } from "@/components/filter-tree/ConditionPicker"
import { FacetMenu } from "@/components/filter-tree/FacetMenu"
import { FilterRow } from "@/components/filter-tree/FilterRow"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { pillClass } from "@/components/PostFilterParts"
import {
  addFunnel,
  atoms,
  clearFunnels,
  funnelledValues,
  removeFunnel,
} from "@/lib/filter-tree"
import {
  type DTree,
  type Flag,
  rootFlag,
  setRootFlag,
} from "./directory-filter"
import { type Dir, DirectoryResults, useDirectory } from "./directory-state"
import { fmt } from "./shared"
import { ColumnsMenu, KINDS, languageLabel } from "./VariantBrowseTop"

/** The tri-states the pill row shows as on/off switches. */
const TOGGLES: {
  flag: Flag
  on: "yes" | "no"
  label: string
  title: string
}[] = [
  {
    flag: "followed",
    on: "no",
    label: "Hide followed",
    title: "Leave out channels you follow",
  },
  {
    flag: "dismissed",
    on: "no",
    label: "Hide not interested",
    title: "Leave out channels you marked Not interested",
  },
  {
    flag: "available",
    on: "yes",
    label: "Available only",
    title: "Only channels the Directory found alive and public",
  },
]

export function SearchFieldToggles({ d }: { d: Dir }) {
  const { view, patch } = d
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-app-ink/5 p-0.5 text-[11px]">
      {(["name", "bio", "posts"] as const).map((w) => {
        const on = view.q_in.includes(w)
        return (
          <button
            key={w}
            type="button"
            aria-pressed={on}
            onClick={() =>
              patch({
                q_in: on ? view.q_in.filter((x) => x !== w) : [...view.q_in, w],
              })
            }
            className={`rounded-md px-2 py-1 capitalize ${on ? "bg-app-card font-semibold shadow-sm" : "text-app-ink/50 hover:text-app-ink"}`}
          >
            {w}
          </button>
        )
      })}
    </div>
  )
}

export function KindsPill({
  d,
  align = "start",
}: {
  d: Dir
  align?: "start" | "end"
}) {
  const { view, patch } = d
  const on = view.kinds.length > 0
  return (
    <BarPopover
      align={align}
      trigger={
        <button type="button" className={pillClass(on)}>
          Kinds
          <span className="font-semibold">
            {on ? view.kinds.join(", ") : "any"}
          </span>
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      <BarHeading>
        Which References count, for Cited by, Cites and your channels
      </BarHeading>
      {KINDS.map((k) => (
        <label
          key={k}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 capitalize hover:bg-app-ink/5"
        >
          <input
            type="checkbox"
            className="accent-app-ink"
            checked={view.kinds.includes(k)}
            onChange={() =>
              patch({
                kinds: view.kinds.includes(k)
                  ? view.kinds.filter((x) => x !== k)
                  : [...view.kinds, k],
              })
            }
          />
          {k}
        </label>
      ))}
    </BarPopover>
  )
}

export function ColumnsPill({ d }: { d: Dir }) {
  const hidden = d.s.hiddenCols.length
  return (
    <BarPopover
      align="end"
      width="w-80"
      trigger={
        <button type="button" className={pillClass(hidden > 0)}>
          <Columns3 size={12} /> Columns
          {hidden > 0 && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px]">
              {hidden} hidden
            </span>
          )}
        </button>
      }
    >
      <ColumnsMenu s={d.s} />
    </BarPopover>
  )
}

export function LanguageFacet({ d }: { d: Dir }) {
  const { tree, setTree } = d
  return (
    <FacetMenu
      label="Language"
      noun="language"
      testId="dir-language"
      rows={d.langs.map((l) => ({
        id: l.language,
        label: languageLabel(l.language),
        hint: l.language,
        selected: 0,
        total: l.n,
        tick: "false",
      }))}
      funnelled={funnelledValues(tree, "language")}
      labelOf={languageLabel}
      onFunnel={(id, on) =>
        setTree(
          on
            ? addFunnel(tree, { type: "language", value: id })
            : (removeFunnel(tree, "language", id) as DTree),
        )
      }
      onClearFunnels={() => setTree(clearFunnels(tree, "language") as DTree)}
    />
  )
}

export function DirectorySort({ d }: { d: Dir }) {
  return (
    <SortPicker
      options={d.sortOptions}
      value={d.body.sort}
      onChange={(sort) =>
        d.patch({
          sort,
          desc: ![
            "last_post_days",
            "found_days",
            "mine_last_days",
            "handle",
          ].includes(sort),
        })
      }
      direction={d.view.desc ? "desc" : "asc"}
      onToggleDirection={() => d.patch({ desc: !d.view.desc })}
      testId="dir-sort"
    />
  )
}

export function DirectoryFilterRow({ d }: { d: Dir }) {
  return (
    <FilterRow
      filter={d.tree}
      onChange={d.setTree}
      vocabulary={d.vocabulary}
      testId="dir-filter"
      search={d.view.q}
      shownCount={d.res.data?.total ?? 0}
      totalCount={d.all.data?.total ?? 0}
      onClearSearch={() => d.setQ("")}
      onClearAll={() => {
        d.setQ("")
        d.setTree({ kind: "group", id: "root", op: "and", children: [] })
      }}
    />
  )
}

export function VariantTabs() {
  const d = useDirectory()
  const { tree, setTree, view, res } = d
  const conditions = atoms(tree).length
  return (
    <div className="pt-4">
      <section className="mb-3 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 rounded-xl border border-app-ink/10 bg-app-muted pr-1.5 pl-3 focus-within:border-app-ink/30">
            <Search size={16} className="text-app-ink/50" />
            <input
              dir="auto"
              aria-label="Search the Directory"
              value={view.q}
              onChange={(e) => d.setQ(e.target.value)}
              placeholder="Search names, bios and posts"
              className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
            />
            <SearchFieldToggles d={d} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LanguageFacet d={d} />
            <ConditionPicker
              vocabulary={d.vocabulary}
              onPick={(cond) => d.add(cond)}
              trigger={
                <button type="button" className={pillClass(false)}>
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
            {TOGGLES.map((t) => {
              const on = rootFlag(tree, t.flag) === t.on
              return (
                <BarToggle
                  key={t.flag}
                  on={on}
                  label={t.label}
                  title={t.title}
                  onClick={() =>
                    setTree(setRootFlag(tree, t.flag, on ? null : t.on))
                  }
                />
              )
            })}
            <KindsPill d={d} />
            <span className="mx-1 h-5 w-px bg-app-ink/10" />
            <DirectorySort d={d} />
            <BarToggle
              on={view.snippets}
              label="Show matches"
              title="Quote the matching post and bio under each result while searching"
              onClick={() => d.patch({ snippets: !view.snippets })}
            />
            <span className="ml-auto" />
            <ColumnsPill d={d} />
          </div>
        </div>

        <DirectoryFilterRow d={d} />

        <div className="flex flex-wrap items-center gap-2 border-t border-app-ink/5 bg-app-muted/30 px-4 py-2.5 text-xs">
          <span className="font-semibold">
            {res.data ? res.data.total.toLocaleString() : "…"} channels
          </span>
          <span className="text-app-ink/50">
            {res.isFetching ? "loading…" : `${res.data?.ms ?? 0} ms`}
          </span>
          {d.selectedCount === 0 && d.body.sort === "mine" && (
            <span className="inline-flex items-center gap-1 text-app-ink/50">
              <Sparkles size={11} /> "Yours" counts every follow; select
              channels on the Channels tab for a personal ranking
            </span>
          )}
          {d.all.data && (
            <span className="ml-auto text-app-ink/40">
              of {fmt(d.all.data.total)} in the Directory
            </span>
          )}
        </div>
        {res.error && (
          <p className="px-4 pb-2 text-xs text-red-500">{String(res.error)}</p>
        )}
      </section>
      <DirectoryResults d={d} />
    </div>
  )
}
