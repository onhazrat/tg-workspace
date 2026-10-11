/**
 * PROTOTYPE (settings redesign, styling), throwaway. Variant E's content drawn
 * with the rest of the workspace's primitives instead of a page of its own:
 * the Channels/Posts toolbar (muted search, `Label value` pills), the Action
 * tab's bordered panel and three-column rows, the Channels card for density.
 * No full-bleed grey sidebar, no text-lg page headings, no Title-Case chips.
 *
 * - F `panels`: toolbar on top, one Action-style panel per group, stacked.
 * - G `rail`: a navigation panel on the left, one group at a time on the right.
 * - H `cards`: compact group cards in two columns; big panels open in a sheet.
 */
import {
  Archive,
  Bot,
  Globe,
  KeyRound,
  Library,
  type LucideIcon,
  Palette,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Sparkles,
  User,
  X,
} from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { Options, Pill, pillClass } from "@/components/PostFilterParts"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { cn } from "@/lib/utils"
import { PANEL_INFO, type ProtoPanelId } from "./model"
import { AREA_LABEL, type PageArea, PageBody, type ProtoPage } from "./pages"
import { ProtoPanel } from "./panels"
import { type Look, LookContext } from "./row-parts"
import { SchemaRow } from "./schema-settings"
import {
  EnvSection,
  humanize,
  type ScopeFilter,
  type SettingsModel,
  sectionOf,
  useSettingsModel,
} from "./VariantD"

export type Skin = "panels" | "rail" | "cards"
type Group = SettingsModel["visible"][number]
type Area = "settings" | PageArea

const GROUP_ICON: Record<string, LucideIcon> = {
  appearance: Palette,
  ai: Sparkles,
  sync: RefreshCw,
  publishing: Bot,
  retention: Archive,
  network: Globe,
  directory: Library,
  infrastructure: Server,
  access: KeyRound,
}

const SCOPE_OPTIONS: { label: string; value: ScopeFilter }[] = [
  { label: "Everything", value: "all" },
  { label: "This browser", value: "device" },
  { label: "My account", value: "account" },
  { label: "Deployment", value: "deployment" },
]

// --- Shared parts ----------------------------------------------------------------

/** The Action tab's panel. */
const Panel: React.FC<{
  id?: string
  className?: string
  children: React.ReactNode
}> = ({ id, className, children }) => (
  <section
    id={id}
    className={cn(
      "scroll-mt-4 overflow-hidden rounded-xl border border-app-ink/10 bg-app-card shadow-sm",
      className,
    )}
  >
    {children}
  </section>
)

/** The Action tab's header strip, with an Action row's icon tile and name. */
const PanelHeader: React.FC<{
  icon: LucideIcon
  title: string
  blurb?: string
  right?: React.ReactNode
}> = ({ icon: Icon, title, blurb, right }) => (
  <header className="flex items-center gap-3 border-b border-app-ink/10 bg-app-muted/20 p-4">
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-app-ink/5 text-app-ink/60">
      <Icon size={15} aria-hidden />
    </span>
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-bold">{title}</h3>
      {blurb ? (
        <p className="text-[11px] leading-snug text-app-ink/60">{blurb}</p>
      ) : null}
    </div>
    {right}
  </header>
)

/** Amber count, the same shape as the Channels facet count. */
const Modified: React.FC<{ n: number }> = ({ n }) =>
  n > 0 ? (
    <span
      title={`${n} changed from the default`}
      className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold tabular-nums text-amber-700 dark:text-amber-300"
    >
      {n} modified
    </span>
  ) : null

/** The uppercase micro-label the Action header uses ("Runs over"). */
const MicroLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[10px] font-bold uppercase tracking-widest text-app-ink/50">
    {children}
  </span>
)

