/**
 * PROTOTYPE (variant B), throw away. One list of keyboard mode's keys for
 * Posts, Channels and the Directory, so a letter means one thing in every
 * tab. Prototype shortcut: the controls keep the letters they carry today
 * (`data-shortcut`), and each tab's keyboard translates a pressed key to its
 * control's letter through `controlKey`. The real change would put the list's
 * letter on the control and delete the translation.
 */
import { useEffect, useRef, useSyncExternalStore } from "react"
import {
  focusIsTyping,
  GG_MS,
  keyBelongsElsewhere,
  MODIFIERS,
} from "@/lib/keyboard-moves"
import {
  clearCount,
  ensureSelection,
  gLive,
  gPendingNow,
  isF,
  prefixKey,
  setGPending,
  takeCount,
} from "./fkeys"
import { keyboardNow, setKeyboardMode, since, variantNow } from "./variant"

export type KeyTab = "posts" | "channels" | "directory" | "discover" | "history"

const ACTIONS = {
  select: { key: "x", label: "select or deselect" },
  open: { key: "o", label: "open in Telegram" },
  photo: { key: "p", label: "view photo" },
  follow: { key: "f", label: "follow" },
  tag: { key: "t", label: "tag" },
  dismiss: { key: "d", label: "dismiss or take back" },
  sync: { key: "s", label: "sync" },
  bio: { key: "b", label: "more or less bio" },
  freeze: { key: "z", label: "freeze or unfreeze" },
  channel: { key: "c", label: "this channel alone, or back to the feed" },
  copy: { key: "y", label: "copy link" },
  translate: { key: "l", label: "translate" },
  related: { key: "r", label: "find related" },
  // E: History's.
  star: { key: "*", label: "star or unstar" },
  note: { key: "n", label: "add or edit the note" },
  // F: one "more or less", a post's text and a Channel's bio alike.
  more: { key: "m", label: "more or less" },
} as const
type Action = keyof typeof ACTIONS

/** Each tab's actions, and the letter their controls carry today. */
const CONTROLS: Record<KeyTab, Partial<Record<Action, string>>> = {
  posts: {
    channel: "f",
    translate: "t",
    copy: "c",
    related: "r",
    photo: "p",
    open: "o",
    select: "x",
  },
  channels: {
    select: "x",
    sync: "s",
    tag: "t",
    freeze: "f",
    open: "o",
    bio: "b",
    photo: "p",
  },
  directory: {
    select: "x",
    follow: "f",
    dismiss: "d",
    open: "o",
    tag: "t",
    photo: "p",
  },
  // E: delete stays on the mouse; one wrong key would lose an artifact.
  history: {
    star: "*",
    note: "n",
  },
  // D: the Directory's letters, on Discover's controls.
  discover: {
    select: "x",
    follow: "f",
    dismiss: "d",
    open: "o",
  },
}

/**
 * The tab's controls in the variant shown. F: a Channel's bio is "more or
 * less" on m, and so is a post's text, so bio leaves b.
 */
function controls(tab: KeyTab): Partial<Record<Action, string>> {
  if (!isF()) return CONTROLS[tab]
  if (tab === "posts") return { ...CONTROLS.posts, more: "m" }
  if (tab === "channels") {
    const { bio, ...rest } = CONTROLS.channels
    return { ...rest, more: bio }
  }
  return CONTROLS[tab]
}

