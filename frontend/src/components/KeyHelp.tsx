import type React from "react"
import { useEffect, useState } from "react"
import {
  clearCount,
  setGPending,
  useCount,
  useGPending,
} from "@/components/directory-photo-prototype/fkeys"
import {
  carried,
  goKeys,
  goLetterOf,
  keyTabOf,
  stripKeys,
  tabKeys,
  useHelp,
} from "@/components/directory-photo-prototype/keys"
import {
  since,
  useSharedKeyboard,
  useVariant,
} from "@/components/directory-photo-prototype/variant"

type Rows = readonly (readonly [key: string, what: string])[]

/** The key legend in the corner while keyboard mode is on, on either tab. */
export function KeyHelp({ rows }: { rows: Rows }) {
  // PROTOTYPE (B): ? shows the keys (`CornerKeys`); the corner only says so.
  const variant = useVariant()
  const corner = useHelp() === "corner"
  if (variant !== "0")
    return corner ? null : (
      <div
        data-corner-hint
        className="fixed bottom-4 left-4 z-50 hidden rounded-full border border-app-ink/10 bg-app-card/95 px-3 py-1 font-mono text-[11px] text-app-ink/60 shadow-lg backdrop-blur md:block"
      >
        keyboard mode · <kbd className="text-app-ink">?</kbd> keys ·{" "}
        <kbd className="text-app-ink">\</kbd> off
      </div>
    )
  return <KeyList rows={rows} />
}

