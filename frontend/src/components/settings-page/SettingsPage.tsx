/**
 * The Settings tab: one scrolling page of every Setting the Account can see
 * (SET-02, ADR-032), drawn with the workspace's own pieces.
 *
 * The bar on top is the Directory's (a rounded card holding a big search box,
 * a row of pills and a count), sticky so search is one click away. A contents
 * tree beside the page follows the scroll. Each row reads "Topic › Scope:
 * Title" with its description and control under it, and a blue bar on the
 * left when it differs from its default (blue is the workspace's selection
 * colour).
 */
import {
  AtSign,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  Search,
  Settings2,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { BarHeading, BarPopover } from "@/components/BarPopover"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { Options, Pill, pillClass } from "@/components/PostFilterParts"
import { TgMetaChip } from "@/components/ui/tg-chips"
import { scopedStorage } from "@/lib/storage/scoped"
import { Control, Highlight, RowMenu } from "./controls"
import {
  appliesLabel,
  elementId,
  formatValue,
  OPERATORS,
  type Row,
  SCOPES,
  scopeLabel,
} from "./model"
import { type SettingsPageState, useSettingsPage } from "./sections"

/** Where the contents remember which topics the Account folded or opened. */
const FOLDS_KEY = "settingsContentsFolds"

/** The last topic whose heading top is at or above `line`; the first if none. */
export function lastPassed(
  ids: string[],
  topOf: (id: string) => number | undefined,
  line: number,
): string | null {
  let current = ids[0] ?? null
  for (const id of ids) {
    const top = topOf(id)
    if (top !== undefined && top <= line) current = id
  }
  return current
}

/**
 * The topic being read: the last one whose heading has passed the bottom of
 * the sticky bar. A scroll listener rather than an IntersectionObserver,
 * which picked the topic hidden under the bar.
 */
function useActiveTopic(idList: string[]) {
  const [active, setActive] = useState<string | null>(null)
  const key = idList.join(",")
  useEffect(() => {
    const ids = key ? key.split(",") : []
    const topOf = (id: string) =>
      document.getElementById(`settings-topic-${id}`)?.getBoundingClientRect()
        .top
    const update = () => {
      const bar = document.querySelector("[data-settings-bar]")
      const line = (bar?.getBoundingClientRect().bottom ?? 0) + 32
      setActive(lastPassed(ids, topOf, line))
    }
    update()
    // Capture: the tab scrolls an inner container, not the window.
    window.addEventListener("scroll", update, { capture: true, passive: true })
    return () => window.removeEventListener("scroll", update, { capture: true })
  }, [key])
  return active
}

function loadFolds(): Record<string, boolean> {
  try {
    const raw = scopedStorage.getItem(FOLDS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, boolean>)
      : {}
  } catch {
    return {}
  }
}

/** What the Account chose per topic, remembered in this browser. */
function useFolds() {
  const [chosen, setChosen] = useState<Record<string, boolean>>(loadFolds)
  const update = (next: Record<string, boolean>) => {
    setChosen(next)
    scopedStorage.setItem(FOLDS_KEY, JSON.stringify(next))
  }
  return [chosen, update] as const
}

/** How many settings under a contents entry differ from their default. */
function Changed({ count }: { count: number }) {
  if (!count) return null
  return (
    <span
      title={`${count} changed from default`}
      data-testid="settings-changed-count"
      className="rounded-full bg-blue-500/15 px-1.5 text-[10px] font-semibold tabular-nums text-blue-600 dark:text-blue-400"
    >
      {count}
    </span>
  )
}

const jumpTo = (id: string) =>
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" })

/**
 * The contents as a tree, as VS Code's settings editor has it: a chevron
 * folds each topic, its children are its panels and scope groups, and the
 * topic being read opens on its own and closes once passed, unless the
 * Account folded or unfolded it. Folding changes the tree, never the page.
 */
function Contents({
  page,
  active,
}: {
  page: SettingsPageState
  active: string | null
}) {
  const [chosen, setChosen] = useFolds()
  const isOpen = (id: string) => chosen[id] ?? id === active
  const allOpen = page.sections.every((s) => isOpen(s.id))
  return (
    <div data-testid="settings-contents">
      <button
        type="button"
        onClick={() =>
          setChosen(
            Object.fromEntries(page.sections.map((s) => [s.id, !allOpen])),
          )
        }
        className="mb-1 flex items-center gap-1 px-1 text-[11px] text-app-ink/50 hover:text-app-ink"
      >
        {allOpen ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
        {allOpen ? "Collapse all" : "Expand all"}
      </button>
      <ul className="space-y-0.5 text-xs">
        {page.sections.map((s) => {
          const expanded = isOpen(s.id)
          const children = [
            ...s.panels.map((panel) => ({
              key: panel.id,
              label: panel.title,
              count: null as number | null,
              changed: 0,
              go: () => jumpTo(elementId(panel.id)),
            })),
            ...s.groups.map((g) => ({
              key: g.scope,
              label: scopeLabel(g.scope),
              count: g.rows.length,
              changed: g.rows.filter((r) => r.modified).length,
              go: () => {
                if (g.folded) page.unfold(`${s.id}.${g.scope}`)
                requestAnimationFrame(() =>
                  jumpTo(`settings-group-${s.id}-${g.scope}`),
                )
              },
            })),
          ]
          return (
            <li key={s.id}>
              <div
                className={`flex items-center rounded-md ${
                  s.id === active
                    ? "bg-app-ink/5 font-semibold text-app-ink"
                    : "text-app-ink/60 hover:text-app-ink"
                }`}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${s.title}`}
                  onClick={() => setChosen({ ...chosen, [s.id]: !expanded })}
                  className="rounded p-1 text-app-ink/40 hover:text-app-ink"
                >
                  <ChevronRight
                    size={12}
                    className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                  />
                </button>
                <a
                  href={`#settings-topic-${s.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    jumpTo(`settings-topic-${s.id}`)
                  }}
                  className="flex min-w-0 flex-1 items-center justify-between py-1 pr-2"
                >
                  <span className="truncate">{s.title}</span>
                  <span className="flex items-center gap-1 text-[10px] font-normal tabular-nums text-app-ink/40">
                    <Changed count={s.modifiedCount} />
                    {s.rowCount + s.panels.length}
                  </span>
                </a>
              </div>
              {expanded && (
                <ul className="mb-1 ml-3.5 border-l border-app-ink/10 pl-2">
                  {children.map((c) => (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={c.go}
                        className="flex w-full items-center justify-between rounded-md px-1.5 py-0.5 text-left text-[11px] text-app-ink/55 hover:bg-app-ink/5 hover:text-app-ink"
                      >
                        <span className="truncate">{c.label}</span>
                        <span className="flex items-center gap-1">
                          <Changed count={c.changed} />
                          {c.count !== null && (
                            <span className="text-[10px] tabular-nums text-app-ink/35">
                              {c.count}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The Directory's bar: search box, then a row of pills, then the count. */
function SearchBar({
  page,
  active,
}: {
  page: SettingsPageState
  active: string | null
}) {
  const { query, setQuery, filters, setFilters, totals } = page
  const scope = SCOPES.find((s) => s.id === filters.scope)
  return (
    <section
      data-settings-bar
      className="sticky top-0 z-20 mb-4 rounded-xl border border-app-ink/10 bg-app-card shadow-md"
    >
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 rounded-xl border border-app-ink/10 bg-app-muted pl-3 pr-1.5 transition-colors focus-within:border-app-ink/30">
          <Search size={16} className="text-app-ink/50" />
          <input
            type="search"
            aria-label="Search settings"
            data-testid="settings-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names, ids, descriptions and values"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm focus:outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="rounded-md p-1 text-app-ink/50 hover:text-app-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="md:hidden">
          <BarPopover
            width="w-72"
            trigger={
              <button type="button" className={pillClass(false)}>
                <ListTree size={12} /> Contents
              </button>
            }
          >
            <Contents page={page} active={active} />
          </BarPopover>
        </span>
        <Pill
          label="Scope"
          value={scope?.label ?? "Everything"}
          active={filters.scope !== "all"}
        >
          <Options
            options={[
              { value: "all", label: "Everything" },
              ...SCOPES.map((s) => ({ value: s.id, label: s.label })),
            ]}
            value={filters.scope}
            onChange={(next) => setFilters({ ...filters, scope: next })}
          />
        </Pill>
        <BarToggle
          on={filters.modifiedOnly}
          onClick={() =>
            setFilters({ ...filters, modifiedOnly: !filters.modifiedOnly })
          }
          label="Changed only"
          title="Only settings not at their default"
        />
        <BarToggle
          on={filters.editableOnly}
          onClick={() =>
            setFilters({ ...filters, editableOnly: !filters.editableOnly })
          }
          label="I can change"
          title="Hide what you can only read"
        />
        <BarPopover
          align="end"
          width="w-64"
          trigger={
            <button type="button" className={`${pillClass(false)} ml-auto`}>
              <AtSign size={12} /> Search syntax
            </button>
          }
        >
          <BarHeading>Add to the search</BarHeading>
          {OPERATORS.map((op) => (
            <button
              key={op}
              type="button"
              onClick={() =>
                setQuery(
                  `${query.trim()} ${op}`.trim() +
                    (op.endsWith(":") ? "" : " "),
                )
              }
              className="block w-full rounded-md px-2 py-1.5 text-left font-mono hover:bg-app-ink/5"
            >
              {op}
            </button>
          ))}
        </BarPopover>
      </div>
      <div
        data-testid="settings-count"
        className="border-t border-app-ink/5 px-4 py-2 text-[11px] text-app-ink/60"
      >
        <b className="text-app-ink">{totals.shown}</b> of {totals.all} settings
        · {totals.modified} changed from default
      </div>
    </section>
  )
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "error"; message: string }

const SAVED_MS = 1500

/** One Setting: its heading, description, control and where it is kept. */
export function Item({
  row,
  page,
  topicTitle,
}: {
  row: Row
  page: SettingsPageState
  topicTitle: string
}) {
  const [state, setState] = useState<SaveState>({ kind: "idle" })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])
  const settle = async (write: Promise<void>) => {
    try {
      await write
      setState({ kind: "saved" })
      clearTimeout(timer.current ?? undefined)
      timer.current = setTimeout(() => setState({ kind: "idle" }), SAVED_MS)
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const save = (value: unknown) => void settle(page.save(row, value))
  const reset = () => void settle(page.reset(row))
  const error = state.kind === "error" ? state.message : null
  return (
    <div
      id={elementId(row.id)}
      data-modified={row.modified || undefined}
      className={`group relative scroll-mt-44 rounded-r-lg border-l-2 py-3 pl-8 pr-3 hover:bg-app-ink/[0.03] ${
        row.modified ? "border-blue-500" : "border-transparent"
      } ${page.flash === row.id ? "bg-blue-500/10" : ""}`}
    >
      <div className="absolute left-1.5 top-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
        <RowMenu
          row={row}
          onReset={reset}
          trigger={
            <button
              type="button"
              aria-label={`Manage ${row.title}`}
              className="flex size-5 items-center justify-center rounded text-app-ink/50 hover:text-app-ink"
            >
              <Settings2 size={13} />
            </button>
          }
        />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="text-[13px]">
          <span className="text-app-ink/50">
            {topicTitle} › {scopeLabel(row.scope)}:{" "}
          </span>
          <span className="font-semibold">
            <Highlight text={row.title} query={page.query} />
          </span>
        </h4>
        {row.modified && (
          <button
            type="button"
            disabled={!row.canEdit}
            onClick={reset}
            title={row.canEdit ? "Reset to default" : undefined}
            className="text-[11px] text-blue-600 enabled:hover:underline dark:text-blue-400"
          >
            Changed · default {formatValue(row, row.default)}
          </button>
        )}
        {appliesLabel(row) && (
          <TgMetaChip className="font-normal">{appliesLabel(row)}</TgMetaChip>
        )}
        {state.kind === "saved" && (
          <TgMetaChip className="font-normal">Saved</TgMetaChip>
        )}
      </div>
      {row.description && (
        <p className="mt-1 max-w-2xl text-xs text-app-ink/70">
          <Highlight text={row.description} query={page.query} />
        </p>
      )}
      <div className="mt-2">
        <Control
          row={row}
          error={error}
          onSave={save}
          onCancel={() => setState({ kind: "idle" })}
        />
      </div>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-500">
          {error}
        </p>
      )}
      <p className="mt-1.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-app-ink/40">
        <span>
          <Highlight text={row.id} query={page.query} />
        </span>
        <span className="break-all">{row.storage}</span>
      </p>
    </div>
  )
}

export function SettingsPage() {
  const page = useSettingsPage()
  const active = useActiveTopic(page.sections.map((s) => s.id))
  return (
    <div data-testid="settings-page">
      <SearchBar page={page} active={active} />
      {page.isLoading && (
        <p className="px-1 text-xs text-app-ink/50">Loading settings…</p>
      )}
      {page.error && (
        <p className="px-1 text-xs text-red-500">
          Settings could not be loaded: {String(page.error)}
        </p>
      )}
      <div className="grid gap-8 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label="Settings contents"
          className="sticky top-44 hidden max-h-[calc(100svh-16rem)] self-start overflow-y-auto md:block"
        >
          <Contents page={page} active={active} />
        </nav>
        <div className="min-w-0 space-y-8">
          {page.sections.map((section) => (
            <section
              key={section.id}
              id={`settings-topic-${section.id}`}
              className={`scroll-mt-48 rounded-lg ${
                page.flash === section.id ? "bg-blue-500/5" : ""
              }`}
            >
              <h3 className="mb-1 border-b border-app-ink/10 pb-1.5 text-sm font-bold">
                {section.title}
                <span className="ml-2 font-mono text-[10px] font-normal text-app-ink/40">
                  {section.id}.*
                </span>
              </h3>
              {section.panels.map((panel) => (
                <div
                  key={panel.id}
                  id={elementId(panel.id)}
                  className={`scroll-mt-44 rounded-r-lg border-l-2 border-transparent py-3 pl-8 pr-3 ${
                    page.flash === panel.id ? "bg-blue-500/10" : ""
                  }`}
                >
                  <h4 className="text-[13px]">
                    <span className="text-app-ink/50">{section.title}: </span>
                    <span className="font-semibold">
                      <Highlight text={panel.title} query={page.query} />
                    </span>
                  </h4>
                  <p className="mb-2 mt-1 text-xs text-app-ink/70">
                    {panel.description}
                  </p>
                  {panel.render()}
                  <p className="mt-1.5 font-mono text-[10px] text-app-ink/40">
                    {panel.id}
                  </p>
                </div>
              ))}
              {section.groups.map((group) => (
                <div
                  key={group.scope}
                  id={`settings-group-${section.id}-${group.scope}`}
                  className="scroll-mt-44"
                >
                  {group.folded ? (
                    <button
                      type="button"
                      onClick={() =>
                        page.unfold(`${section.id}.${group.scope}`)
                      }
                      className={`${pillClass(false)} ml-8 mt-2`}
                    >
                      Show {group.rows.length}{" "}
                      {group.scope === "env" ? ".env values" : "code constants"}
                    </button>
                  ) : (
                    group.rows.map((row) => (
                      <Item
                        key={row.id}
                        row={row}
                        page={page}
                        topicTitle={section.title}
                      />
                    ))
                  )}
                </div>
              ))}
            </section>
          ))}
          {!page.isLoading && page.sections.length === 0 && (
            <p className="py-12 text-center text-sm text-app-ink/50">
              Nothing matches.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
