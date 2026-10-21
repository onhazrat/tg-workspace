/**
 * Keyboard mode's one key list (ADR-034): every action, its key and its label
 * in each list's word. A letter means one action wherever that action exists,
 * so the controls carry the key named here (`shortcut`), and the corner list,
 * the full list and the tooltips all read it from here.
 */
import type { TabType } from "@/constants"

/** The lists keyboard mode moves through. KM-03 adds "discover" and "history". */
export type ListId = "posts" | "channels" | "directory"

export const ACTIONS = {
  tick: { key: "x", label: "tick or untick" },
  follow: { key: "f", label: "follow" },
  dismiss: { key: "d", label: "dismiss or take back" },
  tag: { key: "t", label: "tag" },
  open: { key: "o", label: "open in Telegram" },
  photo: { key: "p", label: "view the photo" },
  sync: { key: "s", label: "sync" },
  freeze: { key: "z", label: "freeze or unfreeze" },
  spotlight: { key: "c", label: "this Channel alone, and back" },
  copy: { key: "y", label: "copy link" },
  translate: { key: "l", label: "translate" },
  related: { key: "r", label: "find related" },
  more: { key: "m", label: "more or less" },
  star: { key: "*", label: "star or unstar" },
  note: { key: "n", label: "add or edit the note" },
} as const
export type Action = keyof typeof ACTIONS

/** Marks the control keyboard mode presses for `action`. */
export const shortcut = (action: Action) => ({
  "data-shortcut": ACTIONS[action].key,
})

/** A control's tooltip, naming its key while keyboard mode is on. */
export const withKey = (label: string, action: Action, on: boolean) =>
  on ? `${label} (${ACTIONS[action].key})` : label

/** `x` in each list's own word (CONTEXT.md): Tick, select, Pick. */
const TICK_LABEL: Record<ListId, string> = {
  directory: "tick or untick",
  channels: "select or deselect",
  posts: "pick or unpick",
}

type Row = readonly [keys: string, what: string]

/** Each list's moves and own keys, then its actions in the list's order. */
const LISTS: Record<ListId, { moves: Row[]; actions: Action[] }> = {
  posts: {
    moves: [
      ["j / k", "next / previous post"],
      ["gg / G", "first / last post"],
      ["- / +", "compact / full cards"],
      ["M", "more or less on every post"],
      ["Esc", "drop the highlight"],
    ],
    actions: [
      "tick",
      "spotlight",
      "translate",
      "related",
      "copy",
      "open",
      "photo",
      "more",
    ],
  },
  channels: {
    moves: [
      ["j / k", "next / previous channel"],
      ["gg / G", "first / last channel"],
      ["- / +", "smaller / larger cards"],
      ["Esc", "drop the highlight"],
    ],
    actions: [
      "tick",
      "sync",
      "tag",
      "freeze",
      "open",
      "more",
      "photo",
      "spotlight",
    ],
  },
  directory: {
    moves: [
      ["j / k", "next / previous channel"],
      ["gg / G", "first / last on the page"],
      ["] / [", "next / previous page"],
      ["Enter", "open or close the panel"],
      ["Esc", "drop the highlight and close the panel"],
    ],
    actions: ["tick", "follow", "dismiss", "open", "tag", "photo"],
  },
}

const SPOTLIGHT_LABEL: Partial<Record<ListId, string>> = {
  channels: "this Channel's posts, and c there comes back",
}

/** An action's label in a list's word. */
export function actionLabel(list: ListId, action: Action): string {
  if (action === "tick") return TICK_LABEL[list]
  if (action === "spotlight")
    return SPOTLIGHT_LABEL[list] ?? ACTIONS.spotlight.label
  return ACTIONS[action].label
}

const COUNTS: Row[] = [
  ["5j / 7k", "move by a count"],
  ["37G / 5gg", "go to the 37th / the 5th"],
]

/**
 * A list's keys for the corner and the full list: its moves, its actions
 * (only those in `carried`, when given, as a card size carries some), counts.
 */
export function listKeys(list: ListId, carried?: readonly Action[]): Row[] {
  const actions = LISTS[list].actions
    .filter((a) => !carried || carried.includes(a))
    .map((a): Row => [ACTIONS[a].key, actionLabel(list, a)])
  return [...LISTS[list].moves, ...actions, ...COUNTS]
}

/** `g` then one of these goes to that kind of tab, as the strip's go-to does. */
export const GO: Record<string, TabType> = {
  p: "posts",
  c: "channels",
  d: "directory",
  v: "discover",
  a: "action",
  s: "summary",
  // l for label: t is the strip's next tab, as in vim.
  l: "tag",
  m: "chat",
  h: "history",
  o: "tools",
  ",": "settings",
}

const TAB_NAMES: Record<TabType, string> = {
  posts: "Posts",
  channels: "Channels",
  directory: "Directory",
  discover: "Discover",
  action: "Action",
  summary: "Summary",
  tag: "Tag",
  chat: "Chat",
  history: "History",
  tools: "Tools",
  settings: "Settings",
}

/** The strip's own keys after `g`. */
const STRIP: Row[] = [
  ["t", "next tab (3gt: the third tab)"],
  ["T", "previous tab (5gT: five back)"],
  ["x", "close this tab (not Channels, Posts or Action)"],
  ["X", "reopen the tab closed last"],
]

/** What a waiting `g` leads to, one key and its meaning a row. */
export const afterG = (): Row[] => [
  ...STRIP,
  ...Object.entries(GO).map(([key, kind]): Row => [key, TAB_NAMES[kind]]),
]

/** What a typed count leads to, with or without its `g` yet. */
export const afterCount = (count: string, g: boolean): Row[] =>
  g
    ? [
        ["t", `tab ${count}`],
        ["T", `${count} tabs back`],
      ]
    : [
        ["j / k", `move ${count}`],
        ["G / gg", `go to number ${count}`],
        ["gt", `tab ${count}`],
        ["gT", `${count} tabs back`],
      ]

/** The keys that work on every tab in keyboard mode, for the full list. */
export const WORKSPACE_KEYS: Row[] = [
  ["\\", "keyboard mode on or off"],
  ["?", "the keys: in the corner, all of them, or none"],
  ["/", "search this tab"],
  ["Esc", "in a field: back to the keys"],
]

/** The go-to keys for the full list, `g` spelled out. */
export const goKeys = (): Row[] =>
  afterG().map(([key, what]): Row => [`g${key}`, what])