const MOVES: Record<KeyTab, [string, string][]> = {
  history: [
    ["j / k", "next / previous item"],
    ["gg / G", "first / last item"],
    ["Enter", "open it"],
    ["Esc", "drop the highlight"],
  ],
  discover: [
    ["j / k", "next / previous candidate"],
    ["gg / G", "first / last candidate"],
    ["Enter", "details"],
    ["Esc", "drop the highlight"],
  ],
  posts: [
    ["j / k", "next / previous post"],
    ["gg / G", "first / last post"],
    ["- / +", "compact / full cards"],
  ],
  channels: [
    ["j / k", "next / previous channel"],
    ["gg / G", "first / last channel"],
    ["- / +", "smaller / larger cards"],
    ["Esc", "drop the highlight"],
  ],
  directory: [
    ["j / k", "next / previous channel"],
    ["gg / G", "first / last on the page"],
    ["] / [", "next / previous page"],
    ["Enter", "open or close the panel"],
    ["Esc", "drop the highlight and close the panel"],
  ],
}

const EVERYWHERE: [string, string][] = [
  ["\\", "keyboard mode on or off"],
  ["?", "show or hide these keys"],
]

/**
 * The `data-shortcut` a pressed key presses on this tab: in B the list's
 * action for the key, or nothing; in 0 and A the key itself.
 */
export function controlKey(tab: KeyTab, key: string): string | null {
  if (variantNow() === "0") return key
  const action = (Object.keys(ACTIONS) as Action[]).find(
    (a) => ACTIONS[a].key === key,
  )
  return action ? (controls(tab)[action] ?? null) : null
}

/**
 * The list's letter for the control that carries `letter` on this tab, for
 * its tooltip: in B the list's, in 0 and A the letter itself.
 */
export function keyFor(tab: KeyTab, letter: string): string {
  if (variantNow() === "0") return letter
  const action = (Object.keys(controls(tab)) as Action[]).find(
    (a) => controls(tab)[a] === letter,
  )
  return action ? ACTIONS[action].key : letter
}

/**
 * A tab's keys for the `?` dialog: its moves, its actions (only those whose
 * control is in `carried`, when given, as a card size carries some), then the
 * keys that work everywhere.
 */
export function tabKeys(
  tab: KeyTab,
  carried?: readonly string[],
): [string, string][] {
  const actions = (Object.keys(controls(tab)) as Action[])
    .filter((a) => !carried || carried.includes(controls(tab)[a] ?? ""))
    .map((a): [string, string] => [ACTIONS[a].key, ACTIONS[a].label])
  return [...MOVES[tab], ...actions, ...EVERYWHERE, ...cKeys(tab)]
}

/** The tab the workspace shows, as the key list knows it. */
export function keyTabOf(activeTab: string): KeyTab | null {
  if (activeTab === "discover")
    return since(variantNow(), "D") ? "discover" : null
  if (activeTab === "history")
    return since(variantNow(), "E") ? "history" : null
  return activeTab === "posts" ||
    activeTab === "channels" ||
    activeTab === "directory"
    ? activeTab
    : null
}

/**
 * Each tab's last highlight, kept across a tab switch: only one tab is
 * mounted at a time, so it lives here and not in the tab.
 */
export const lastRing: Partial<Record<KeyTab, string>> = {}

/**
 * B: a tab's highlight (`ring`) comes back when the tab mounts again, once its
 * item is on screen (`items`); `onRestore` scrolls to it.
 */
export function useKeptRing(
  tab: KeyTab,
  on: boolean,
  ring: string | null,
  setRing: (ring: string) => void,
  items: readonly string[],
  onRestore?: (at: number) => void,
) {
  const restored = useRef(false)
  useEffect(() => {
    if (!on || restored.current || variantNow() === "0") return
    const last = lastRing[tab]
    const at = last ? items.indexOf(last) : -1
    if (!last || at < 0) return
    restored.current = true
    setRing(last)
    onRestore?.(at)
  })
  useEffect(() => {
    if (variantNow() === "0") return
    if (ring) restored.current = true
    if (restored.current) lastRing[tab] = ring ?? undefined
  }, [tab, ring])
}

/**
 * B: what ? shows in keyboard mode. It steps closed → the tab's keys in the
 * corner → the full list → closed, skipping the corner where it would show
 * nothing (a tab without keyboard mode, or a phone, where the corner list is
 * hidden). Keyboard mode off hides it, and on again shows it as it was. With
 * keyboard mode off, ? opens and closes the full list on its own (`adhoc`),
 * leaving the state for later.
 */