/** A group's rows, sub-sections as strips, panels and `.env` values after. */
const GroupRows: React.FC<{
  g: Group
  m: SettingsModel
  highlightId: string | null
  panels?: "inline" | "sheet"
}> = ({ g, m, highlightId, panels = "inline" }) => (
  <div className="divide-y divide-app-ink/10">
    {g.fields.map((f, i) => {
      const section = sectionOf(f.id)
      const prev = i > 0 ? sectionOf(g.fields[i - 1].id) : null
      return (
        <div key={f.key}>
          {section && section !== prev ? (
            <div className="flex items-center gap-2 bg-app-muted/10 px-4 py-1.5">
              <MicroLabel>{humanize(section)}</MicroLabel>
              <span className="font-mono text-[10px] text-app-ink/35">
                {f.id.split(".").slice(0, 2).join(".")}.*
              </span>
            </div>
          ) : null}
          <SchemaRow
            field={f}
            nested
            highlighted={highlightId === f.id}
            seed={m.seedByField[f.key]}
          />
        </div>
      )
    })}
    {g.panels.map((p) =>
      panels === "inline" ? (
        <ProtoPanel key={p} id={p} />
      ) : (
        <SheetRow key={p} id={p} />
      ),
    )}
    {g.env.length > 0 ? (
      <div className="[&>section]:px-4">
        <EnvSection
          rows={g.env}
          nested
          open={
            m.query.trim() !== "" || g.env.some((e) => e.id === highlightId)
          }
        />
      </div>
    ) : null}
  </div>
)

