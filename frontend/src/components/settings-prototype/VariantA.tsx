/**
 * PROTOTYPE, throw away. Variant A, "Panels + toolbar": Settings in the
 * workspace's own language. One toolbar like Posts' (muted search, `Label
 * value` pills, a count line), then one Action-style panel per topic stacked on
 * one page, rows on ActionRow's fixed columns so every control lines up.
 */
import { ChevronDown, RotateCcw, Search, X } from "lucide-react"
import { Options, Pill } from "@/components/PostFilterParts"
import { TgInput } from "@/components/ui/tg-input"
import {
  Highlight,
  Provenance,
  RowMenu,
  SettingControl,
  TOPIC_ICONS,
} from "./controls"
import { formatValue, OPERATORS, type Row, SCOPES } from "./model"
import { elementId, type SettingsPage, useSettingsPage } from "./sections"

const microLabel =
  "text-[10px] font-bold uppercase tracking-widest text-app-ink/50"

function Toolbar({ page }: { page: SettingsPage }) {
  const { query, setQuery, filters, setFilters, totals } = page
  const scopeLabel = SCOPES.find((s) => s.id === filters.scope)?.label ?? "All"
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
          />
          <TgInput
            variant="muted"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings, ids, .env names, values…"
            aria-label="Search settings"
            className="h-9 pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <Pill label="Scope" value={scopeLabel} active={filters.scope !== "all"}>
          <Options
            options={[
              { value: "all", label: "Everything" },
              ...SCOPES.map((s) => ({ value: s.id, label: s.label })),
            ]}
            value={filters.scope}
            onChange={(scope) => setFilters({ ...filters, scope })}
          />
        </Pill>
        <Pill
          label="Show"
          value={filters.modifiedOnly ? "Modified" : "All"}
          active={filters.modifiedOnly}
        >
          <Options
            options={[
              { value: "all", label: "All values" },
              { value: "modified", label: "Changed from default" },
            ]}
            value={filters.modifiedOnly ? "modified" : "all"}
            onChange={(v) =>
              setFilters({ ...filters, modifiedOnly: v === "modified" })
            }
          />
        </Pill>
        <Pill
          label="Who"
          value={filters.editableOnly ? "I can change" : "Anyone"}
          active={filters.editableOnly}
        >
          <Options
            options={[
              { value: "any", label: "Everything I can see" },
              { value: "mine", label: "Only what I can change" },
            ]}
            value={filters.editableOnly ? "mine" : "any"}
            onChange={(v) =>
              setFilters({ ...filters, editableOnly: v === "mine" })
            }
          />
        </Pill>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-app-ink/50">
        <span>
          {totals.shown} of {totals.all} settings · {totals.modified} changed
          from default
        </span>
        {query.endsWith("@") || query === ""
          ? OPERATORS.slice(0, 4).map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => setQuery(`${query.replace(/@$/, "")}${op} `)}
                className="font-mono hover:text-app-ink"
              >
                {op}
              </button>
            ))
          : null}
      </div>
    </div>
  )
}

function SettingLine({ row, page }: { row: Row; page: SettingsPage }) {
  const flashing = page.flash === row.id
  return (
    <li
      id={elementId(row.id)}
      className={`group grid items-center gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)_auto] ${
        flashing ? "bg-amber-300/20" : ""
      }`}
    >
      <div className="min-w-0">
        <h4 className="flex items-center gap-1.5 text-sm font-bold">
          {row.modified && (
            <span
              title="Changed from default"
              className="size-1.5 shrink-0 rounded-full bg-sky-500"
            />
          )}
          <Highlight text={row.title} query={page.query} />
        </h4>
        {row.description && (
          <p className="text-[11px] leading-snug text-app-ink/60">
            <Highlight text={row.description} query={page.query} />
          </p>
        )}
        <p className="truncate font-mono text-[10px] text-app-ink/40">
          <Highlight text={row.id} query={page.query} />
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div>
          <SettingControl
            row={row}
            onChange={(value) => void page.save(row, value)}
          />
        </div>
        <div className="flex flex-wrap gap-x-2">
          {row.modified && (
            <span className="text-[10px] text-sky-600 dark:text-sky-400">
              Default {formatValue(row.default)}
            </span>
          )}
          <Provenance row={row} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {row.modified && row.canEdit && (
          <button
            type="button"
            aria-label={`Reset ${row.title}`}
            title={`Reset to ${formatValue(row.default)}`}
            onClick={() => void page.reset(row)}
            className="flex size-7 items-center justify-center rounded-md text-app-ink/50 hover:bg-app-ink/5 hover:text-app-ink"
          >
            <RotateCcw size={13} />
          </button>
        )}
        <RowMenu row={row} onReset={() => void page.reset(row)} />
      </div>
    </li>
  )
}

