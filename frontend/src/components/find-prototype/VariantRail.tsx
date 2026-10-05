// PROTOTYPE (find-prototype): variant R, "Facet rail". Every Condition is
// open all the time in a left rail, as a shop's sidebar: tri-state switches
// for the State flags, the Language list with counts (tick ORs it in, ⊘ NOTs
// it), every metric with its distribution one click away, and the Reference
// Conditions inline. The rail edits the root's AND; the shared FilterRow over
// the results shows the whole tree, where OR and parentheses are built.

import { Ban, ChevronRight, Search } from "lucide-react"
import { type ReactNode, useState } from "react"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import {
  addFunnel,
  atoms,
  funnelledValues,
  removeFunnel,
} from "@/lib/filter-tree"
import {
  condLabel,
  type DCond,
  type DTree,
  FLAG_LABEL,
  type Flag,
  rootFlag,
  setRoot,
  setRootFlag,
} from "./directory-filter"
import {
  type Dir,
  DirectoryResults,
  HandlesEditor,
  MentionEditor,
  NameEditor,
  RelationEditor,
  TreeBoundEditor,
  useDirectory,
} from "./directory-state"
import { fmt } from "./shared"
import { languageLabel, METRIC_SECTIONS } from "./VariantBrowseTop"
import {
  ColumnsPill,
  DirectoryFilterRow,
  DirectorySort,
  KindsPill,
  SearchFieldToggles,
} from "./VariantTabs"

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string
  count?: number
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-app-ink/10 py-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-app-ink/60 uppercase"
      >
        <ChevronRight size={12} className={open ? "rotate-90" : ""} />
        {title}
        {count ? (
          <span className="rounded-full bg-app-ink px-1.5 text-[10px] text-app-bg">
            {count}
          </span>
        ) : null}
      </button>
      {open && <div className="mt-1.5 space-y-1">{children}</div>}
    </section>
  )
}

function FlagRow({ d, flag }: { d: Dir; flag: Flag }) {
  const state = rootFlag(d.tree, flag) ?? "any"
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-xs">
      <span>{FLAG_LABEL[flag]}</span>
      <TgSegmentedControl
        size="sm"
        aria-label={FLAG_LABEL[flag]}
        value={state}
        onChange={(v) =>
          d.setTree(setRootFlag(d.tree, flag, v === "any" ? null : v))
        }
        options={[
          { value: "any", label: "Any" },
          { value: "yes", label: "Only" },
          { value: "no", label: "Hide" },
        ]}
      />
    </div>
  )
}

