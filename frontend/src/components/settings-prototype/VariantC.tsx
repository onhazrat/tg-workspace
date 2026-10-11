/**
 * PROTOTYPE variant C, "Overview + drawer" (Home Assistant / GitLab
 * progressive disclosure). The page answers "how is this set up?" in one
 * sentence per area; editing happens in a side drawer that shows the
 * essentials first and hides tuning behind "Show advanced". Tools leave
 * Settings for a System strip only Admins see.
 */
import { ChevronDown, ChevronRight, Search, Wrench } from "lucide-react"
import type React from "react"
import { useMemo, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useSettings } from "@/contexts/SettingsContext"
import { useCanManageJobs } from "@/hooks/useJobsStatus"
import { isSettingModified, SETTINGS_CATALOG } from "@/lib/settings/catalog"
import type { SettingCatalogEntry } from "@/lib/settings/catalog-types"
import { cn } from "@/lib/utils"
import {
  ADVANCED_IDS,
  entryFor,
  MOVED_OUT,
  matches,
  NOT_A_ROW,
  PANEL_INFO,
  PROTO_GROUPS,
  type ProtoGroup,
  type ProtoGroupId,
  type Scope,
  scopeOf,
  sentenceCase,
} from "./model"
import { ProtoRow, ScopeBadge } from "./ProtoRow"
import { ProtoPanel, SystemTool } from "./panels"

type S = ReturnType<typeof useSettings>

const onOff = (b: boolean) => (b ? "on" : "off")
const START: Record<string, string> = {
  retention: "at the retention window",
  relative: "a set time back",
  absolute: "at a fixed date",
}
const days = (n: number) => (n === 0 ? "forever" : `${n} days`)

/** One sentence per area, from live values. */
const SUMMARY: Record<ProtoGroupId, (s: S) => string> = {
  appearance: (s) => {
    const shown = SETTINGS_CATALOG.filter(
      (e) =>
        e.group === "appearance" &&
        e.control.kind === "boolean" &&
        (s as unknown as Record<string, unknown>)[e.id],
    ).length
    return `${s.theme} theme · cards show ${shown} of 8 details`
  },
  ai: (s) =>
    `${s.selectedModel} in ${s.aiLanguage} · translation ${onOff(s.translationEnabled)} · embeddings ${onOff(s.embeddingsEnabled)}`,
  sync: (s) =>
    `every ${s.regularSyncIntervalMinutes} min · new follows start ${
      START[s.globalStartTimeMode] ?? s.globalStartTimeMode
    } · dynamic sync ${onOff(s.dynamicSyncEnabledDefault)}`,
  publishing: (s) =>
    `citations ${s.citationStyle} · link previews ${onOff(s.linkPreviews)} · ${s.timeZone}`,
  retention: (s) =>
    `posts kept ${days(s.postRetentionDays)} · your logs ${days(s.logRetentionDays)}`,
  network: (s) => `proxy ${onOff(s.proxyEnabled)} · Tor ${onOff(s.torEnabled)}`,
}

function groupEntries(g: ProtoGroup): SettingCatalogEntry[] {
  return g.rows
    .filter((id) => !NOT_A_ROW.has(id))
    .map(entryFor)
    .filter((e): e is SettingCatalogEntry => !!e)
}

function scopesOf(g: ProtoGroup): Scope[] {
  const set = new Set<Scope>([
    ...groupEntries(g).map(scopeOf),
    ...g.panels.map((p) => PANEL_INFO[p].scope),
  ])
  return (["browser", "account", "deployment"] as const).filter((s) =>
    set.has(s),
  )
}

