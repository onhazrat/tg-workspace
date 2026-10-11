/**
 * PROTOTYPE variant B, "Generated" (A's layout, rows from the backend schema).
 *
 * The frontend holds only a layout: which group shows which setting, in
 * VS Code's pattern style (`"sync.*"`). Every label, description, default,
 * bound, scope and editability comes from the backend's pydantic models via
 * `GET /proto/settings/schema`. Device-scoped rows (Appearance) are declared
 * there too but stay in this browser; `.env` policy knobs became rows an Admin
 * edits here; Configuration is generated from the same classification.
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
import { AREA_LABEL, PAGES, PageView, type ProtoPage } from "./pages"
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
import { Chip, ModifiedCount } from "./VariantA"

/** The only settings knowledge the frontend keeps: where things go. */
const LAYOUT: {
  id: string
  label: string
  blurb: string
  items: string[]
  panels: ProtoPanelId[]
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    blurb: "Kept per browser, so each device can look different.",
    items: ["appearance.*"],
    panels: [],
  },
  {
    id: "ai",
    label: "AI",
    blurb:
      "Your models and language follow you; translation is deployment-wide.",
    items: ["ai_prefs.*", "translation.*", "jobs.embeddingsEnabled"],
    panels: ["ai-keys"],
  },
  {
    id: "sync",
    label: "Channels & sync",
    blurb: "Your defaults for new follows, then the deployment's schedule.",
    items: ["sync_prefs.*", "sync.*", "reach.*"],
    panels: ["setting-groups", "jobs"],
  },
  {
    id: "publishing",
    label: "Publishing",
    blurb: "How a Publication reads, and the bots that send it.",
    items: ["publishing.*"],
    panels: ["bots", "destinations", "quick-message"],
  },
  {
    id: "retention",
    label: "Retention",
    blurb: "How long your logs and the shared corpus are kept.",
    items: ["retention_prefs.*", "retention.*"],
    panels: [],
  },
  {
    id: "network",
    label: "Network",
    blurb: "Proxies and Tor.",
    items: [],
    panels: ["proxy", "tor"],
  },
  {
    id: "directory",
    label: "Directory & Discover",
    blurb: "How the Directory harvest and Discover probes run.",
    items: [],
    panels: [],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    blurb: "Database, mail, secrets: what the app needs before it starts.",
    items: [],
    panels: [],
  },
  {
    id: "access",
    label: "Access & sessions",
    blurb: "Were `.env` only. Now an Admin changes them without a redeploy.",
    items: ["access.*", "sessions.*", "housekeeping.*"],
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

/** Variant C: a group's `.env` values, read-only, behind a disclosure. */
const EnvSection: React.FC<{ rows: EnvRow[]; open: boolean }> = ({
  rows,
  open: forced,
}) => {
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
              id={`setting-env-${r.key}`}
              className="flex items-start gap-4 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {r.key}
                  </span>
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

/** Configuration, generated from the same backend classification. */
const EnvConfig: React.FC = () => {
  const { data = [], isLoading } = useQuery({
    queryKey: ["proto-settings-env"],
    queryFn: async () =>
      (
        await fetch("/proto/settings/env", { headers: headers() })
      ).json() as Promise<EnvRow[]>,
  })
  const [kind, setKind] = useState<EnvRow["kind"] | "all">("all")
  const counts: Record<string, number> = {}
  for (const r of data) counts[r.kind] = (counts[r.kind] ?? 0) + 1
  if (isLoading) return <p className="text-sm text-app-ink/50">Loading…</p>
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip on={kind === "all"} onClick={() => setKind("all")}>
          All ({data.length})
        </Chip>
        {(Object.keys(KIND_LABEL) as EnvRow["kind"][]).map((k) => (
          <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
            {KIND_LABEL[k]} ({counts[k] ?? 0})
          </Chip>
        ))}
      </div>
      <div className="divide-y divide-app-ink/5 rounded-md border border-app-ink/10">
        {data
          .filter((r) => kind === "all" || r.kind === kind)
          .map((r) => (
            <div key={r.key} className="flex items-start gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">
                    {r.key}
                  </span>
                  <Badge
                    variant={r.kind === "policy" ? "default" : "secondary"}
                  >
                    {KIND_LABEL[r.kind]}
                  </Badge>
                </div>
                <p className="mt-1 text-[12px] text-app-ink/55">{r.reason}</p>
              </div>
              <div className="max-w-64 shrink-0 text-right">
                <div className="truncate font-mono text-xs">
                  {r.value === null || r.value === undefined
                    ? "—"
                    : JSON.stringify(r.value)}
                </div>
                <div className="text-[11px] text-app-ink/40">
                  {r.source ?? ""}
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}

const B_PAGES: ProtoPage[] = PAGES.map((p) =>
  p.id === "configuration"
    ? {
        ...p,
        section: undefined,
        body: EnvConfig,
        from: "Settings → Tools → Configuration catalog (read-only)",
      }
    : p,
)

/** Groups that only hold `.env` values, so only variant C draws them. */
const ENV_ONLY_GROUPS = new Set(["directory", "infrastructure"])
const C_PAGES = PAGES.filter((p) => p.id !== "configuration")
/** Variant D: the tools live in the System tab, not in Settings. */
const TOOL_PAGES = new Set([
  "logs",
  "network-telemetry",
  "table-sizes",
  "query",
  "transfer",
])
const D_PAGES = C_PAGES.filter((p) => !TOOL_PAGES.has(p.id))
const workspaceRoute = getRouteApi("/_tg/workspace")

export const VariantB: React.FC<{
  highlightId: string | null
  /** Variant C: Configuration folded into Settings. */
  merged?: boolean
  /** Variant D: C, with the tools moved to a System tab. */
  toolsTab?: boolean
}> = ({ highlightId, merged = false, toolsTab = false }) => {
  const navigate = workspaceRoute.useNavigate()
  const { data: rows, error, isLoading } = useSettingsSchema()
  const isModified = useIsModified()
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<ScopeFilter>("all")
  const [modifiedOnly, setModifiedOnly] = useState(false)
  const [active, setActive] = useState("appearance")
  const [pageId, setPageId] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pages = toolsTab ? D_PAGES : merged ? C_PAGES : B_PAGES
  const page = pages.find((p) => p.id === pageId)
  const isAdmin = useCanManageJobs()
  const { user } = useAuth()
  const { data: envRows = [] } = useEnvRows(merged && isAdmin)
  const seedByField = Object.fromEntries(
    envRows.filter((e) => e.seedOf).map((e) => [e.seedOf, e]),
  )
  const envMatches = (e: EnvRow) => {
    const q = query.trim().toLowerCase()
    return !q || `${e.key} ${e.reason}`.toLowerCase().includes(q)
  }

  const fields = useMemo(() => fieldsOf(rows ?? []), [rows])
  const groups = LAYOUT.filter(
    (g) =>
      (g.id !== "access" || isAdmin) &&
      (!ENV_ONLY_GROUPS.has(g.id) || (merged && isAdmin)),
  ).map((g) => {
    const all = select(fields, g.items)
    return {
      group: g,
      env:
        merged && !modifiedOnly && (scope === "all" || scope === "deployment")
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
        {toolsTab ? (
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
        ) : null}
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
                  {fs.map((f) => (
                    <SchemaRow
                      key={f.key}
                      field={f}
                      highlighted={highlightId === f.key}
                      seed={merged ? seedByField[f.key] : undefined}
                    />
                  ))}
                  {panels.map((p) => (
                    <ProtoPanel key={p} id={p} />
                  ))}
                  {env.length > 0 ? (
                    <EnvSection rows={env} open={query.trim() !== ""} />
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