function LanguageList({ d }: { d: Dir }) {
  const [query, setQuery] = useState("")
  const [all, setAll] = useState(false)
  const included = funnelledValues(d.tree, "language")
  const excluded = new Set(
    d.tree.children.flatMap((c) =>
      c.kind === "atom" && c.not && c.cond.type === "language"
        ? [c.cond.value]
        : [],
    ),
  )
  const rows = d.langs.filter((l) =>
    `${l.language} ${languageLabel(l.language)}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const shown = all || query ? rows : rows.slice(0, 8)
  const isLang = (code: string) => (c: DCond) =>
    c.type === "language" && c.value === code
  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search languages…"
        className="mb-1 h-7 w-full rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs outline-none focus:border-app-ink/40"
      />
      {shown.map((l) => {
        const on = included.includes(l.language) && !excluded.has(l.language)
        const off = excluded.has(l.language)
        return (
          <div
            key={l.language}
            className="group flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-app-ink/5"
          >
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="accent-app-ink"
                checked={on}
                onChange={() =>
                  d.setTree(
                    on
                      ? (removeFunnel(d.tree, "language", l.language) as DTree)
                      : addFunnel(
                          setRoot(d.tree, (c) => isLang(l.language)(c)),
                          { type: "language", value: l.language },
                        ),
                  )
                }
              />
              <span
                className={`truncate ${off ? "line-through opacity-50" : ""}`}
              >
                {languageLabel(l.language)}
              </span>
            </label>
            <span className="font-mono text-[10px] text-app-ink/40">
              {fmt(l.n)}
            </span>
            <button
              type="button"
              title={off ? "Stop excluding" : "Exclude"}
              onClick={() =>
                d.setTree(
                  setRoot(
                    removeFunnel(d.tree, "language", l.language) as DTree,
                    isLang(l.language),
                    off
                      ? undefined
                      : {
                          cond: { type: "language", value: l.language },
                          not: true,
                        },
                  ),
                )
              }
              className={`rounded p-0.5 ${off ? "text-red-500" : "text-app-ink/20 group-hover:text-app-ink/50 hover:!text-app-ink"}`}
            >
              <Ban size={11} />
            </button>
          </div>
        )
      })}
      {!query && rows.length > 8 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="px-1 text-[11px] text-app-ink/50 underline"
        >
          {all ? "fewer" : `all ${rows.length}`}
        </button>
      )}
    </>
  )
}

/** One Condition kind as a row that opens its editor in place. */
function EditorRow({
  label,
  active,
  children,
}: {
  label: string
  /** The Conditions of this kind on the root, as chip text. */
  active: string[]
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-baseline gap-2 rounded-md px-1 py-1 text-left hover:bg-app-ink/5 ${active.length ? "font-semibold" : ""}`}
      >
        <ChevronRight
          size={11}
          className={`shrink-0 self-center ${open ? "rotate-90" : ""}`}
        />
        <span className="shrink-0">{label}</span>
        {active.length > 0 && (
          <span className="truncate text-[10px] font-normal text-fuchsia-600">
            {active.join(", ")}
          </span>
        )}
      </button>
      {open && (
        <div className="my-1 rounded-lg border border-app-ink/10 bg-app-bg p-1">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** Replace this kind's Conditions on the root with `cond`, or drop them. */
function rootKind(d: Dir) {
  return (match: (c: DCond) => boolean) => ({
    active: d.tree.children.flatMap((c) =>
      c.kind === "atom" && match(c.cond)
        ? [`${c.not ? "not " : ""}${condLabel(c.cond, languageLabel)}`]
        : [],
    ),
    first: d.tree.children.find(
      (c) => c.kind === "atom" && !c.not && match(c.cond),
    ) as { cond: DCond } | undefined,
    put: (cond: DCond) => d.setTree(setRoot(d.tree, match, { cond })),
    clear: () => d.setTree(setRoot(d.tree, match)),
  })
}

function Rail({ d }: { d: Dir }) {
  const kind = rootKind(d)
  const flags = (Object.keys(FLAG_LABEL) as Flag[]).filter((f) =>
    rootFlag(d.tree, f),
  ).length
  const langCount = d.tree.children.filter(
    (c) => c.kind === "atom" && c.cond.type === "language",
  ).length
  const metricRow = (key: string, label: string) => {
    const k = kind((c) => c.type === "metric" && c.metric === key)
    return (
      <EditorRow key={key} label={label} active={k.active}>
        {(close) => (
          <>
            <TreeBoundEditor
              metric={key}
              start={k.first?.cond.type === "metric" ? k.first.cond : undefined}
              tree={d.tree}
              bodyFor={d.bodyFor}
              onSubmit={(cond) => {
                k.put(cond)
                close()
              }}
              onBack={close}
            />
            {k.active.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  k.clear()
                  close()
                }}
                className="w-full px-1 pt-1 text-left text-[11px] text-app-ink/50 underline"
              >
                remove
              </button>
            )}
          </>
        )}
      </EditorRow>
    )
  }
  const formRow = (
    match: (c: DCond) => boolean,
    label: string,
    form: (p: {
      start?: DCond
      onSubmit: (c: DCond) => void
      onBack: () => void
    }) => ReactNode,
  ) => {
    const k = kind(match)
    return (
      <EditorRow label={label} active={k.active}>
        {(close) => (
          <>
            {form({
              start: k.first?.cond,
              onSubmit: (c) => {
                k.put(c)
                close()
              },
              onBack: close,
            })}
            {k.active.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  k.clear()
                  close()
                }}
                className="w-full px-1 pt-1 text-left text-[11px] text-app-ink/50 underline"
              >
                remove
              </button>
            )}
          </>
        )}
      </EditorRow>
    )
  }
  const parentsOn = atoms(d.tree).some((a) => a.cond.type === "parents")
  const childrenOn = atoms(d.tree).some((a) => a.cond.type === "children")
  const [size, content, refs] = METRIC_SECTIONS
  return (
    <aside className="sticky top-2 h-[calc(100svh-120px)] w-72 shrink-0 overflow-y-auto rounded-xl border border-app-ink/10 bg-app-card px-2 pb-6 shadow-md">
      <Section title="Show" count={flags}>
        {(Object.keys(FLAG_LABEL) as Flag[]).map((f) => (
          <FlagRow key={f} d={d} flag={f} />
        ))}
      </Section>
      <Section title="Language" count={langCount}>
        <LanguageList d={d} />
      </Section>
      <Section title="Name">
        {formRow(
          (c) => c.type === "name",
          "Name contains",
          (p) => (
            <NameEditor
              {...p}
              start={p.start?.type === "name" ? p.start : undefined}
            />
          ),
        )}
      </Section>
      {[size, content].map((sec) => (
        <Section key={sec.heading} title={sec.heading}>
          {sec.metrics.map((m) => metricRow(m.key, m.label))}
        </Section>
      ))}
      <Section title={refs.heading}>
        {formRow(
          (c) => c.type === "mine",
          "Cited by your channels",
          (p) => (
            <MentionEditor
              {...p}
              start={p.start?.type === "mine" ? p.start : undefined}
            />
          ),
        )}
        {(["cited_by", "cites"] as const).map((side) => (
          <div key={side}>
            {formRow(
              (c) => c.type === side,
              side === "cited_by" ? "Cited by @handle" : "Cites @handle",
              (p) => (
                <HandlesEditor
                  {...p}
                  side={side}
                  start={p.start?.type === side ? p.start : undefined}
                />
              ),
            )}
          </div>
        ))}
        {(["parents", "children"] as const).map((type) => (
          <div key={type}>
            {formRow(
              (c) => c.type === type,
              type === "parents"
                ? "Shared parents with…"
                : "Shared children with…",
              (p) => (
                <RelationEditor
                  {...p}
                  type={type}
                  start={p.start?.type === type ? p.start : undefined}
                  selectedCount={d.selectedCount}
                  followCount={d.followCount}
                />
              ),
            )}
          </div>
        ))}
        {refs.metrics
          .filter(
            (m) =>
              (m.key !== "shared_parents" || parentsOn) &&
              (m.key !== "shared_children" || childrenOn),
          )
          .map((m) => metricRow(m.key, m.label))}
        <div className="px-1 pt-1">
          <KindsPill d={d} />
        </div>
      </Section>
    </aside>
  )
}

