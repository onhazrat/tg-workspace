/**
 * PROTOTYPE, throw away. The photo viewer from the Directory and one keyboard
 * mode, switchable via `?variant=` and the floating bar:
 *   0  main as it is: no viewer
 *   B  the Directory's avatars open the photo viewer (`view="image"`), in
 *      the rows and the panel; p views the highlighted row's photo and closes
 *      the viewer, h / l step photos as the arrows do. Keyboard mode is one
 *      switch for Posts, Channels and the Directory, and unified (`keys.ts`):
 *      a letter means one thing in every tab, \ turns keyboard mode on and
 *      off, ? steps through the tab's keys in the corner and the full list,
 *      - / + resize cards, c toggles a Channel's spotlight in Posts, and each
 *      tab keeps its highlight across a tab switch
 *   C  B, and: / searches the tab, Esc in a field gives the keys back, g p /
 *      g c / g d go to Posts / Channels / Directory, c on a Channels card
 *      opens its posts (c again comes back), J / K select while moving, and
 *      a selected item looks the same in every tab
 *   D  C, and Discover gets keyboard mode on the Directory's terms, and
 *      g + a letter, \ and ? work from every tab
 *   E  D, and History gets keyboard mode: j / k, Enter opens, * stars,
 *      n edits the note, / searches; delete stays on the mouse
 *   F  E, and (`fkeys.ts`): counts for moves (5j, 7k, 37G), a pop-up of
 *      where g goes, J / K and F / D following the last x, F / D acting on
 *      everything selected, a toast with Undo for x d *, Esc clears the
 *      Posts highlight, and the highlight is announced to screen readers
 *   H, J  F, with the g pop-up placed elsewhere: H as the corner key list
 *      does, stacked above it; J badges on the tab strip itself (G, top
 *      centre, and I, a bottom strip, were dropped)
 * The panel's photo is a gallery of its own, so the arrows step through the
 * page's rows only. Dropped along the way: a magnifier at the avatar's corner,
 * and A, B's photo viewer without the unified keys.
 */
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useSyncExternalStore } from "react"
import { useSessionFlag } from "@/hooks/useSessionFlag"
import { keyBelongsElsewhere } from "@/lib/keyboard-moves"
import { scopedSessionStorage } from "@/lib/storage/scoped"

const VARIANTS = [
  { key: "0", name: "main, no viewer" },
  { key: "B", name: "photo viewer + one set of keys" },
  { key: "C", name: "B + search, go-to and J / K" },
  { key: "D", name: "C + Discover, go-to from every tab" },
  { key: "E", name: "D + History" },
  { key: "F", name: "E + counts, g pop-up, bulk keys" },
  // F with its g pop-up elsewhere; each is F and nothing more.
  { key: "H", name: "F, g pop-up in the corner" },
  { key: "J", name: "F, g keys on the tab strip" },
] as const
export type Variant = (typeof VARIANTS)[number]["key"]

const fromUrl = new URLSearchParams(window.location.search).get("variant")
// A module variable, because the router drops a search parameter it does not
// know when a tab changes.
let current: Variant = VARIANTS.some((v) => v.key === fromUrl)
  ? (fromUrl as Variant)
  : "0"
const listeners = new Set<() => void>()

// The variant on the root too, for the CSS of C's one selected look.
document.documentElement.dataset.variant = current

function set(next: Variant) {
  current = next
  document.documentElement.dataset.variant = next
  const url = new URL(window.location.href)
  url.searchParams.set("variant", next)
  window.history.replaceState(window.history.state, "", url)
  for (const l of listeners) l()
}

// The shared keyboard mode, a store so the workspace (?, the corner list)
// reads the same switch as the tab. Read lazily: the session's Account is
// known only after sign-in.
let keyboard: boolean | null = null
const keyboardListeners = new Set<() => void>()
export const keyboardNow = () =>
  (keyboard ??= scopedSessionStorage.getItem("keyboard") === "1")
export function setKeyboardMode(on: boolean) {
  keyboard = on
  scopedSessionStorage.setItem("keyboard", on ? "1" : "0")
  for (const l of keyboardListeners) l()
}
export const useSharedKeyboard = () =>
  useSyncExternalStore((l) => {
    keyboardListeners.add(l)
    return () => keyboardListeners.delete(l)
  }, keyboardNow)

/**
 * Keyboard mode: in A one switch for Posts, Channels and the Directory, so
 * turning it on in one tab turns it on in all three; in 0 each tab's own.
 */
export function useKeyboardMode(
  tabKey: string,
): [boolean, (on: boolean) => void] {
  const own = useSessionFlag(tabKey)
  const on = useSharedKeyboard()
  const shared: [boolean, (on: boolean) => void] = [on, setKeyboardMode]
  const variant = useVariant()
  const setOn = setKeyboardMode
  // B: \ turns it on and off.
  useEffect(() => {
    if (variant === "0") return
    const onKey = (e: KeyboardEvent) => {
      // Also with the shortcuts list open, the one dialog it may close.
      const onlyShortcuts =
        document.querySelectorAll('[role="dialog"]').length === 1 &&
        document.querySelector("[data-shortcuts-dialog]")
      if (e.key !== "\\" || (keyBelongsElsewhere(e) && !onlyShortcuts)) return
      e.preventDefault()
      setOn(!on)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  return variant !== "0" ? shared : own
}

/** Whether `variant` has everything `from` has: each variant builds on the last. */
const ORDER: readonly string[] = VARIANTS.map((v) => v.key)
export const since = (variant: Variant, from: Variant) =>
  ORDER.indexOf(variant) >= ORDER.indexOf(from)

/** The variant now, for code outside React. */
export const variantNow = (): Variant => current

export function useVariant(): Variant {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

export function PrototypeSwitcher() {
  const variant = useVariant()
  const index = VARIANTS.findIndex((v) => v.key === variant)
  const go = (step: number) =>
    set(VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length].key)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The photo viewer owns the arrows while it is open.
      if (keyBelongsElsewhere(e)) return
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  if (!import.meta.env.DEV) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-600 px-2 py-1 text-xs font-bold text-white shadow-xl">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="min-w-48 text-center">
        {variant} ({VARIANTS[index].name})
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/20"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