export type HelpState = "closed" | "corner" | "full"
export function nextHelp(state: HelpState, canCorner: boolean): HelpState {
  if (state === "closed") return canCorner ? "corner" : "full"
  if (state === "corner") return "full"
  return "closed"
}
export const canCorner = (activeTab: string) =>
  keyTabOf(activeTab) !== null &&
  window.matchMedia("(min-width: 768px)").matches

let help: HelpState = "closed"
let adhoc = false
const helpListeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  helpListeners.add(l)
  return () => helpListeners.delete(l)
}
const notify = () => {
  for (const l of helpListeners) l()
}
export const helpNow = () => help
export const adhocNow = () => adhoc
export function setHelp(next: HelpState) {
  help = next
  notify()
}
export function setAdhoc(on: boolean) {
  adhoc = on
  notify()
}
export const useHelp = () => useSyncExternalStore(subscribe, helpNow)
/**
 * One step of ?, and of the header's shortcuts button: in keyboard mode
 * closed → corner → full → closed; out of it, the full list on and off.
 */
export function stepHelp(activeTab: string) {
  if (!keyboardNow()) return setAdhoc(!adhoc)
  setHelp(nextHelp(help, canCorner(activeTab)))
}
export const useAdhoc = () => useSyncExternalStore(subscribe, adhocNow)

/** The letters each tab's cards carry now (a Channels card size carries some). */
export const carried: Partial<Record<KeyTab, readonly string[]>> = {}

// ---- C: the keys B lacks ----

/** Each tab's search box, which / jumps to. */
const SEARCH: Record<KeyTab, string> = {
  posts:
    'input[aria-label="Keyword search"], input[aria-label="Meaning search"]',
  channels: 'input[placeholder="Search channels..."]',
  discover: 'input[placeholder="Filter by name…"]',
  history: 'input[placeholder="Search channels, titles, notes"]',
  directory: '[data-testid="directory-search"]',
}

/** C's rows in the key list, after the tab's own. */
const C_KEYS: Record<KeyTab, [string, string][]> = {
  posts: [["J / K", "select while moving down / up"]],
  channels: [
    ["J / K", "select while moving down / up"],
    ["c", "this channel's posts, and c again to come back"],
  ],
  directory: [["J / K", "tick while moving down / up"]],
  discover: [["J / K", "select while moving down / up"]],
  history: [],
}
const C_EVERYWHERE: [string, string][] = [
  ["/", "search this tab"],
  ["Esc", "in a field: back to the keys"],
]
/** F's rows: counts, the bulk capitals, and Posts' Esc. */
const fKeys = (tab: KeyTab): [string, string][] =>
  isF()
    ? [
        ["5j / 7k", "move by a count"],
        ["37G", "go to the 37th"],
        ...(tab === "posts"
          ? ([
              ["M", "more or less on every post"],
              ["Esc", "drop the highlight"],
            ] as [string, string][])
          : []),
        ...(tab === "directory" || tab === "discover"
          ? ([
              ["F", "follow everything ticked"],
              ["D", "dismiss everything ticked"],
            ] as [string, string][])
          : []),
      ]
    : []
export const cKeys = (tab: KeyTab): [string, string][] =>
  since(variantNow(), "C")
    ? [
        // F: J / K follow the last x.
        ...C_KEYS[tab].map(([k, what]): [string, string] =>
          isF() && k === "J / K"
            ? [k, "move, selecting or deselecting as the last x did"]
            : [k, what],
        ),
        ...fKeys(tab),
        ...C_EVERYWHERE,
        goRow(),
      ]
    : []

