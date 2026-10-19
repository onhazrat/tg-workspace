/**
 * PROTOTYPE, throw away. Variant B, "Sticky TOC rail": VS Code's settings
 * editor inside the tab's padding. A sticky search line on top, a thin
 * table of contents that follows the scroll, and one column of settings drawn
 * the VS Code way: "Category › Scope: **Title**", description, control under
 * it, a blue bar on the left of anything changed from its default, the gear on
 * the left on hover.
 */
import { ListFilter, Search, Settings2, X } from "lucide-react"
import { useEffect, useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TgMetaChip } from "@/components/ui/tg-chips"
import { TgInput } from "@/components/ui/tg-input"
import { TgToggle } from "@/components/ui/tg-toggle"
import { Highlight, Provenance, RowMenu, SettingControl } from "./controls"
import { formatValue, OPERATORS, type Row, SCOPES } from "./model"
import { elementId, type SettingsPage, useSettingsPage } from "./sections"

function useActiveTopic(ids: string[]) {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const seen = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          seen.set(
            e.target.id.replace("b-topic-", ""),
            e.isIntersecting
              ? e.boundingClientRect.top
              : Number.POSITIVE_INFINITY,
          )
        }
        const top = [...seen.entries()]
          .filter(([, y]) => Number.isFinite(y))
          .sort((a, b) => a[1] - b[1])[0]
        if (top) setActive(top[0])
      },
      { rootMargin: "0px 0px -60% 0px" },
    )
    for (const id of ids) {
      const el = document.getElementById(`b-topic-${id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [ids])
  return active
}

function SearchLine({ page }: { page: SettingsPage }) {
  const { query, setQuery, totals } = page
  return (
    <div className="sticky top-0 z-20 -mx-1 bg-app-bg/95 px-1 pb-3 pt-1 backdrop-blur-sm">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
        />
        <TgInput
          variant="muted"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
          className="h-9 pl-9 pr-20"
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="flex size-7 items-center justify-center rounded-md opacity-50 hover:opacity-100"
            >
              <X size={14} />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Filter settings"
                className="flex size-7 items-center justify-center rounded-md opacity-60 hover:bg-app-ink/5 hover:opacity-100"
              >
                <ListFilter size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="font-mono text-xs">
              {OPERATORS.map((op) => (
                <DropdownMenuItem
                  key={op}
                  onSelect={() =>
                    setQuery(
                      `${query.trim()} ${op}`.trim() +
                        (op.endsWith(":") ? "" : " "),
                    )
                  }
                >
                  {op}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-app-ink/50">
        {page.searching
          ? `${totals.shown} settings found`
          : `${totals.all} settings · ${totals.modified} modified`}
      </p>
    </div>
  )
}

function Toc({ page, active }: { page: SettingsPage; active: string | null }) {
  return (
    <nav
      aria-label="Settings contents"
      className="sticky top-16 hidden max-h-[calc(100svh-12rem)] self-start overflow-y-auto md:block"
    >
      <ul className="space-y-0.5 text-xs">
        {page.sections.map((s) => {
          const on = s.id === active
          return (
            <li key={s.id}>
              <a
                href={`#b-topic-${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document
                    .getElementById(`b-topic-${s.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
                className={`flex items-center justify-between rounded-md px-2 py-1 ${
                  on
                    ? "bg-app-ink/5 font-bold text-app-ink"
                    : "text-app-ink/60 hover:text-app-ink"
                }`}
              >
                <span className="truncate">{s.title}</span>
                <span className="text-[10px] text-app-ink/40">
                  {s.rowCount + s.panels.length}
                </span>
              </a>
              {on && s.groups.length > 1 && (
                <ul className="mb-1 ml-3 border-l border-app-ink/10 pl-2">
                  {s.groups.map((g) => (
                    <li
                      key={g.scope}
                      className="py-0.5 text-[11px] text-app-ink/50"
                    >
                      {SCOPES.find((x) => x.id === g.scope)?.label}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Item({
  row,
  page,
  topicTitle,
}: {
  row: Row
  page: SettingsPage
  topicTitle: string
}) {
  const scope = SCOPES.find((s) => s.id === row.scope)
  const flashing = page.flash === row.id
  const bool = row.type === "boolean" && row.canEdit
  return (
    <div
      id={elementId(row.id)}
      className={`group relative border-l-2 py-3 pl-8 pr-3 hover:bg-app-ink/[0.03] ${
        row.modified ? "border-sky-500" : "border-transparent"
      } ${flashing ? "bg-amber-300/20" : ""}`}
    >
      <div className="absolute left-1.5 top-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <RowMenu
          row={row}
          onReset={() => void page.reset(row)}
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
            {topicTitle} › {scope?.label}:{" "}
          </span>
          <span className="font-bold">
            <Highlight text={row.title} query={page.query} />
          </span>
        </h4>
        {row.modified && (
          <span className="text-[11px] italic text-sky-600 dark:text-sky-400">
            Modified · default {formatValue(row.default)}
          </span>
        )}
        {row.applies !== "now" && (
          <TgMetaChip className="font-normal">
            {row.applies === "restart"
              ? "Restart to apply"
              : row.applies === "deploy"
                ? "Needs a deploy"
                : "Proposed: live"}
          </TgMetaChip>
        )}
      </div>
      {bool ? (
        <label className="mt-1.5 flex max-w-2xl items-start gap-3">
          <TgToggle
            aria-label={row.title}
            checked={Boolean(row.value)}
            onClick={() => void page.save(row, !row.value)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-xs text-app-ink/70">
            <Highlight text={row.description || row.title} query={page.query} />
          </span>
        </label>
      ) : (
        <>
          {row.description && (
            <p className="mt-1 max-w-2xl text-xs text-app-ink/70">
              <Highlight text={row.description} query={page.query} />
            </p>
          )}
          <div className="mt-2">
            <SettingControl
              row={row}
              onChange={(value) => void page.save(row, value)}
            />
          </div>
        </>
      )}
      <p className="mt-1.5 flex flex-wrap gap-x-2 font-mono text-[10px] text-app-ink/40">
        <span>
          <Highlight text={row.id} query={page.query} />
        </span>
        <Provenance row={row} />
      </p>
    </div>
  )
}

export function VariantB() {
  const page = useSettingsPage()
  const active = useActiveTopic(page.sections.map((s) => s.id))
  return (
    <div>
      <SearchLine page={page} />
      {page.isLoading && (
        <p className="text-xs opacity-50">Loading settings…</p>
      )}
      {page.error && (
        <p className="text-xs text-red-500">
          Prototype API unreachable: {String(page.error)}
        </p>
      )}
      <div className="grid gap-8 md:grid-cols-[11rem_minmax(0,1fr)]">
        <Toc page={page} active={active} />
        <div className="min-w-0 space-y-10">
          {page.sections.map((section) => (
            <section
              key={section.id}
              id={`b-topic-${section.id}`}
              className="scroll-mt-20"
            >
              <h3 className="mb-2 border-b border-app-ink/10 pb-1 text-lg font-bold tracking-tight">
                {section.title}
              </h3>
              {section.panels.map((panel) => (
                <div
                  key={panel.id}
                  id={elementId(panel.id)}
                  className={`border-l-2 border-transparent py-3 pl-8 pr-3 ${
                    page.flash === panel.id ? "bg-amber-300/20" : ""
                  }`}
                >
                  <h4 className="text-[13px]">
                    <span className="text-app-ink/50">{section.title}: </span>
                    <span className="font-bold">
                      <Highlight text={panel.title} query={page.query} />
                    </span>
                  </h4>
                  <p className="mb-3 mt-1 text-xs text-app-ink/70">
                    {panel.description}
                  </p>
                  {panel.render()}
                  <p className="mt-1.5 font-mono text-[10px] text-app-ink/40">
                    {panel.id}
                  </p>
                </div>
              ))}
              {section.groups.map((group) =>
                group.folded ? (
                  <button
                    key={group.scope}
                    type="button"
                    onClick={() => page.unfold(`${section.id}.${group.scope}`)}
                    className="ml-8 mt-2 block text-xs text-app-ink/50 hover:text-app-ink hover:underline"
                  >
                    {group.rows.length}{" "}
                    {group.scope === "env" ? ".env values" : "code constants"} (
                    {section.id}.
                    {SCOPES.find((s) => s.id === group.scope)?.segment}.*)
                    hidden. Show
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
                ),
              )}
            </section>
          ))}
          {!page.isLoading && page.sections.length === 0 && (
            <p className="py-12 text-center text-sm text-app-ink/50">
              No settings found.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
