/**
 * PROTOTYPE variants D and E. Every plain row is drawn from the backend's
 * JSON Schema (`GET /proto/settings/schema`); the frontend keeps only a layout.
 * Configuration is folded in: `.env` policy knobs are rows, seeds sit in the
 * row they seed, everything else is read-only under its group for Admins. The
 * tools live in the System tab.
 *
 * E (`nested`) addresses every setting by a VS Code-style id from the backend,
 * `namespace.section.name` (`sync.schedule.intervalMinutes`): the layout
 * selects by id prefix, the second segment becomes a sub-heading, and search,
 * deep links (`?setting=<id>`) and "Copy setting id" all use it.
 */
import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { ChevronDown, Search, X } from "lucide-react"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { headers } from "@/api/base"
import { Badge } from "@/components/ui/badge"
import useAuth from "@/hooks/useAuth"
import { useCanManageJobs } from "@/hooks/useJobsStatus"
import { cn } from "@/lib/utils"
import type { ProtoPanelId } from "./model"
import { AREA_LABEL, PAGES, PageView } from "./pages"
import { ProtoPanel } from "./panels"
import {
  fieldsOf,
  matchesField,
  SchemaRow,
  type SchemaScope,
  select,
  useIsModified,
  useSettingsSchema,
} from "./schema-settings"

/** The only settings knowledge the frontend keeps: where things go. */
const LAYOUT: {
  id: string
  label: string
  blurb: string
  /** D: storage rows. */
  items: string[]
  /** E: nested id prefixes. */
  idItems: string[]
  panels: ProtoPanelId[]
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    blurb: "Kept per browser, so each device can look different.",
    items: ["appearance.*"],
    idItems: ["appearance.*"],
    panels: [],
  },
  {
    id: "ai",
    label: "AI",
    blurb:
      "Your models and language follow you; translation is deployment-wide.",
    items: ["ai_prefs.*", "translation.*", "jobs.embeddingsEnabled"],
    idItems: ["ai.*"],
    panels: ["ai-keys"],
  },
  {
    id: "sync",
    label: "Channels & sync",
    blurb: "Your defaults for new follows, then the deployment's schedule.",
    items: ["sync_prefs.*", "sync.*", "reach.*"],
    idItems: ["sync.*"],
    panels: ["setting-groups", "jobs"],
  },
  {
    id: "publishing",
    label: "Publishing",
    blurb: "How a Publication reads, and the bots that send it.",
    items: ["publishing.*"],
    idItems: ["publishing.*"],
    panels: ["bots", "destinations", "quick-message"],
  },
  {
    id: "retention",
    label: "Retention",
    blurb: "How long your logs and the shared corpus are kept.",
    items: ["retention_prefs.*", "retention.*"],
    idItems: ["retention.*"],
    panels: [],
  },
  {
    id: "network",
    label: "Network",
    blurb: "Proxies and Tor.",
    items: [],
    idItems: [],
    panels: ["proxy", "tor"],
  },
  {
    id: "directory",
    label: "Directory & Discover",
    blurb: "How the Directory harvest and Discover probes run.",
    items: [],
    idItems: [],
    panels: [],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    blurb: "Database, mail, secrets: what the app needs before it starts.",
    items: [],
    idItems: [],
    panels: [],
  },
  {
    id: "access",
    label: "Access & sessions",
    blurb: "Were `.env` only. Now an Admin changes them without a redeploy.",
    items: ["access.*", "sessions.*", "housekeeping.*"],
    idItems: ["access.*", "system.*"],
    panels: [],
  },
]

type ScopeFilter = SchemaScope | "all"
const SCOPE_CHIP: Record<SchemaScope, string> = {
  device: "This browser",
  account: "My account",
  deployment: "Deployment",
}

interface EnvRow {
  key: string
  value: unknown
  source: string | null
  configured: boolean
  codeDefault: unknown
  group: string
  /** Variant E: the derived nested id, `network.fetch.retries`. */
  id: string
  seedOf: string | null
  kind: "policy" | "secret" | "bootstrap" | "startup" | "seed"
  reason: string
}

function useEnvRows(enabled: boolean) {
  return useQuery({
    queryKey: ["proto-settings-env"],
    enabled,
    queryFn: async () =>
      (
        await fetch("/proto/settings/env", { headers: headers() })
      ).json() as Promise<EnvRow[]>,
  })
}