/** The workspace's tab strip, which `App` hands over. */
export type TabOps = {
  /** Go to a kind of tab: its most recent one, or a new one. */
  go: (kind: string) => void
  /** D: the next (1) or previous (-1) tab in the strip, wrapping. */
  step: (by: number) => void
  /** F: the tab at this place in the strip, 0 first; none past the end. */
  goToIndex: (index: number) => void
  /** D: close the active tab, if it is closable. */
  close: () => void
  /** D: reopen the tab closed last. */
  reopen: () => void
}
let tabOps: TabOps = {
  go: () => {},
  step: () => {},
  goToIndex: () => {},
  close: () => {},
  reopen: () => {},
}
export const setTabOps = (ops: TabOps) => {
  tabOps = ops
}
const goTab = (kind: string) => tabOps.go(kind)

/** g then a letter: the tab it goes to, and its name for the key list. */
const GO_C: Record<string, [string, string]> = {
  p: ["posts", "Posts"],
  c: ["channels", "Channels"],
  d: ["directory", "Directory"],
}
// D: every tab.
const GO_D: Record<string, [string, string]> = {
  ...GO_C,
  v: ["discover", "Discover"],
  a: ["action", "Action"],
  s: ["summary", "Summary"],
  // l for label: t is the strip's next tab, as in vim.
  l: ["tag", "Tag"],
  m: ["chat", "Chat"],
  h: ["history", "History"],
  o: ["tools", "Tools"],
  ",": ["settings", "Settings"],
}
const goMap = () => (since(variantNow(), "D") ? GO_D : GO_C)
const goRow = (): [string, string] =>
  since(variantNow(), "D")
    ? ["g + letter", "go to a tab; gt / gT next / previous, gx close"]
    : ["g p / g c / g d", "go to Posts / Channels / Directory"]
/** D: g then these work the strip itself rather than going to a kind. */
// F: t and T take a count, before the g or after it, as vim's do: 3gt goes
// to the third tab, 5gT five tabs back.
const STRIP: Record<string, [(n: number | null) => void, string]> = {
  t: [
    (n) => (n ? tabOps.goToIndex(n - 1) : tabOps.step(1)),
    "next tab (3gt: the third tab)",
  ],
  T: [(n) => tabOps.step(-(n ?? 1)), "previous tab (5gT: five back)"],
  x: [() => tabOps.close(), "close this tab (not Channels, Posts or Action)"],
  X: [() => tabOps.reopen(), "reopen the tab closed last"],
}
/** J: the g letter each kind of tab answers to. */
export const goLetterOf = (kind: string): string | undefined =>
  Object.entries(GO_D).find(([, [k]]) => k === kind)?.[0]
/** J: the strip's own g keys (t T x X), for the box beside the strip. */
export const stripKeys = (): [string, string][] =>
  Object.entries(STRIP).map(([letter, [, what]]) => [letter, what])

/** D: the go-to keys, for the full list's own section. */
export const goKeys = (): [string, string][] => [
  ...Object.entries(STRIP).map(([letter, [, what]]): [string, string] => [
    `g${letter}`,
    what[0].toUpperCase() + what.slice(1),
  ]),
  ...Object.entries(GO_D).map(([letter, [, name]]): [string, string] => [
    `g ${letter}`,
    name,
  ]),
]

/**
 * g then a letter goes to that tab. Each tab's keyboard asks before reading
 * the key as a move or a letter, since its g also starts gg.
 */
export function goAfterG(key: string, lastG: number): boolean {
  if (!since(variantNow(), "C") || !gLive(lastG, Date.now(), GG_MS))
    return false
  // Only a key this answers closes the pending g here: a second g is gg's
  // (readMove's), and a Shift is the start of gT.
  const strip = since(variantNow(), "D") ? STRIP[key] : undefined
  if (strip) {
    setGPending(false)
    strip[0](takeCount())
    return true
  }
  const go = goMap()[key]
  if (!go) return false
  setGPending(false)
  clearCount()
  goTab(go[0])
  return true
}

