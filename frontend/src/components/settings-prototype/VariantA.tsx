/**
 * PROTOTYPE variant A, "One list" (VS Code). Every setting in one scroll,
 * the tree on the left tracks where you are, search and scope chips filter
 * in place. Saves as you go, numbers after a 600ms pause.
 */
import { Search, X } from "lucide-react"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSettings } from "@/contexts/SettingsContext"
import useAuth from "@/hooks/useAuth"
import { useCanManageJobs } from "@/hooks/useJobsStatus"
import { isSettingModified } from "@/lib/settings/catalog"
import { cn } from "@/lib/utils"
import {
  entryFor,
  matches,
  NOT_A_ROW,
  PANEL_INFO,
  PROTO_GROUPS,
  type ProtoGroupId,
  SCOPE_LABEL,
  type Scope,
  scopeOf,
} from "./model"
import { ProtoRow } from "./ProtoRow"
import { AREA_LABEL, PAGES, PageView } from "./pages"
import { ProtoPanel } from "./panels"

type ScopeFilter = Scope | "all"

export const VariantA: React.FC<{ highlightId: string | null }> = ({
  highlightId,
}) => {
  const settings = useSettings() as unknown as Record<string, unknown>
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<ScopeFilter>("all")
  const [modifiedOnly, setModifiedOnly] = useState(false)
  const [active, setActive] = useState<ProtoGroupId>("appearance")
  const scroller = useRef<HTMLDivElement>(null)
  const [pageId, setPageId] = useState<string | null>(null)
  const page = PAGES.find((p) => p.id === pageId)
  const isAdmin = useCanManageJobs()
  const { user } = useAuth()

  const visible = useMemo(
    () =>
      PROTO_GROUPS.map((g) => ({
        group: g,
        rows: g.rows
          .filter((id) => !NOT_A_ROW.has(id))
          .map(entryFor)
          .filter((e) => e !== undefined)
          .filter((e) => matches(e, query))
          .filter((e) => scope === "all" || scopeOf(e) === scope)
          .filter(
            (e) =>
              !modifiedOnly ||
              isSettingModified(
                e,
                e.id === "theme"
                  ? settings.theme
                  : settings[e.sliceKey ?? e.id],
              ),
          ),
        panels: g.panels.filter(
          (p) =>
            !modifiedOnly &&
            (scope === "all" || PANEL_INFO[p].scope === scope) &&
            (!query ||
              `${PANEL_INFO[p].label} ${PANEL_INFO[p].blurb}`
                .toLowerCase()
                .includes(query.toLowerCase())),
        ),
      })).filter((v) => v.rows.length + v.panels.length > 0),
    [query, scope, modifiedOnly, settings],
  )

  // Scroll-spy: the topmost group in view is the active TOC node.
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
        if (top)
          setActive(top.target.id.replace("proto-group-", "") as ProtoGroupId)
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    )
    for (const el of root.querySelectorAll("[id^=proto-group-]")) io.observe(el)
    return () => io.disconnect()
  }, [visible])

  const jump = (id: ProtoGroupId) =>
    document
      .getElementById(`proto-group-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })

  return (
    <div className="flex h-full -m-8">
      <aside className="hidden md:flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-app-ink/10 bg-app-muted/40 p-4">
        <div className="mb-2 px-2 text-xs font-semibold text-app-ink/50">
          Settings
        </div>
        {visible.map(({ group, rows, panels }) => (
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
            <span className="text-xs text-app-ink/40">
              {rows.length + panels.length}
            </span>
          </button>
        ))}
        {(["account", "admin"] as const).map((area) =>
          area === "admin" && !isAdmin ? null : (
            <div key={area} className="mt-5 border-t border-app-ink/10 pt-4">
              <div className="mb-1 px-2 text-xs font-semibold text-app-ink/50">
                {AREA_LABEL[area]}
              </div>
              {PAGES.filter(
                (p) =>
                  p.area === area && !(p.notForSuperuser && user?.is_superuser),
              ).map((p) => (
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
            {(["all", "browser", "account", "deployment"] as const).map((s) => (
              <Chip key={s} on={scope === s} onClick={() => setScope(s)}>
                {s === "all" ? "Everything" : SCOPE_LABEL[s]}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-app-ink/15" />
            <Chip on={modifiedOnly} onClick={() => setModifiedOnly((m) => !m)}>
              Modified only
            </Chip>
          </div>
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto px-8 pb-32">
          <div className="max-w-4xl">
            {visible.length === 0 ? (
              <p className="py-16 text-center text-sm text-app-ink/50">
                No settings match.
              </p>
            ) : null}
            {visible.map(({ group, rows, panels }) => (
              <section
                key={group.id}
                id={`proto-group-${group.id}`}
                className="scroll-mt-4 pt-8"
              >
                <h3 className="text-lg font-semibold">{group.label}</h3>
                <p className="mb-2 text-[13px] text-app-ink/55">
                  {group.blurb}
                </p>
                <div className="divide-y divide-app-ink/5">
                  {rows.map((e) => (
                    <ProtoRow
                      key={e.id}
                      entry={e}
                      highlighted={highlightId === e.id}
                    />
                  ))}
                  {panels.map((p) => (
                    <ProtoPanel key={p} id={p} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const Chip: React.FC<{
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
