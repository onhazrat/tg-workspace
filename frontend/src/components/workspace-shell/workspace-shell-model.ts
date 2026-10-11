/**
 * The workspace shell's small decisions, with no React, so they can be tested.
 * `App` renders them.
 */
import type { Announcements, UniqueIdentifier } from "@dnd-kit/core"
import { artifactChannelsLine } from "@/components/history/artifact-presentation"
import type { Theme } from "@/components/theme-provider"
import { WORKSPACE_TABS } from "@/constants"
import { isFixed, sameTab, type Tab, tabKey } from "@/lib/workspace-tabs"
import type { ArtifactListItem, Channel, TabType } from "@/types"

/** What the theme button says: the current mode and where a click goes next. */
export const THEME_TOOLTIPS: Record<Theme, string> = {
  system: "System theme (follows OS) — click for Light",
  light: "Switch to Dark Mode",
  dark: "Switch to System Mode",
}

/** How traffic leaves: Tor wins over a proxy, and neither is direct. */
export function routingMode(settings: {
  torEnabled: boolean
  proxyEnabled: boolean
}): { label: string; dotClass: string } {
  if (settings.torEnabled) return { label: "Tor", dotClass: "bg-green-500" }
  if (settings.proxyEnabled)
    return { label: "Proxy", dotClass: "bg-purple-500" }
  return { label: "Direct", dotClass: "bg-blue-500" }
}

/**
 * The oldest last-sync among selected, unfrozen channels, or null when none
 * are selected. The header shows the stalest one because that is the one a
 * summary would be missing posts from.
 */
export function oldestSync(
  channels: Channel[],
  selected: ReadonlySet<string>,
): number | null {
  const times = channels
    .filter((c) => selected.has(c.name) && !c.isFrozen)
    .map((c) => c.lastUpdated || 0)
  return times.length === 0 ? null : Math.min(...times)
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

/** Whether a keypress is the bare `?` that opens the shortcuts list, and not typing. */
export function opensShortcuts(event: {
  key: string
  defaultPrevented: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  target: EventTarget | null
}): boolean {
  if (event.key !== "?" || event.defaultPrevented) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  return !target.isContentEditable && !EDITABLE_TAGS.has(target.tagName)
}

/** The modifier the platform names: Cmd on Apple, Ctrl everywhere else. */
export const commandKeyFor = (platform: string | undefined): "Cmd" | "Ctrl" =>
  platform && /(Mac|iPhone|iPad|iPod)/i.test(platform) ? "Cmd" : "Ctrl"

/**
 * Grouped because four of these are not global.
 *
 * `Enter`, `{cmd}+Enter`, `Esc` and `Backspace` are handled by the command
 * palette and do nothing anywhere else, but the flat list presented all six
 * alike — so "Run Highlighted Command / Enter" read as an app-wide binding
 * that silently did nothing.
 *
 * Only two shortcuts are genuinely global: the palette (`useCommandPalette`)
 * and this dialog (`App`). The list is short because the app is, not because
 * the list is incomplete.
 */
export function shortcutGroups(commandKey: string) {
  return [
    {
      heading: "Anywhere",
      bindings: [
        { label: "Command Palette", keys: `${commandKey}+Shift+P` },
        { label: "Keyboard Shortcuts", keys: "?" },
      ],
    },
    {
      heading: "In the command palette",
      bindings: [
        { label: "Run Highlighted Command", keys: "Enter" },
        { label: "Alternate Run Command", keys: `${commandKey}+Enter` },
        { label: "Back / Close Sub-View", keys: "Esc" },
        { label: "Parent Sub-View", keys: "Backspace (empty)" },
      ],
    },
  ]
}

/**
 * What a workspace tab says (TABS-01): its kind, or a short name for the
 * Artifact it holds, so five Summary tabs are told apart. The scope and date
 * for most kinds, the first question for a Chat.
 */
export function tabLabel(
  kindLabel: string,
  artifact: ArtifactListItem | undefined,
): string {
  if (!artifact) return kindLabel
  if (artifact.kind === "chat" && artifact.title) return artifact.title
  const date = new Date(artifact.timestamp ?? 0).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  return `${artifactChannelsLine(artifact)} · ${date}`
}

const TAB_META = Object.fromEntries(
  WORKSPACE_TABS.map((tab) => [tab.id, tab]),
) as Record<TabType, (typeof WORKSPACE_TABS)[number]>

/** Everything the strip decides about one tab, so `App` only renders it. */
export function tabPresentation(
  tab: Tab,
  index: number,
  all: readonly Tab[],
  active: Tab,
  artifact: ArtifactListItem | undefined,
) {
  const meta = TAB_META[tab.kind]
  const isActive = sameTab(tab, active)
  const closable = !isFixed(tab.kind)
  return {
    key: tabKey(tab),
    meta,
    label: tabLabel(meta.label, artifact),
    ariaCurrent: isActive ? ("page" as const) : undefined,
    closable,
    // A Closable tab shrinks, down to icon width, before the strip scrolls
    // (TABS-02). It is a size container so its × can tell it has shrunk, and
    // a size container has no content width, hence the explicit one.
    itemClass: closable ? "@container w-40 min-w-6" : "shrink-0",
    // The tour and the specs address the first tab of a kind.
    anchorId:
      all.findIndex((t) => t.kind === tab.kind) === index
        ? `tour-tab-${tab.kind}`
        : undefined,
    linkClass: isActive
      ? "border-app-ink opacity-100"
      : "border-transparent opacity-40",
    // Shrunk to icon width, an inactive tab shows no × at all: there it
    // would be the whole tab, and a click meant to switch to it would close it.
    closeClass: isActive
      ? "opacity-70"
      : "opacity-0 group-hover:opacity-70 @max-[4.5rem]:hidden",
  }
}

/**
 * What a screen reader hears while a tab is dragged (TABS-02): the tabs'
 * labels, where dnd-kit's defaults would read out their internal keys.
 */
export function tabAnnouncements(
  labelOf: (id: UniqueIdentifier) => string,
): Announcements {
  const place = (over: { id: UniqueIdentifier } | null) =>
    over ? ` beside ${labelOf(over.id)}` : ""
  return {
    onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      `${labelOf(active.id)} moved${place(over)}.`,
    onDragEnd: ({ active, over }) =>
      `${labelOf(active.id)} dropped${place(over)}.`,
    onDragCancel: ({ active }) => `Moving ${labelOf(active.id)} was cancelled.`,
  }
}

/**
 * Is the Summary being generated the one this tab holds?
 *
 * The run puts no id in the URL until it finishes, so the tab it fills is the
 * new-Summary tab (no id). Another Summary's tab, and every other kind, keeps
 * its own content.
 */
export function generatesOnTab(state: {
  summarizing: boolean
  activeTab: TabType
  summaryId: string | null
}): boolean {
  return (
    state.summarizing &&
    state.activeTab === "summary" &&
    state.summaryId === null
  )
}