export const VariantC: React.FC<{ highlightId: string | null }> = ({
  highlightId: deepLink,
}) => {
  const settings = useSettings()
  const isAdmin = useCanManageJobs()
  const [open, setOpen] = useState<ProtoGroupId | null>(null)
  const [focus, setFocus] = useState<string | null>(deepLink)
  const [query, setQuery] = useState("")

  const raw = settings as unknown as Record<string, unknown>
  const changed = (g: ProtoGroup) =>
    groupEntries(g).filter((e) =>
      isSettingModified(
        e,
        e.id === "theme" ? raw.theme : raw[e.sliceKey ?? e.id],
      ),
    ).length

  const hits = useMemo(
    () =>
      query.trim()
        ? PROTO_GROUPS.flatMap((g) =>
            groupEntries(g)
              .filter((e) => matches(e, query))
              .map((e) => ({ e, g })),
          ).slice(0, 8)
        : [],
    [query],
  )

  const openAt = (g: ProtoGroupId, id: string | null) => {
    setFocus(id)
    setOpen(g)
    setQuery("")
    if (id)
      setTimeout(
        () =>
          document
            .getElementById(`setting-${id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        350,
      )
  }

  const group = PROTO_GROUPS.find((g) => g.id === open)
  const [tool, setTool] = useState<string | null>(null)
  if (tool)
    return (
      <div className="-m-8 h-full overflow-y-auto bg-app-card pb-32">
        <SystemTool section={tool} onBack={() => setTool(null)} />
      </div>
    )

  return (
    <div className="-m-8 h-full overflow-y-auto bg-app-muted/30">
      <div className="mx-auto max-w-4xl px-8 pb-32 pt-8">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-app-ink/60">
          How this workspace is set up. Pick an area to change it.
        </p>

        <div className="relative mt-6">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-3 text-app-ink/40"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a setting…"
            aria-label="Jump to a setting"
            className="w-full rounded-lg border border-app-ink/15 bg-app-card py-2.5 pl-10 pr-3 text-sm outline-none focus:border-app-ink/40"
          />
          {hits.length > 0 ? (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-app-ink/15 bg-app-card shadow-lg">
              {hits.map(({ e, g }) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => openAt(g.id, e.id)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-2 text-left hover:bg-app-ink/5"
                  >
                    <span>
                      <span className="text-sm font-medium">
                        {sentenceCase(e.label)}
                      </span>
                      <span className="ml-2 text-xs text-app-ink/50">
                        {g.label}
                      </span>
                    </span>
                    <ScopeBadge scope={scopeOf(e)} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-6 divide-y divide-app-ink/10 overflow-hidden rounded-lg border border-app-ink/10 bg-app-card">
          {PROTO_GROUPS.map((g) => {
            const n = changed(g)
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => openAt(g.id, null)}
                className="flex w-full items-center gap-6 px-6 py-5 text-left hover:bg-app-ink/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{g.label}</span>
                    {scopesOf(g).map((s) => (
                      <ScopeBadge key={s} scope={s} />
                    ))}
                  </div>
                  <p className="mt-1 truncate text-sm text-app-ink/70">
                    {SUMMARY[g.id](settings)}
                  </p>
                </div>
                {n > 0 ? (
                  <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                    {n} changed
                  </span>
                ) : null}
                <ChevronRight size={18} className="shrink-0 text-app-ink/40" />
              </button>
            )
          })}
        </div>

        {isAdmin ? (
          <div className="mt-10">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wrench size={15} /> System
              <span className="text-xs font-normal text-app-ink/50">
                Admin tools, moved out of Settings
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {MOVED_OUT.map((m) => (
                <button
                  type="button"
                  key={m.section}
                  title={m.why}
                  onClick={() => setTool(m.section)}
                  className="rounded-full border border-app-ink/15 bg-app-card px-3 py-1 text-xs text-app-ink/70 hover:border-app-ink/40 hover:text-app-ink"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto bg-app-card text-app-ink sm:max-w-2xl">
          {group ? <Drawer group={group} focus={focus} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

const Drawer: React.FC<{ group: ProtoGroup; focus: string | null }> = ({
  group,
  focus,
}) => {
  const entries = groupEntries(group)
  const essentials = entries.filter((e) => !ADVANCED_IDS.has(e.id))
  const advanced = entries.filter((e) => ADVANCED_IDS.has(e.id))
  const [showAdvanced, setShowAdvanced] = useState(
    focus !== null && ADVANCED_IDS.has(focus),
  )
  return (
    <>
      <SheetHeader className="border-b border-app-ink/10 px-6 py-5">
        <SheetTitle className="text-lg">{group.label}</SheetTitle>
        <SheetDescription>{group.blurb}</SheetDescription>
      </SheetHeader>
      <div className="px-4 pb-16">
        <div className="divide-y divide-app-ink/5">
          {essentials.map((e) => (
            <ProtoRow key={e.id} entry={e} highlighted={focus === e.id} />
          ))}
        </div>
        {advanced.length > 0 ? (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((a) => !a)}
              className="flex items-center gap-1 px-4 py-3 text-sm text-app-ink/70 hover:text-app-ink"
            >
              <ChevronDown
                size={15}
                className={cn(
                  "transition-transform",
                  !showAdvanced && "-rotate-90",
                )}
              />
              {showAdvanced ? "Hide" : "Show"} {advanced.length} advanced
              setting
              {advanced.length === 1 ? "" : "s"}
            </button>
            {showAdvanced ? (
              <div className="divide-y divide-app-ink/5">
                {advanced.map((e) => (
                  <ProtoRow key={e.id} entry={e} highlighted={focus === e.id} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {group.panels.map((p) => (
          <div key={p} className="mt-4 border-t border-app-ink/10">
            <ProtoPanel id={p} />
          </div>
        ))}
      </div>
    </>
  )
}
