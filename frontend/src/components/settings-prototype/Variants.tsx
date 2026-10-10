// PROTOTYPE: the five Settings tab variants. See shared.tsx. Never merge.
import { ArrowLeft, ChevronRight, Search, TriangleAlert, X } from "lucide-react"
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
/* A. Who it affects: four top tabs, then a group list per tab.        */
/* ------------------------------------------------------------------ */

const A_TABS: { id: Area["id"]; label: string }[] = [
  { id: "you", label: "Your settings" },
  { id: "account", label: "Account" },
  { id: "deployment", label: "Deployment" },
  { id: "tools", label: "Tools" },
]

export const VariantA: React.FC = () => {
  const [tab, setTab] = useState<Area["id"]>("you")
  const groups = area(tab).groups
  const [groupId, setGroupId] = useState(groups[0].id)
  const group = groups.find((g) => g.id === groupId) ?? groups[0]
  const modified = useModifiedIds()

  return (
    <div className="-m-8 flex h-full flex-col">
      <nav className="flex gap-1 border-b border-app-ink/10 px-6 pt-4">
        {A_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id)
              setGroupId(area(t.id).groups[0].id)
            }}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-widest",
              t.id === tab
                ? "border-app-ink"
                : "border-transparent opacity-50 hover:opacity-80",
              t.id === "deployment" && t.id === tab && "border-amber-500",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-app-ink/10 p-3">
          {groups.map((g) => {
            const n = modified(g).length
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupId(g.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm",
                  g.id === group.id ? "bg-app-ink/10" : "hover:bg-app-ink/5",
                )}
              >
                <g.icon size={14} className="opacity-60" />
                <span className="flex-1">{g.label}</span>
                {n > 0 && (
                  <span className="text-[10px] text-amber-600">{n}</span>
                )}
              </button>
            )
          })}
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl">
            {tab === "deployment" && <DeploymentBanner />}
            <GroupBody group={group} />
          </div>
        </main>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* B. One page: everything on one scroll, a sticky outline that spies. */
/* ------------------------------------------------------------------ */