export function VariantRail() {
  const d = useDirectory()
  const { view, res } = d
  return (
    <div className="flex gap-3 pt-4">
      <Rail d={d} />
      <div className="min-w-0 flex-1">
        <div className="mb-3 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <label className="flex min-w-72 flex-1 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted px-2.5">
              <Search size={15} className="text-app-ink/50" />
              <input
                dir="auto"
                aria-label="Search the Directory"
                value={view.q}
                onChange={(e) => d.setQ(e.target.value)}
                placeholder="Search names, bios and posts"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm focus:outline-none"
              />
              <SearchFieldToggles d={d} />
            </label>
            <BarToggle
              on={view.snippets}
              label="Show matches"
              title="Quote the matching post and bio while searching"
              onClick={() => d.patch({ snippets: !view.snippets })}
            />
            <DirectorySort d={d} />
            <ColumnsPill d={d} />
            <span className="ml-auto font-mono text-[11px] text-app-ink/50">
              <b className="text-sm text-app-ink">
                {res.data ? res.data.total.toLocaleString() : "…"}
              </b>{" "}
              channels ·{" "}
              {res.isFetching ? "loading…" : `${res.data?.ms ?? 0} ms`}
            </span>
          </div>
          <DirectoryFilterRow d={d} />
          {res.error && (
            <p className="px-3 pb-2 text-xs text-red-500">
              {String(res.error)}
            </p>
          )}
        </div>
        <DirectoryResults d={d} />
      </div>
    </div>
  )
}