function KeyList({ rows }: { rows: Rows }) {
  const box =
    "fixed bottom-4 left-4 z-50 hidden rounded-xl border border-app-ink/10 bg-app-card/95 p-3 text-[11px] shadow-lg backdrop-blur md:block"
  // PROTOTYPE (C): its keys run longer (g p / g c / g d), so a grid keeps
  // the descriptions in one column.
  if (since(useVariant(), "C"))
    return (
      <div
        data-corner-hint
        className={`${box.replace("md:block", "md:grid")} grid-cols-[max-content_1fr] gap-x-3`}
      >
        {rows.map(([key, what]) => (
          <div key={`${key} ${what}`} className="contents">
            <kbd className="whitespace-nowrap font-mono text-app-ink">
              {key}
            </kbd>
            <span className="text-app-ink/60">{what}</span>
          </div>
        ))}
      </div>
    )
  return (
    <div className={box}>
      {rows.map(([key, what]) => (
        <div key={key} className="flex gap-3">
          <kbd className="w-10 font-mono text-app-ink">{key}</kbd>
          <span className="text-app-ink/60">{what}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * PROTOTYPE (B): the tab's keys in the corner, ?'s middle step. Hidden while
 * keyboard mode is off, and back when it is on again.
 */
export function CornerKeys({ tab }: { tab: string }) {
  const variant = useVariant()
  const corner = useHelp() === "corner"
  const keyboard = useSharedKeyboard()
  const keyTab = keyTabOf(tab)
  if (variant === "0" || !corner || !keyboard || !keyTab) return null
  return <KeyList rows={tabKeys(keyTab, carried[keyTab])} />
}

/**
 * PROTOTYPE (F): where g goes, shown while a g waits for its letter (after a
 * moment, so a quick gt never flashes it), and the count being typed. A click
 * anywhere drops both.
 */
export function GoPopup() {
  const pending = useGPending()
  const count = useCount()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!pending) return setShown(false)
    const timer = window.setTimeout(() => setShown(true), 300)
    return () => window.clearTimeout(timer)
  }, [pending])
  useEffect(() => {
    if (!pending && !count) return
    const drop = () => {
      setGPending(false)
      clearCount()
    }
    window.addEventListener("pointerdown", drop)
    return () => window.removeEventListener("pointerdown", drop)
  }, [pending, count])
  const variant = useVariant()
  if (!since(variant, "F")) return null
  if (variant === "H") return <CornerGoKeys pending={pending && shown} />
  // PROTOTYPE (J): where the pop-up goes.
  const surface =
    "z-50 hidden border border-app-ink/10 bg-app-card/95 p-3 font-mono text-[11px] shadow-lg backdrop-blur md:block"
  const box = `${surface} ${variant === "J" ? "fixed rounded-xl" : "fixed bottom-16 left-1/2 -translate-x-1/2 rounded-xl"}`
  // J: just under the tab bar, wherever the header puts it.
  const bar = document
    .querySelector('nav[aria-label="Workspace sections"]')
    ?.closest(".border-b")
    ?.getBoundingClientRect()
  const under =
    variant === "J"
      ? { top: (bar?.bottom ?? 180) + 8, left: (bar?.left ?? 40) + 16 }
      : undefined
  if (variant === "J" && pending && shown && !count)
    return <TabBadges box={box} style={under} />
  if (count)
    return (
      <div className={box} style={under} role="status">
        <kbd className="text-app-ink">{pending ? `g ${count}` : count}</kbd>
        <span className="text-app-ink/60">
          {pending
            ? ` then t for tab ${count}, T for ${count} back`
            : " then j / k to move, G to go there, gt for that tab, gT back"}
        </span>
      </div>
    )
  if (!pending || !shown) return null
  return (
    <div className={box} style={under} role="status" aria-label="g, then">
      <div className="mb-1.5 text-app-ink/40">g, then</div>
      <div className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-3 gap-y-0.5">
        {goKeys().map(([keys, label]) => (
          <div key={keys} className="contents">
            <kbd className="whitespace-nowrap text-app-ink">
              {keys.replace(/^g ?/, "")}
            </kbd>
            <span className="text-app-ink/60">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * PROTOTYPE (J): the g keys where they lead: a badge on each tab with its
 * letter and its place in the strip (for 3gt), and the strip's own keys in a
 * box below it.
 */
function TabBadges({
  box,
  style,
}: {
  box: string
  style?: React.CSSProperties
}) {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'nav[aria-label="Workspace sections"] a',
    ),
  )
  return (
    <>
      {links.map((link, i) => {
        const r = link.getBoundingClientRect()
        const kind =
          new URL(link.href, window.location.href).searchParams.get("tab") ?? ""
        const letter = goLetterOf(kind)
        const badge =
          "pointer-events-none fixed z-50 hidden -translate-x-1/2 rounded bg-app-ink px-1 font-mono text-[10px] leading-4 text-app-bg shadow md:block"
        const centre = r.left + r.width / 2
        return (
          <div key={link.href + i} aria-hidden>
            {/* The letter above the tab, its place (for 3gt) below. */}
            {letter && (
              <div
                className={`${badge} -translate-y-full`}
                style={{ left: centre, top: r.top - 2 }}
              >
                {letter}
              </div>
            )}
            <div
              className={`${badge} bg-app-ink/60`}
              style={{ left: centre, top: r.bottom + 2 }}
            >
              {i + 1}
            </div>
          </div>
        )
      })}
      <div className={box} style={style} role="status" aria-label="g, then">
        <div className="mb-1.5 text-app-ink/40">g, then a tab's letter, or</div>
        <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
          {stripKeys().map(([key, what]) => (
            <div key={key} className="contents">
              <kbd className="text-app-ink">{key}</kbd>
              <span className="text-app-ink/60">{what}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * PROTOTYPE (H): the g keys as the corner list shows a tab's keys, one key
 * and its meaning a row, stacked just above whatever the corner shows (the
 * list or the pill). A count typed shows here too.
 */
function CornerGoKeys({ pending }: { pending: boolean }) {
  const count = useCount()
  const g = useGPending()
  if (!pending && !count) return null
  const hint = document
    .querySelector("[data-corner-hint]")
    ?.getBoundingClientRect()
  const bottom = hint ? window.innerHeight - hint.top + 8 : 16
  const rows: [string, string][] = count
    ? g
      ? // The g and the count are in: only t or T is left to press.
        [
          ["t", `tab ${count}`],
          ["T", `${count} tabs back`],
        ]
      : [
          [`${count} j / k`, `move ${count}`],
          [`${count} G`, `go to the ${count}th`],
          [`${count} gt`, `tab ${count}`],
        ]
    : goKeys()
  return (
    <div
      role="status"
      aria-label="g, then"
      style={{ bottom }}
      className="fixed left-4 z-50 hidden grid-cols-[max-content_1fr] gap-x-3 rounded-xl border border-app-ink/10 bg-app-card/95 p-3 text-[11px] shadow-lg backdrop-blur md:grid"
    >
      {/* The keys spell the g out; only a count needs saying. */}
      {count ? (
        <div className="col-span-2 mb-1 text-app-ink/40">
          {g ? `${count} and g, then` : `${count}, then`}
        </div>
      ) : null}
      {rows.map(([key, what]) => (
        <div key={key} className="contents">
          <kbd className="whitespace-nowrap font-mono text-app-ink">{key}</kbd>
          <span className="text-app-ink/60">{what}</span>
        </div>
      ))}
    </div>
  )
}