export const VariantB: React.FC = () => {
  const scroller = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(ALL_GROUPS[0].id)
  const [tool, setTool] = useState<Group | null>(null)
  const pageAreas = AREAS.filter((a) => a.id !== "tools")

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0]
        if (top) setActive(top.target.id.replace("b-", ""))
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    )
    for (const el of root.querySelectorAll("[data-b-group]")) io.observe(el)
    return () => io.disconnect()
  }, [])

  const jump = (id: string) =>
    document
      .getElementById(`b-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })

  return (
    <div className="-m-8 flex h-full">
      <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-3xl space-y-16">
          {pageAreas.map((a) => (
            <div key={a.id}>
              <h2
                className={cn(
                  "mb-6 border-b pb-2 text-2xl font-bold",
                  a.id === "deployment"
                    ? "border-amber-500/60"
                    : "border-app-ink/20",
                )}
              >
                {a.label}
              </h2>
              {a.id === "deployment" && <DeploymentBanner />}
              <div className="space-y-12">
                {a.groups.map((g) => (
                  <div
                    key={g.id}
                    id={`b-${g.id}`}
                    data-b-group
                    className="scroll-mt-6"
                  >
                    <GroupBody group={g} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div>
            <h2 className="mb-2 text-2xl font-bold">Tools</h2>
            <p className="mb-4 text-xs opacity-60">
              Not settings. Each opens on its own.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {area("tools").groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setTool(g)}
                  className="flex items-start gap-3 rounded border border-app-ink/15 p-4 text-left hover:bg-app-ink/5"
                >
                  <g.icon size={16} className="mt-0.5 opacity-60" />
                  <span>
                    <span className="block text-sm font-bold">{g.label}</span>
                    <span className="block text-xs opacity-60">{g.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <aside className="hidden w-56 shrink-0 overflow-y-auto border-l border-app-ink/10 p-5 lg:block">
        {pageAreas.map((a) => (
          <div key={a.id} className="mb-5">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest opacity-40">
              {a.label}
            </div>
            {a.groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => jump(g.id)}
                className={cn(
                  "block w-full border-l-2 py-1 pl-3 text-left text-xs",
                  active === g.id
                    ? "border-app-ink font-bold"
                    : "border-transparent opacity-60 hover:opacity-100",
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      {tool && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-[min(1100px,90vw)] overflow-y-auto bg-app-card p-8 shadow-2xl">
            <button
              type="button"
              onClick={() => setTool(null)}
              className="mb-4 flex items-center gap-1 text-xs opacity-60 hover:opacity-100"
            >
              <X size={14} /> Close
            </button>
            <GroupBody group={tool} />
          </div>
        </div>
      )}
    </div>
  )
}

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
/* E. System Settings: account card, coloured icon list, inset pane.   */
/* ------------------------------------------------------------------ */

const E_TINT: Record<Scope, string> = {
  device: "bg-sky-500",
  account: "bg-emerald-500",
  deployment: "bg-amber-500",
  tool: "bg-zinc-500",
}

const E_SECTIONS: { label: string | null; groups: string[] }[] = [
  {
    label: null,
    groups: area("you").groups.map((g) => g.id),
  },
  {
    label: "Deployment · admins",
    groups: area("deployment").groups.map((g) => g.id),
  },
  { label: "Tools", groups: area("tools").groups.map((g) => g.id) },
]

const ACCOUNT_GROUP: Group = {
  id: "account",
  label: "Account",
  icon: area("account").groups[0].icon,
  scope: "account",
  blurb: "Your profile, password, usage and deletion.",
  items: area("account").groups.flatMap((g) => g.items),
}

export const VariantE: React.FC = () => {
  const { user } = useAuth()
  const [selected, setSelected] = useState("display")
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const group =
    selected === "account"
      ? ACCOUNT_GROUP
      : (findGroup(selected) ?? ACCOUNT_GROUP)
  const matches = (g: Group) =>
    !q || g.items.some((i) => itemText(i, g).includes(q))

  return (
    <div className="-m-8 flex h-full">
      <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-app-ink/10 bg-app-muted/50 p-3">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-md border border-app-ink/10 bg-app-card py-1.5 pl-8 pr-2 text-sm outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setSelected("account")}
          className={cn(
            "flex items-center gap-3 rounded-lg p-2 text-left",
            selected === "account"
              ? "bg-sky-600 text-white"
              : "hover:bg-app-ink/5",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-400 to-zinc-600 text-lg font-bold text-white">
            {(user?.full_name || user?.email || "?").charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {user?.full_name || "Your account"}
            </span>
            <span className="block truncate text-xs opacity-70">
              {user?.email}
            </span>
          </span>
        </button>
        {E_SECTIONS.map((sec) => {
          const groups = sec.groups
            .map((id) => findGroup(id))
            .filter((g): g is Group => Boolean(g && matches(g)))
          if (groups.length === 0) return null
          return (
            <div key={sec.label ?? "you"} className="space-y-0.5">
              {sec.label && (
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold opacity-50">
                  {sec.label}
                </div>
              )}
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelected(g.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                    selected === g.id
                      ? "bg-sky-600 text-white"
                      : "hover:bg-app-ink/5",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md text-white",
                      E_TINT[g.scope],
                    )}
                  >
                    <g.icon size={14} />
                  </span>
                  {g.label}
                </button>
              ))}
            </div>
          )
        })}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-1 text-xl font-semibold">{group.label}</h2>
          <p className="mb-6 text-xs opacity-60">
            {group.blurb} <ScopeChip scope={group.scope} className="ml-1" />
          </p>
          {group.scope === "deployment" && <DeploymentBanner />}
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
        </div>
      </main>
    </div>
  )
}