/** A big production panel as one line that opens it in a sheet (variant H). */
const SheetRow: React.FC<{ id: ProtoPanelId }> = ({ id }) => {
  const info = PANEL_INFO[id]
  return (
    <Sheet>
      <div className="flex items-center gap-3 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {info.label}
        </span>
        <SheetTrigger asChild>
          <TgButton variant="secondary" size="sm">
            Open
          </TgButton>
        </SheetTrigger>
      </div>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-app-card sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{info.label}</SheetTitle>
          <SheetDescription>{info.blurb}</SheetDescription>
        </SheetHeader>
        <div className="[&>section]:pt-0">
          <ProtoPanel id={id} bare />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Search, scope and "modified" in the Channels toolbar's shape. */
const Toolbar: React.FC<{
  m: SettingsModel
  leading?: React.ReactNode
  trailing?: React.ReactNode
  showFilters: boolean
  below?: React.ReactNode
}> = ({ m, leading, trailing, showFilters, below }) => {
  const rows = m.visible.reduce((a, g) => a + g.fields.length, 0)
  const env = m.visible.reduce((a, g) => a + g.env.length, 0)
  return (
    <div className="rounded-xl border border-app-ink/10 bg-app-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 p-3">
        {leading}
        {showFilters ? (
          <>
            <div className="relative min-w-[200px] flex-1">
              <Search
                size={13}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 my-auto text-app-ink/40"
              />
              <TgInput
                variant="muted"
                value={m.query}
                onChange={(e) => m.setQuery(e.target.value)}
                placeholder="Search settings or ids, e.g. sync.schedule"
                aria-label="Search settings"
                className="h-9 py-0 pl-9 pr-8"
              />
              {m.query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => m.setQuery("")}
                  className="absolute inset-y-0 right-2 my-auto h-fit p-1 text-app-ink/50"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
            <Pill
              label="Scope"
              value={
                SCOPE_OPTIONS.find((o) => o.value === m.scope)?.label ?? ""
              }
              active={m.scope !== "all"}
              width="w-48"
            >
              <Options
                options={SCOPE_OPTIONS}
                value={m.scope}
                onChange={m.setScope}
              />
            </Pill>
            <button
              type="button"
              onClick={() => m.setModifiedOnly(!m.modifiedOnly)}
              className={pillClass(m.modifiedOnly)}
            >
              Modified
              {m.modifiedTotal > 0 ? (
                <span className="rounded-full bg-app-ink/15 px-1.5 text-[10px] tabular-nums">
                  {m.modifiedTotal}
                </span>
              ) : null}
            </button>
          </>
        ) : null}
        {trailing}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-app-ink/10 px-3 py-2 text-[11px]">
        {below ?? (
          <span className="font-bold">
            {rows} settings
            {env > 0 ? (
              <span className="font-normal text-app-ink/50">
                {" "}
                · {env} deployment values
              </span>
            ) : null}
          </span>
        )}
      </div>
    </div>
  )
}

const AREA_ICON: Record<Area, LucideIcon> = {
  settings: Settings2,
  account: User,
  admin: KeyRound,
}

function useAreas(m: SettingsModel) {
  const pagesOf = (area: PageArea) =>
    m.pages.filter(
      (p) => p.area === area && !(p.notForSuperuser && m.user?.is_superuser),
    )
  const areas: Area[] = m.isAdmin
    ? ["settings", "account", "admin"]
    : ["settings", "account"]
  return { areas, pagesOf }
}

/** A page from `/settings` or `/admin`, framed as a panel. */
const PagePanel: React.FC<{ page: ProtoPage }> = ({ page }) => (
  <Panel>
    <PanelHeader
      icon={AREA_ICON[page.area]}
      title={page.label}
      blurb={`${AREA_LABEL[page.area]} · today at ${page.from}`}
    />
    <div className="p-6">
      <PageBody page={page} />
    </div>
  </Panel>
)

const Empty: React.FC<{ m: SettingsModel }> = ({ m }) =>
  m.isLoading ? (
    <p className="py-16 text-center text-xs text-app-ink/50">
      Loading the settings schema…
    </p>
  ) : m.error ? (
    <p className="py-16 text-center text-xs text-red-500">
      The prototype schema API is not reachable ({String(m.error)}).
    </p>
  ) : m.visible.length === 0 ? (
    <Panel className="border-dashed py-16 text-center">
      <p className="text-sm font-bold">No settings match</p>
      <p className="mt-1 text-[11px] text-app-ink/60">
        Clear the search or the filters.
      </p>
    </Panel>
  ) : null

function useDeepLink(highlightId: string | null, ready: boolean) {
  useEffect(() => {
    if (!highlightId || !ready) return
    requestAnimationFrame(() =>
      document
        .getElementById(`setting-${highlightId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    )
  }, [highlightId, ready])
}

// --- F: stacked panels -----------------------------------------------------------

const SkinPanels: React.FC<{ highlightId: string | null }> = ({
  highlightId,
}) => {
  const m = useSettingsModel(true)
  const { areas, pagesOf } = useAreas(m)
  const [area, setArea] = useState<Area>("settings")
  const [pageId, setPageId] = useState<string | null>(null)
  useDeepLink(highlightId, Boolean(m.rows))
  const areaPages = area === "settings" ? [] : pagesOf(area)
  const page = areaPages.find((p) => p.id === pageId) ?? areaPages[0]
  const jump = (id: string) =>
    document
      .getElementById(`skin-group-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })

  return (
    <div className="space-y-6">
      <Toolbar
        m={m}
        showFilters={area === "settings"}
        leading={
          <TgSegmentedControl<Area>
            size="sm"
            aria-label="Area"
            value={area}
            onChange={(a) => {
              setArea(a)
              setPageId(null)
            }}
            options={areas.map((a) => ({
              value: a,
              label: a === "settings" ? "Settings" : AREA_LABEL[a],
            }))}
          />
        }
        trailing={
          area === "settings" ? (
            <Pill label="Go to" value="Group" active={false} width="w-56">
              <Options
                options={m.visible.map((g) => ({
                  label: g.group.label,
                  value: g.group.id,
                }))}
                value=""
                onChange={jump}
              />
            </Pill>
          ) : null
        }
        below={
          area === "settings" ? undefined : (
            <div className="flex flex-wrap gap-1.5">
              {areaPages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPageId(p.id)}
                  className={pillClass(p.id === page?.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )
        }
      />
      {area === "settings" ? (
        <>
          <Empty m={m} />
          {m.visible.map((g) => (
            <Panel key={g.group.id} id={`skin-group-${g.group.id}`}>
              <PanelHeader
                icon={GROUP_ICON[g.group.id] ?? Settings2}
                title={g.group.label}
                blurb={g.group.blurb}
                right={<Modified n={g.modified} />}
              />
              <GroupRows g={g} m={m} highlightId={highlightId} />
            </Panel>
          ))}
        </>
      ) : page ? (
        <PagePanel page={page} />
      ) : null}
    </div>
  )
}

// --- G: navigation panel and one group -------------------------------------------

const SkinRail: React.FC<{ highlightId: string | null }> = ({
  highlightId,
}) => {
  const m = useSettingsModel(true)
  const { areas, pagesOf } = useAreas(m)
  const [selected, setSelected] = useState<string>("appearance")
  // A deep link opens the group that holds the setting.
  useEffect(() => {
    if (!highlightId) return
    const g = m.visible.find(
      (v) =>
        v.fields.some((f) => f.id === highlightId) ||
        v.env.some((e) => e.id === highlightId),
    )
    if (g) setSelected(g.group.id)
    // Once, when the schema lands; `visible` is a new array every render.
  }, [highlightId, Boolean(m.rows)])
  useDeepLink(highlightId, Boolean(m.rows))
  const page = m.pages.find((p) => p.id === selected)
  const searching = m.query.trim() !== "" || m.modifiedOnly || m.scope !== "all"
  const shown = searching
    ? m.visible
    : m.visible.filter((g) => g.group.id === selected)

  const item = (
    id: string,
    label: string,
    icon: LucideIcon,
    right?: React.ReactNode,
  ) => {
    const Icon = icon
    const on = selected === id && !(searching && !page)
    return (
      <button
        key={id}
        type="button"
        onClick={() => {
          setSelected(id)
          m.setQuery("")
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
          on
            ? "bg-app-ink text-app-bg"
            : "text-app-ink/70 hover:bg-app-ink/5 hover:text-app-ink",
        )}
      >
        <Icon size={13} className={on ? "" : "text-app-ink/50"} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {right}
      </button>
    )
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      <nav className="sticky top-0 space-y-4 rounded-xl border border-app-ink/10 bg-app-card p-3 shadow-sm">
        {areas.map((a) => (
          <div key={a} className="space-y-0.5">
            <div className="px-2.5 pb-1">
              <MicroLabel>
                {a === "settings" ? "Settings" : AREA_LABEL[a]}
              </MicroLabel>
            </div>
            {a === "settings"
              ? m.visible.map((g) =>
                  item(
                    g.group.id,
                    g.group.label,
                    GROUP_ICON[g.group.id] ?? Settings2,
                    g.modified > 0 ? (
                      <span
                        title={`${g.modified} modified`}
                        className="size-1.5 rounded-full bg-amber-500"
                      />
                    ) : (
                      <span className="text-[10px] tabular-nums opacity-50">
                        {g.fields.length + g.panels.length}
                      </span>
                    ),
                  ),
                )
              : pagesOf(a).map((p) => item(p.id, p.label, AREA_ICON[a]))}
          </div>
        ))}
      </nav>
      <div className="min-w-0 space-y-6">
        {page ? (
          <PagePanel page={page} />
        ) : (
          <>
            <Toolbar m={m} showFilters />
            <Empty m={m} />
            {shown.map((g) => (
              <Panel key={g.group.id}>
                <PanelHeader
                  icon={GROUP_ICON[g.group.id] ?? Settings2}
                  title={g.group.label}
                  blurb={g.group.blurb}
                  right={<Modified n={g.modified} />}
                />
                <GroupRows g={g} m={m} highlightId={highlightId} />
              </Panel>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// --- H: compact cards ------------------------------------------------------------

const SkinCards: React.FC<{ highlightId: string | null }> = ({
  highlightId,
}) => {
  const m = useSettingsModel(true)
  const { areas, pagesOf } = useAreas(m)
  const [area, setArea] = useState<Area>("settings")
  useDeepLink(highlightId, Boolean(m.rows))
  return (
    <div className="space-y-6">
      <Toolbar
        m={m}
        showFilters={area === "settings"}
        leading={
          <TgSegmentedControl<Area>
            size="sm"
            aria-label="Area"
            value={area}
            onChange={setArea}
            options={areas.map((a) => ({
              value: a,
              label: a === "settings" ? "Settings" : AREA_LABEL[a],
            }))}
          />
        }
        below={
          area === "settings" ? undefined : (
            <span className="font-bold">
              {pagesOf(area).length} pages
              <span className="font-normal text-app-ink/50">
                {" "}
                · each opens in place
              </span>
            </span>
          )
        }
      />
      {area === "settings" ? (
        <>
          <Empty m={m} />
          <div className="columns-1 gap-6 xl:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
            {m.visible.map((g) => (
              <Panel key={g.group.id}>
                <PanelHeader
                  icon={GROUP_ICON[g.group.id] ?? Settings2}
                  title={g.group.label}
                  right={<Modified n={g.modified} />}
                />
                <GroupRows
                  g={g}
                  m={m}
                  highlightId={highlightId}
                  panels="sheet"
                />
              </Panel>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-6">
          {pagesOf(area).map((p) => (
            <PagePanel key={p.id} page={p} />
          ))}
        </div>
      )}
    </div>
  )
}

const SKINS: Record<
  Skin,
  { look: Look; body: React.FC<{ highlightId: string | null }> }
> = {
  panels: { look: "action", body: SkinPanels },
  rail: { look: "action", body: SkinRail },
  cards: { look: "compact", body: SkinCards },
}

export const AppSkin: React.FC<{ skin: Skin; highlightId: string | null }> = ({
  skin,
  highlightId,
}) => {
  const { look, body: Body } = SKINS[skin]
  return (
    <LookContext.Provider value={look}>
      <Body highlightId={highlightId} />
    </LookContext.Provider>
  )
}