function TopicPanel({
  section,
  page,
}: {
  section: SettingsPage["sections"][number]
  page: SettingsPage
}) {
  const Icon = TOPIC_ICONS[section.id] ?? TOPIC_ICONS.server
  return (
    <section
      id={`topic-${section.id}`}
      className="overflow-hidden rounded-xl border border-app-ink/10 bg-app-card shadow-sm"
    >
      <header className="flex items-center gap-3 border-b border-app-ink/10 bg-app-muted/20 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-app-ink/5 text-app-ink/60">
          <Icon size={15} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">{section.title}</h3>
          <p className="font-mono text-[10px] text-app-ink/40">
            {section.id}.*
          </p>
        </div>
        {section.modifiedCount > 0 && (
          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400">
            {section.modifiedCount} changed
          </span>
        )}
        <span className="text-[11px] text-app-ink/40">
          {section.rowCount + section.panels.length}
        </span>
      </header>
      {section.panels.map((panel) => (
        <div
          key={panel.id}
          id={elementId(panel.id)}
          className={`border-b border-app-ink/10 p-4 last:border-b-0 ${
            page.flash === panel.id ? "bg-amber-300/20" : ""
          }`}
        >
          <div className="mb-3">
            <h4 className="text-sm font-bold">
              <Highlight text={panel.title} query={page.query} />
            </h4>
            <p className="text-[11px] text-app-ink/60">{panel.description}</p>
            <p className="font-mono text-[10px] text-app-ink/40">{panel.id}</p>
          </div>
          {panel.render()}
        </div>
      ))}
      {section.groups.map((group) => {
        const scope = SCOPES.find((s) => s.id === group.scope)
        const key = `${section.id}.${group.scope}`
        return (
          <div key={key} className="border-b border-app-ink/10 last:border-b-0">
            <div className="flex items-center gap-2 px-4 pt-3">
              <span className={microLabel}>{scope?.label}</span>
              <span className="font-mono text-[10px] text-app-ink/30">
                {section.id}.{scope?.segment}
              </span>
              <span className="text-[10px] text-app-ink/40">
                · {scope?.hint}
              </span>
            </div>
            {group.folded ? (
              <button
                type="button"
                onClick={() => page.unfold(key)}
                className="flex w-full items-center gap-1.5 px-4 py-3 text-xs text-app-ink/60 hover:text-app-ink"
              >
                <ChevronDown size={13} /> Show {group.rows.length}{" "}
                {group.scope === "env" ? ".env values" : "constants"}
                {group.rows.some((r) => r.canEdit) &&
                  " (some editable at runtime)"}
              </button>
            ) : (
              <ul className="divide-y divide-app-ink/5">
                {group.rows.map((row) => (
                  <SettingLine key={row.id} row={row} page={page} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

export function VariantA() {
  const page = useSettingsPage()
  return (
    <div className="space-y-4">
      <Toolbar page={page} />
      {page.isLoading && (
        <p className="text-xs opacity-50">Loading settings…</p>
      )}
      {page.error && (
        <p className="text-xs text-red-500">
          Prototype API unreachable: {String(page.error)}
        </p>
      )}
      {page.sections.map((section) => (
        <TopicPanel key={section.id} section={section} page={page} />
      ))}
      {!page.isLoading && page.sections.length === 0 && (
        <p className="py-12 text-center text-sm text-app-ink/50">
          Nothing matches.
        </p>
      )}
    </div>
  )
}
