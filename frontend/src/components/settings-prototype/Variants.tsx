// PROTOTYPE: the Settings tab variants. See shared.tsx. Never merge.
import { ArrowLeft, ChevronRight, Search, TriangleAlert } from "lucide-react"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import {
  ALL_GROUPS,
  AREAS,
  type Area,
  findGroup,
  type Group,
  GroupBody,
  ItemView,
  itemLabel,
  itemText,
  SCOPE_META,
  type Scope,
  ScopeChip,
  useModifiedIds,
} from "./shared"

const area = (id: Area["id"]) => AREAS.find((a) => a.id === id) as Area

const DeploymentBanner: React.FC = () => (
  <div className="mb-6 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
    <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-600" />
    <span>
      These values apply to <b>every account</b> on this deployment. Only an
      Admin can change them.
    </span>
  </div>
)

/* ------------------------------------------------------------------ */
/* C. Search first: no navigation, a search box and what you changed.  */
/* ------------------------------------------------------------------ */

const C_FILTERS: (Scope | "all")[] = [
  "all",
  "device",
  "account",
  "deployment",
  "tool",
]

export const VariantC: React.FC = () => {
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<Scope | "all">("all")
  const [open, setOpen] = useState<Group | null>(null)
  const modified = useModifiedIds()

  const inScope = ALL_GROUPS.filter((g) => scope === "all" || g.scope === scope)
  const q = query.trim().toLowerCase()
  const hits = useMemo(
    () =>
      q
        ? inScope
            .map((g) => ({
              g,
              items: g.items.filter((i) => itemText(i, g).includes(q)),
            }))
            .filter((h) => h.items.length > 0)
        : [],
    [q, inScope],
  )
  const changed = inScope
    .map((g) => ({ g, ids: modified(g) }))
    .filter((c) => c.ids.length > 0)

  return (
    <div className="-m-8 h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="relative">
          <Search
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40"
          />
          <input
            // biome-ignore lint/a11y/noAutofocus: the box is the whole page
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(null)
            }}
            placeholder="What do you want to change? (proxy, theme, retention, password…)"
            className="w-full rounded-lg border border-app-ink/20 bg-app-card py-4 pl-12 pr-4 text-base outline-none focus:border-app-ink/50"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {C_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setScope(f)}
              className={cn(
                "rounded-full border px-3 py-1 text-[10px] font-mono uppercase tracking-widest",
                scope === f
                  ? "border-app-ink bg-app-ink text-app-card"
                  : "border-app-ink/15 opacity-70",
              )}
            >
              {f === "all" ? "Everything" : SCOPE_META[f].label}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {open ? (
            <>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="mb-4 flex items-center gap-1 text-xs opacity-60 hover:opacity-100"
              >
                <ArrowLeft size={14} /> All settings
              </button>
              {open.scope === "deployment" && <DeploymentBanner />}
              <GroupBody group={open} />
            </>
          ) : q ? (
            hits.length === 0 ? (
              <p className="text-sm opacity-60">Nothing matches “{query}”.</p>
            ) : (
              <div className="space-y-8">
                {hits.map(({ g, items }) => (
                  <div key={g.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(g)}
                      className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-60 hover:opacity-100"
                    >
                      {g.label} <ChevronRight size={12} />
                      <ScopeChip scope={g.scope} />
                    </button>
                    <div className="space-y-4">
                      {items.map((i) => (
                        <ItemView key={i.id} item={i} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <>
              <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest opacity-50">
                Changed from default
              </h3>
              {changed.length === 0 ? (
                <p className="mb-8 text-sm opacity-60">
                  Everything is at its default.
                </p>
              ) : (
                <div className="mb-10 space-y-1">
                  {changed.map(({ ids }) =>
                    ids.map((id) => (
                      <ItemView key={id} item={{ kind: "setting", id }} />
                    )),
                  )}
                </div>
              )}
              <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest opacity-50">
                Browse
              </h3>
              <div className="divide-y divide-app-ink/10 border-y border-app-ink/10">
                {inScope.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setOpen(g)}
                    className="flex w-full items-center gap-3 py-3 text-left hover:bg-app-ink/5"
                  >
                    <g.icon size={16} className="shrink-0 opacity-50" />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-bold">{g.label}</span>
                      <span className="block truncate text-xs opacity-50">
                        {g.items.map(itemLabel).join(" · ")}
                      </span>
                    </span>
                    <ScopeChip scope={g.scope} />
                    <ChevronRight size={14} className="opacity-40" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* D. Tasks: a home of things you came to do, each a focused page.     */
/* ------------------------------------------------------------------ */

const TASKS: { id: string; title: string; why: string; groups: string[] }[] = [
  {
    id: "look",
    title: "Make it look right",
    why: "Theme, and which fields a channel card shows.",
    groups: ["display"],
  },
  {
    id: "ai",
    title: "Use my own AI key",
    why: "Add a key, pick the model and language your Summaries use.",
    groups: ["ai-keys", "ai"],
  },
  {
    id: "follows",
    title: "Decide how new follows sync",
    why: "How far back a new follow reaches, and your sync schedules.",
    groups: ["follows", "setting-groups"],
  },
  {
    id: "publish",
    title: "Post Summaries to Telegram",
    why: "Connect a bot and choose where it posts.",
    groups: ["publishing"],
  },
  {
    id: "history",
    title: "Keep or clear my history",
    why: "Log and report windows, export and import.",
    groups: ["my-data"],
  },
  {
    id: "account",
    title: "Manage my account",
    why: "Profile, password, today's usage, deletion.",
    groups: ["profile", "password", "usage", "danger"],
  },
  {
    id: "run",
    title: "Run the deployment",
    why: "Sync schedule, Reach, translation and corpus retention for everyone.",
    groups: ["sync-policy", "reach", "translation", "corpus-retention"],
  },
  {
    id: "network",
    title: "Get past Telegram blocking",
    why: "Proxies and Tor for every account's traffic.",
    groups: ["proxy", "tor"],
  },
]

export const VariantD: React.FC = () => {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [tool, setTool] = useState<Group | null>(null)
  const modified = useModifiedIds()
  const task = TASKS.find((t) => t.id === taskId)
  const groupsOf = (ids: string[]) =>
    ids.map((id) => findGroup(id)).filter((g): g is Group => Boolean(g))
  const scopeOf = (ids: string[]) =>
    Array.from(new Set(groupsOf(ids).map((g) => g.scope)))

  if (tool || task) {
    const groups = tool ? [tool] : groupsOf(task?.groups ?? [])
    return (
      <div className="-m-8 h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <button
            type="button"
            onClick={() => {
              setTaskId(null)
              setTool(null)
            }}
            className="mb-6 flex items-center gap-1 text-xs opacity-60 hover:opacity-100"
          >
            <ArrowLeft size={14} /> Settings
          </button>
          <h2 className="text-2xl font-bold">{tool?.label ?? task?.title}</h2>
          <p className="mb-8 mt-1 text-sm opacity-60">
            {tool?.blurb ?? task?.why}
          </p>
          {groups.some((g) => g.scope === "deployment") && <DeploymentBanner />}
          <div className="space-y-12">
            {groups.map((g) => (
              <GroupBody key={g.id} group={g} heading={groups.length > 1} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="-m-8 h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h2 className="mb-1 text-2xl font-bold">What do you want to do?</h2>
        <p className="mb-8 text-sm opacity-60">
          Pick a task. Each one shows only what it needs.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TASKS.map((t) => {
            const n = groupsOf(t.groups).reduce(
              (sum, g) => sum + modified(g).length,
              0,
            )
            const scopes = scopeOf(t.groups)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTaskId(t.id)}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md",
                  scopes.includes("deployment")
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-app-ink/15",
                )}
              >
                <span className="text-base font-bold">{t.title}</span>
                <span className="flex-1 text-xs opacity-60">{t.why}</span>
                <span className="flex items-center gap-1">
                  {scopes.map((sc) => (
                    <ScopeChip key={sc} scope={sc} />
                  ))}
                  {n > 0 && (
                    <span className="ml-auto text-[10px] text-amber-600">
                      {n} changed
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <h3 className="mb-3 mt-12 text-[10px] font-bold uppercase tracking-widest opacity-50">
          Tools
        </h3>
        <div className="flex flex-wrap gap-2">
          {area("tools").groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setTool(g)}
              className="flex items-center gap-2 rounded-full border border-app-ink/15 px-3 py-1.5 text-xs hover:bg-app-ink/5"
            >
              <g.icon size={12} className="opacity-60" /> {g.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* F's parts: account card, coloured icon list, inset group.          */
/* ------------------------------------------------------------------ */

const TINT: Record<Scope, string> = {
  device: "bg-sky-500",
  account: "bg-emerald-500",
  deployment: "bg-amber-500",
  tool: "bg-zinc-500",
}

const AccountCard: React.FC<{ selected: boolean; onClick: () => void }> = ({
  selected,
  onClick,
}) => {
  const { user } = useAuth()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg p-2 text-left",
        selected ? "bg-sky-600 text-white" : "hover:bg-app-ink/5",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-400 to-zinc-600 text-lg font-bold text-white">
        {(user?.full_name || user?.email || "?").charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {user?.full_name || "Your account"}
        </span>
        <span className="block truncate text-xs opacity-70">{user?.email}</span>
      </span>
    </button>
  )
}

const SidebarSearch: React.FC<{
  value: string
  onChange: (v: string) => void
}> = ({ value, onChange }) => (
  <div className="relative">
    <Search
      size={13}
      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40"
    />
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search"
      className="w-full rounded-md border border-app-ink/10 bg-app-card py-1.5 pl-8 pr-2 text-sm outline-none"
    />
  </div>
)

const SidebarRow: React.FC<{
  group: Group
  selected: boolean
  onClick: () => void
  changed?: number
}> = ({ group: g, selected, onClick, changed = 0 }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
      selected ? "bg-sky-600 text-white" : "hover:bg-app-ink/5",
    )}
  >
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-md text-white",
        TINT[g.scope],
      )}
    >
      <g.icon size={14} />
    </span>
    <span className="flex-1">{g.label}</span>
    {changed > 0 && (
      <span
        title={`${changed} changed from default`}
        className={cn(
          "text-[10px]",
          selected ? "text-white" : "text-amber-600",
        )}
      >
        {changed}
      </span>
    )}
  </button>
)

/** E's group pane: title, blurb, then the items in one inset card. */
const InsetGroup: React.FC<{ group: Group; banner?: boolean }> = ({
  group,
  banner = true,
}) => (
  <>
    <h2 className="mb-1 text-xl font-semibold">{group.label}</h2>
    <p className="mb-6 text-xs opacity-60">
      {group.blurb} <ScopeChip scope={group.scope} className="ml-1" />
    </p>
    {banner && group.scope === "deployment" && <DeploymentBanner />}
    <div
      className={cn(
        group.scope === "tool"
          ? "terminal-theme text-app-ink"
          : "rounded-xl border border-app-ink/10 bg-app-muted/40 px-5 py-2 [&>*+*]:border-t [&>*+*]:border-app-ink/10",
      )}
    >
      {group.items.map((item) => (
        <div key={item.id} className="py-2">
          <ItemView item={item} />
        </div>
      ))}
    </div>
  </>
)

/* ------------------------------------------------------------------ */
/* F. Coloured sidebar over one page, sectioned by who it affects.    */
/* ------------------------------------------------------------------ */

const F_PAGE: { area: Area["id"]; label: string | null }[] = [
  { area: "account", label: null },
  { area: "you", label: null },
  { area: "deployment", label: "Deployment · admins" },
]

export const VariantF: React.FC = () => {
  const scroller = useRef<HTMLElement>(null)
  const modified = useModifiedIds()
  const [active, setActive] = useState("profile")
  const [toolId, setToolId] = useState<string | null>(null)
  const [jumpTo, setJumpTo] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const matches = (g: Group) =>
    !q || g.items.some((i) => itemText(i, g).includes(q))
  const tool = toolId ? findGroup(toolId) : undefined
  const accountIds = area("account").groups.map((g) => g.id)

  const jump = (id: string) => {
    setToolId(null)
    setActive(id)
    setJumpTo(id)
  }

  // B's scroll-spy; the page remounts when a tool closes, so re-arm then.
  useEffect(() => {
    const root = scroller.current
    if (!root || toolId) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0]
        if (top) setActive(top.target.id.replace("f-", ""))
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    )
    for (const el of root.querySelectorAll("[data-f-group]")) io.observe(el)
    return () => io.disconnect()
  }, [toolId])

  // Jump once the page is back, when coming from a tool.
  useEffect(() => {
    if (!jumpTo) return
    document
      .getElementById(`f-${jumpTo}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
    setJumpTo(null)
  }, [jumpTo])

  const sidebar: { label: string | null; groups: Group[] }[] = [
    ...F_PAGE.filter((p) => p.area !== "account").map((p) => ({
      label: p.label,
      groups: area(p.area).groups,
    })),
    { label: "Tools", groups: area("tools").groups },
  ]

  return (
    <div className="-m-8 flex h-full">
      <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-app-ink/10 bg-app-muted/50 p-3">
        <SidebarSearch value={query} onChange={setQuery} />
        <AccountCard
          selected={!tool && accountIds.includes(active)}
          onClick={() => jump(accountIds[0])}
        />
        {sidebar.map((sec) => {
          const groups = sec.groups.filter(matches)
          if (groups.length === 0) return null
          return (
            <div key={sec.label ?? "you"} className="space-y-0.5">
              {sec.label && (
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold opacity-50">
                  {sec.label}
                </div>
              )}
              {groups.map((g) => (
                <SidebarRow
                  key={g.id}
                  group={g}
                  selected={tool ? tool.id === g.id : active === g.id}
                  changed={modified(g).length}
                  onClick={() =>
                    g.scope === "tool" ? setToolId(g.id) : jump(g.id)
                  }
                />
              ))}
            </div>
          )
        })}
      </aside>
      <main
        ref={scroller}
        className="min-w-0 flex-1 overflow-y-auto px-10 py-8"
      >
        <div className="mx-auto max-w-3xl">
          {tool ? (
            <InsetGroup group={tool} />
          ) : (
            <div className="space-y-16">
              {F_PAGE.map((p) => (
                <div key={p.area} className="space-y-14">
                  {p.area === "deployment" && (
                    <div className="border-t border-amber-500/40 pt-8">
                      <DeploymentBanner />
                    </div>
                  )}
                  {area(p.area).groups.map((g) => (
                    <section
                      key={g.id}
                      id={`f-${g.id}`}
                      data-f-group
                      className="scroll-mt-8"
                    >
                      <InsetGroup group={g} banner={false} />
                    </section>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