const show = (v: unknown) =>
  v === null || v === undefined || v === "" ? "not set" : JSON.stringify(v)

/** A group's `.env` values, read-only, behind a disclosure. */
const EnvSection: React.FC<{
  rows: EnvRow[]
  open: boolean
  nested: boolean
}> = ({ rows, open: forced, nested }) => {
  const [open, setOpen] = useState(false)
  const expanded = open || forced
  return (
    <section className="py-3 pl-4 pr-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[13px] text-app-ink/60 hover:text-app-ink"
      >
        <ChevronDown
          size={14}
          className={cn("transition-transform", !expanded && "-rotate-90")}
        />
        {expanded ? "Hide" : "Show"} {rows.length} deployment value
        {rows.length === 1 ? "" : "s"} (read-only, set in .env)
      </button>
      {expanded ? (
        <div className="mt-2 divide-y divide-app-ink/5 rounded-md border border-app-ink/10 bg-app-muted/20">
          {rows.map((r) => (
            <div
              key={r.key}
              id={nested ? `setting-${r.id}` : `setting-env-${r.key}`}
              className="flex items-start gap-4 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {nested ? r.id : r.key}
                  </span>
                  {nested ? (
                    <span className="font-mono text-[11px] text-app-ink/40">
                      .env {r.key}
                    </span>
                  ) : null}
                  <Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge>
                </div>
                <p className="mt-0.5 text-[12px] text-app-ink/50">
                  {r.reason}
                  {r.kind === "startup" || r.kind === "seed"
                    ? " Change it in .env; it applies after a restart."
                    : ""}
                </p>
              </div>
              <div className="max-w-72 shrink-0 text-right">
                <div className="truncate font-mono text-xs">
                  {r.kind === "secret"
                    ? r.configured
                      ? "set (hidden)"
                      : "not set"
                    : show(r.value ?? r.codeDefault)}
                </div>
                <div className="text-[11px] text-app-ink/40">
                  {r.configured ? (r.source ?? ".env") : "code default"}
                  {r.kind !== "secret" &&
                  r.configured &&
                  JSON.stringify(r.value) !== JSON.stringify(r.codeDefault)
                    ? ` · code default ${show(r.codeDefault)}`
                    : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

const KIND_LABEL: Record<EnvRow["kind"], string> = {
  policy: "editable in Settings",
  seed: "starting value of a setting",
  startup: "read at startup",
  bootstrap: "bootstrap",
  secret: "secret",
}

/** Groups that only hold `.env` values, so only Admins see them. */
const ENV_ONLY_GROUPS = new Set(["directory", "infrastructure"])
/** Configuration is folded into the groups; the tools live in the System tab. */
const TOOL_PAGES = new Set([
  "logs",
  "network-telemetry",
  "table-sizes",
  "query",
  "transfer",
])
const D_PAGES = PAGES.filter(
  (p) => p.id !== "configuration" && !TOOL_PAGES.has(p.id),
)
const workspaceRoute = getRouteApi("/_tg/workspace")

export const VariantD: React.FC<{
  highlightId: string | null
  /** Variant E: nested VS Code-style ids. */
  nested?: boolean
}> = ({ highlightId, nested = false }) => {
  const navigate = workspaceRoute.useNavigate()
  const { data: rows, error, isLoading } = useSettingsSchema()
  const isModified = useIsModified()
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<ScopeFilter>("all")
  const [modifiedOnly, setModifiedOnly] = useState(false)
  const [active, setActive] = useState("appearance")
  const [pageId, setPageId] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pages = D_PAGES
  const page = pages.find((p) => p.id === pageId)
  const isAdmin = useCanManageJobs()
  const { user } = useAuth()
  const { data: envRows = [] } = useEnvRows(isAdmin)
  const seedByField = Object.fromEntries(
    envRows.filter((e) => e.seedOf).map((e) => [e.seedOf, e]),
  )
  const envMatches = (e: EnvRow) => {
    const q = query.trim().toLowerCase()
    return !q || `${e.key} ${e.id} ${e.reason}`.toLowerCase().includes(q)
  }

  const fields = useMemo(() => fieldsOf(rows ?? []), [rows])
  const groups = LAYOUT.filter(
    (g) =>
      (g.id !== "access" || isAdmin) && (!ENV_ONLY_GROUPS.has(g.id) || isAdmin),
  ).map((g) => {
    const all = nested
      ? select(fields, g.idItems, true)
      : select(fields, g.items)
    return {
      group: g,
      env:
        !modifiedOnly && (scope === "all" || scope === "deployment")
          ? envRows.filter(
              (e) =>
                e.group === g.id &&
                e.kind !== "policy" &&
                !e.seedOf &&
                envMatches(e),
            )
          : [],
      modified: all.filter(isModified).length,
      fields: all
        .filter((f) => matchesField(f, query))
        .filter((f) => scope === "all" || f.row.scope === scope)
        .filter((f) => !modifiedOnly || isModified(f)),
      panels: g.panels.filter(
        (p) =>
          !modifiedOnly &&
          !query &&
          (scope === "all" ||
            scope ===
              (p === "proxy" || p === "tor" || p === "jobs"
                ? "deployment"
                : "account")),
      ),
    }
  })
  const visible = groups.filter(
    (g) => g.fields.length + g.panels.length + g.env.length > 0,
  )
  const modifiedTotal = groups.reduce((a, g) => a + g.modified, 0)

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const io = new IntersectionObserver(
      (items) => {
        const top = items
          .filter((i) => i.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0]
        if (top) setActive(top.target.id.replace("proto-group-", ""))
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    )
    for (const el of root.querySelectorAll("[id^=proto-group-]")) io.observe(el)
    return () => io.disconnect()
  })

  // Deep link: `?setting=<id>` scrolls to the row once the schema is in.
  useEffect(() => {
    if (!highlightId || !rows) return
    requestAnimationFrame(() =>
      document
        .getElementById(`setting-${highlightId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    )
  }, [highlightId, rows])

  const jump = (id: string) =>
    document
      .getElementById(`proto-group-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })

  return (
    <div className="flex h-full -m-8">
      <aside className="hidden md:flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-app-ink/10 bg-app-muted/40 p-4">
        <div className="mb-2 px-2 text-xs font-semibold text-app-ink/50">
          Settings
        </div>
        {visible.map(({ group, fields: fs, panels, env, modified }) => (
          <button
            key={group.id}
            type="button"
            onClick={() => {
              setPageId(null)
              requestAnimationFrame(() => jump(group.id))
            }}
            className={cn(
              "flex items-center justify-between rounded px-2 py-1.5 text-left text-sm",
              !page && active === group.id
                ? "bg-app-ink/10 font-semibold"
                : "text-app-ink/70 hover:bg-app-ink/5",
            )}
          >
            {group.label}
            <span className="flex items-center gap-1.5">
              {modified > 0 ? <ModifiedCount n={modified} /> : null}
              <span className="text-xs text-app-ink/40">
                {fs.length + panels.length}
                {env.length > 0 ? ` + ${env.length}` : ""}
              </span>
            </span>
          </button>
        ))}
        {(["account", "admin"] as const).map((area) =>
          area === "admin" && !isAdmin ? null : (
            <div key={area} className="mt-5 border-t border-app-ink/10 pt-4">
              <div className="mb-1 px-2 text-xs font-semibold text-app-ink/50">
                {AREA_LABEL[area]}
              </div>
              {pages
                .filter(
                  (p) =>
                    p.area === area &&
                    !(p.notForSuperuser && user?.is_superuser),
                )
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPageId(p.id)}
                    className={cn(
                      "w-full rounded px-2 py-1.5 text-left text-sm",
                      pageId === p.id
                        ? "bg-app-ink/10 font-semibold"
                        : "text-app-ink/70 hover:bg-app-ink/5",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
            </div>
          ),
        )}
        {
          <div className="mt-5 border-t border-app-ink/10 pt-4">
            <button
              type="button"
              onClick={() =>
                navigate({ search: (prev) => ({ ...prev, tab: "system" }) })
              }
              className="w-full rounded px-2 py-1.5 text-left text-sm text-app-ink/70 hover:bg-app-ink/5"
            >
              Logs and tools →
              <span className="block text-xs text-app-ink/45">
                In the System tab
              </span>
            </button>
          </div>
        }
      </aside>

      {page ? (
        <div className="min-w-0 flex-1 overflow-y-auto bg-app-card pb-32">
          <PageView page={page} onBack={() => setPageId(null)} />
        </div>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col bg-app-card",
          page && "hidden",
        )}
      >
        <div className="sticky top-0 z-10 border-b border-app-ink/10 bg-app-card/95 px-8 py-3 backdrop-blur">
          <div className="relative max-w-4xl">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-ink/40"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="w-full rounded border border-app-ink/15 bg-transparent py-2 pl-9 pr-9 text-sm outline-none focus:border-app-ink/40"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-app-ink/50"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(["all", "device", "account", "deployment"] as const).map((s) => (
              <Chip key={s} on={scope === s} onClick={() => setScope(s)}>
                {s === "all" ? "Everything" : SCOPE_CHIP[s]}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-app-ink/15" />
            <Chip on={modifiedOnly} onClick={() => setModifiedOnly((m) => !m)}>
              Modified only{modifiedTotal > 0 ? ` (${modifiedTotal})` : ""}
            </Chip>
          </div>
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto px-8 pb-32">
          <div className="max-w-4xl">
            {isLoading ? (
              <p className="py-16 text-center text-sm text-app-ink/50">
                Loading the settings schema…
              </p>
            ) : null}
            {error ? (
              <p className="py-16 text-center text-sm text-red-500">
                The prototype schema API is not reachable ({String(error)}).
              </p>
            ) : null}
            {visible.map(({ group, fields: fs, panels, env, modified }) => (
              <section
                key={group.id}
                id={`proto-group-${group.id}`}
                className="scroll-mt-4 pt-8"
              >
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  {group.label}
                  {modified > 0 ? <ModifiedCount n={modified} label /> : null}
                </h3>
                <p className="mb-2 text-[13px] text-app-ink/55">
                  {group.blurb}
                </p>
                <div className="divide-y divide-app-ink/5">
                  {fs.map((f, i) => {
                    const section = nested ? sectionOf(f.id) : null
                    const prev =
                      i > 0 && nested ? sectionOf(fs[i - 1].id) : null
                    return (
                      <div key={f.key}>
                        {section && section !== prev ? (
                          <h4 className="pb-1 pt-5 text-[13px] font-semibold text-app-ink/70">
                            {humanize(section)}
                            <span className="ml-2 font-mono text-[11px] font-normal text-app-ink/35">
                              {f.id.split(".").slice(0, 2).join(".")}.*
                            </span>
                          </h4>
                        ) : null}
                        <SchemaRow
                          field={f}
                          nested={nested}
                          highlighted={highlightId === (nested ? f.id : f.key)}
                          seed={seedByField[f.key]}
                        />
                      </div>
                    )
                  })}
                  {panels.map((p) => (
                    <ProtoPanel key={p} id={p} />
                  ))}
                  {env.length > 0 ? (
                    <EnvSection
                      rows={env}
                      nested={nested}
                      open={
                        query.trim() !== "" ||
                        env.some((e) => e.id === highlightId)
                      }
                    />
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** `sync.schedule.intervalMinutes` → `schedule`; two-segment ids have none. */
function sectionOf(id: string): string | null {
  const parts = id.split(".")
  return parts.length > 2 ? parts[1] : null
}

/** `newFollows` → `New follows`. */
function humanize(segment: string): string {
  const words = segment.replace(/([A-Z])/g, " $1").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const Chip: React.FC<{
  on: boolean
  onClick: () => void
  children: React.ReactNode
}> = ({ on, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "rounded-full border px-3 py-1 text-xs",
      on
        ? "border-app-ink bg-app-ink text-app-card"
        : "border-app-ink/15 text-app-ink/70 hover:border-app-ink/40",
    )}
  >
    {children}
  </button>
)

/** Settings in a group that differ from their default. */
export const ModifiedCount: React.FC<{ n: number; label?: boolean }> = ({
  n,
  label,
}) => (
  <span
    title={`${n} setting${n === 1 ? "" : "s"} changed from the default`}
    className="rounded-full bg-amber-500/15 px-1.5 py-px text-[11px] font-medium leading-4 text-amber-700 dark:text-amber-300"
  >
    {label ? `${n} modified` : n}
  </span>
)