// Channels' c: the Channel's spotlight in Posts, and c there comes back.
let pendingSpotlight: string | null = null
let spotlightFromChannels = false
export function openSpotlightFromChannels(name: string) {
  pendingSpotlight = name
  spotlightFromChannels = true
  goTab("posts")
}
export function takePendingSpotlight(): string | null {
  const name = pendingSpotlight
  pendingSpotlight = null
  return name
}
/** In a spotlight Channels opened: back to Channels. False otherwise. */
export function backToChannels(): boolean {
  if (!since(variantNow(), "C") || !spotlightFromChannels) return false
  spotlightFromChannels = false
  goTab("channels")
  return true
}
export const forgetSpotlightOrigin = () => {
  spotlightFromChannels = false
}

/** J and K: the item moved from and to gets selected (ticked) if it is not. */
export function ensureSelected(item: Element | null | undefined) {
  // F: the last x's direction, selecting or deselecting.
  if (isF()) return ensureSelection(item)
  const control = item?.querySelector<HTMLElement>('[data-shortcut="x"]')
  if (!control) return
  const on =
    control instanceof HTMLInputElement
      ? control.checked
      : control.getAttribute("aria-pressed") === "true"
  if (!on) control.click()
}
/** J / K read as j / k, and whether they extend the selection. */
export function readExtend(key: string): { key: string; extend: boolean } {
  const extend = since(variantNow(), "C") && (key === "J" || key === "K")
  return { key: extend ? key.toLowerCase() : key, extend }
}

/**
 * C, in keyboard mode: / focuses the tab's search box, and Esc in a field
 * leaves it, so the keys work again. Bound by `App`, which is always there.
 */
export function useWorkspaceKeys(activeTab: string) {
  // D: on a tab without keyboard mode of its own, \ and g + a letter are
  // here; the tabs with one handle them in their own keyboard.
  const lastG = useRef(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        since(variantNow(), "D") &&
        !keyTabOf(activeTab) &&
        !keyBelongsElsewhere(e)
      ) {
        if (e.key === "\\") {
          e.preventDefault()
          setKeyboardMode(!keyboardNow())
          return
        }
        if (keyboardNow()) {
          // F: Esc cancels a pending g.
          if (e.key === "Escape" && gPendingNow()) {
            lastG.current = 0
            setGPending(false)
            e.preventDefault()
            return
          }
          // F: a count, before the g or after it (5gT, g5T), for t / T.
          if (/^[0-9]$/.test(e.key) && prefixKey(e, lastG)) return
          if (goAfterG(e.key, lastG.current)) {
            lastG.current = 0
            e.preventDefault()
            return
          }
          // gg: no list here to go to the top of, so it just cancels.
          if (e.key === "g" && gPendingNow()) {
            lastG.current = 0
            setGPending(false)
            clearCount()
            e.preventDefault()
            return
          }
          // A modifier's own keydown (the Shift of g then T) keeps it.
          if (!MODIFIERS.has(e.key)) {
            lastG.current = e.key === "g" ? Date.now() : 0
            setGPending(e.key === "g")
            // A count waits only for its g.
            if (e.key !== "g") clearCount()
          }
        }
      }
      if (!since(variantNow(), "C") || !keyboardNow()) return
      if (document.querySelector('[role="dialog"]')) return
      const typing = focusIsTyping()
      if (e.key === "Escape" && typing) {
        ;(document.activeElement as HTMLElement | null)?.blur()
        // The tabs' Esc (drop the highlight) skips a key claimed already.
        e.preventDefault()
        return
      }
      if (e.key !== "/" || typing || e.metaKey || e.ctrlKey || e.altKey) return
      const tab = keyTabOf(activeTab)
      const box = tab && document.querySelector<HTMLInputElement>(SEARCH[tab])
      if (!box) return
      e.preventDefault()
      box.focus()
      box.select()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeTab])
}
