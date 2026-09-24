/**
 * The workspace shell's small decisions, with no React, so they can be tested.
 * `App` renders them.
 */
import type { Theme } from "@/components/theme-provider"
import type { Channel } from "@/types"

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
