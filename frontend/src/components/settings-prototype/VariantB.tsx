/**
 * PROTOTYPE, throw away. Variant B, "Sticky TOC rail": VS Code's settings
 * editor inside the tab's padding, drawn with the workspace's own pieces.
 *
 * The bar on top is the Directory's (a rounded card holding a big search box
 * and a row of pills), sticky so search is always one click away. The rail
 * follows the scroll. Each setting reads "Topic › Scope: **Title**" with its
 * description and control under it and a blue bar on the left when it is not
 * at its default (blue is the workspace's selection colour). Controls and
 * panels come from `b-kit`, which is only existing primitives.
 */
import { AtSign, Lock, Search, Settings2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { TgMetaChip } from "@/components/ui/tg-chips"
import {
  BarHeading,
  BarPopover,
  BarToggle,
  DraftField,
  Options,
  Pill,
  pillClass,
  Segments,
} from "./b-kit"
import { B_PANEL_BODIES } from "./b-panels"
import { Highlight, Provenance, RowMenu } from "./controls"
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
      { rootMargin: "-180px 0px -55% 0px" },
    )
    for (const id of ids) {
      const el = document.getElementById(`b-topic-${id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [ids])
  return active
}

/** The Directory's bar: search box, then a row of pills, then the count. */
function SearchBar({ page }: { page: SettingsPage }) {
  const { query, setQuery, filters, setFilters, totals } = page
  const scope = SCOPES.find((s) => s.id === filters.scope)
  return (
    <section className="sticky top-0 z-20 mb-4 rounded-xl border border-app-ink/10 bg-app-card shadow-md">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 rounded-xl border border-app-ink/10 bg-app-muted pl-3 pr-1.5 transition-colors focus-within:border-app-ink/30">
          <Search size={16} className="text-app-ink/50" />
          <input
            type="search"
            aria-label="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names, ids, .env names, descriptions and values"
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
      <div className="border-t border-app-ink/5 px-4 py-2 text-[11px] text-app-ink/60">
        <b className="text-app-ink">{totals.shown}</b> of {totals.all} settings
        · {totals.modified} changed from default
      </div>
    </section>
  )
}

function Toc({ page, active }: { page: SettingsPage; active: string | null }) {
  return (
    <nav
      aria-label="Settings contents"
      className="sticky top-44 hidden max-h-[calc(100svh-16rem)] self-start overflow-y-auto md:block"
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
                    ? "bg-app-ink/5 font-semibold text-app-ink"
                    : "text-app-ink/60 hover:text-app-ink"
                }`}
              >
                <span className="truncate">{s.title}</span>
                <span className="flex items-center gap-1 text-[10px] tabular-nums text-app-ink/40">
                  {s.modifiedCount > 0 && (
                    <span
                      title={`${s.modifiedCount} changed`}
                      className="h-1.5 w-1.5 rounded-full bg-blue-500"
                    />
                  )}
                  {s.rowCount + s.panels.length}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** One control per row type, from `b-kit` only. */
function Control({ row, page }: { row: Row; page: SettingsPage }) {
  const save = (value: unknown) => void page.save(row, value)
  if (!row.canEdit) {
    return (
      <span
        title={row.lockReason ?? undefined}
        className="inline-flex max-w-full items-center gap-1.5 truncate rounded-lg bg-app-ink/5 px-2.5 py-1.5 font-mono text-[11px] text-app-ink/70"
      >
        <Lock size={11} className="shrink-0 opacity-60" />
        <span className="truncate">{formatValue(row.value)}</span>
        <span className="font-sans text-app-ink/40">· {row.lockReason}</span>
      </span>
    )
  }
  if (row.type === "boolean") {
    return (
      <BarToggle
        on={Boolean(row.value)}
        onClick={() => save(!row.value)}
        label={row.value ? "On" : "Off"}
        title={row.title}
      />
    )
  }
  if (row.type === "enum" && row.options) {
    if (row.options.length <= 4) {
      return (
        <Segments
          label={row.title}
          options={row.options}
          value={String(row.value)}
          onChange={save}
        />
      )
    }
    return (
      <Pill
        label={row.title}
        value={
          row.options.find((o) => o.value === row.value)?.label ??
          String(row.value)
        }
        active={row.modified}
      >
        <Options
          options={row.options}
          value={String(row.value)}
          onChange={save}
        />
      </Pill>
    )
  }
  const numeric = row.type === "integer" || row.type === "number"
  return (
    <DraftField
      label={row.title}
      numeric={numeric}
      value={String(row.value ?? "")}
      invalid={(draft) => {
        if (!numeric) return false
        const n = Number(draft)
        return (
          draft.trim() === "" ||
          Number.isNaN(n) ||
          (row.type === "integer" && !Number.isInteger(n)) ||
          (row.min != null && n < row.min) ||
          (row.max != null && n > row.max)
        )
      }}
      onCommit={(draft) => save(numeric ? Number(draft) : draft)}
    />
  )
}

const APPLIES: Record<string, string> = {
  restart: "Restart to apply",
  deploy: "Needs a deploy",
  "now (proposed)": "Proposed: live",
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
  return (
    <div
      id={elementId(row.id)}
      className={`group relative scroll-mt-44 rounded-r-lg border-l-2 py-3 pl-8 pr-3 hover:bg-app-ink/[0.03] ${
        row.modified ? "border-blue-500" : "border-transparent"
      } ${flashing ? "bg-blue-500/10" : ""}`}
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
          <span className="font-semibold">
            <Highlight text={row.title} query={page.query} />
          </span>
        </h4>
        {row.modified && (
          <button
            type="button"
            disabled={!row.canEdit}
            onClick={() => void page.reset(row)}
            title={row.canEdit ? "Reset to default" : undefined}
            className="text-[11px] text-blue-600 enabled:hover:underline dark:text-blue-400"
          >
            Changed · default {formatValue(row.default)}
          </button>
        )}
        {APPLIES[row.applies] && (
          <TgMetaChip className="font-normal">
            {APPLIES[row.applies]}
          </TgMetaChip>
        )}
      </div>
      {row.description && (
        <p className="mt-1 max-w-2xl text-xs text-app-ink/70">
          <Highlight text={row.description} query={page.query} />
        </p>
      )}
      <div className="mt-2">
        <Control row={row} page={page} />
      </div>
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
      <SearchBar page={page} />
      {page.isLoading && (
        <p className="px-1 text-xs text-app-ink/50">Loading settings…</p>
      )}
      {page.error && (
        <p className="px-1 text-xs text-red-500">
          Prototype API unreachable: {String(page.error)}
        </p>
      )}
      <div className="grid gap-8 md:grid-cols-[11rem_minmax(0,1fr)]">
        <Toc page={page} active={active} />
        <div className="min-w-0 space-y-8">
          {page.sections.map((section) => (
            <section
              key={section.id}
              id={`b-topic-${section.id}`}
              className="scroll-mt-48"
            >
              <h3 className="mb-1 border-b border-app-ink/10 pb-1.5 text-sm font-bold">
                {section.title}
                <span className="ml-2 font-mono text-[10px] font-normal text-app-ink/40">
                  {section.id}.*
                </span>
              </h3>
              {section.panels
                .filter((panel) => B_PANEL_BODIES[panel.id])
                .map((panel) => (
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
                    {B_PANEL_BODIES[panel.id]()}
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
                    className={`${pillClass(false)} ml-8 mt-2`}
                  >
                    Show {group.rows.length}{" "}
                    {group.scope === "env" ? ".env values" : "code constants"}
                    <span className="font-mono text-app-ink/50">
                      {section.id}.
                      {SCOPES.find((s) => s.id === group.scope)?.segment}.*
                    </span>
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
