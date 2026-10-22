/**
 * Keyboard mode's corner (ADR-034): the pill, or the shown tab's keys when
 * `?` asked for them, and above either, after a moment, what a waiting `g` or
 * a typed count leads to. One column, so the waiting list sits on whatever
 * the corner holds without measuring it. Hidden while keyboard mode is off,
 * and on a phone.
 */
import { useEffect, useState } from "react"
import { afterCount, afterG, listKeys } from "@/lib/keyboard/key-list"
import {
  useHelp,
  useKeyboardMode,
  usePending,
  useShownList,
} from "@/lib/keyboard/mode"

/** How long a `g` or a count waits before its next keys show, so a quick gt never flashes them. */
const HINT_DELAY_MS = 300

type Rows = readonly (readonly [keys: string, what: string])[]

const BOX =
  "grid grid-cols-[max-content_1fr] gap-x-3 rounded-xl border border-app-ink/10 bg-app-card/95 p-3 text-[11px] shadow-lg backdrop-blur"

/** One key and its meaning a row, keys as typed. */
function KeyRows({ rows, title }: { rows: Rows; title?: string }) {
  return (
    <div className={BOX}>
      {title && <div className="col-span-2 mb-1 text-app-ink/40">{title}</div>}
      {rows.map(([keys, what]) => (
        <div key={`${keys} ${what}`} className="contents">
          <kbd className="whitespace-nowrap font-mono text-app-ink">{keys}</kbd>
          <span className="text-app-ink/60">{what}</span>
        </div>
      ))}
    </div>
  )
}

/** Whether a `g` or a count has waited long enough to show its next keys. */
function useWaitedLong(): boolean {
  const { g, count } = usePending()
  const waiting = g || count !== ""
  const [long, setLong] = useState(false)
  useEffect(() => {
    setLong(false)
    if (!waiting) return
    const timer = window.setTimeout(() => setLong(true), HINT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [waiting])
  return waiting && long
}

const CORNER_FOOT: Rows = [
  ["?", "all the keys"],
  ["\\", "keyboard mode off"],
]

export function CornerHelp() {
  const on = useKeyboardMode()
  const help = useHelp()
  const shown = useShownList()
  const { g, count } = usePending()
  const waited = useWaitedLong()
  if (!on) return null
  return (
    <div className="fixed bottom-4 left-4 z-50 hidden flex-col items-start gap-2 md:flex">
      {waited && (
        <KeyRows
          title={
            count ? (g ? `${count} and g, then` : `${count}, then`) : "g, then"
          }
          rows={count ? afterCount(count, g) : afterG()}
        />
      )}
      {help === "corner" && shown ? (
        <KeyRows
          rows={[...listKeys(shown.list, shown.carried), ...CORNER_FOOT]}
        />
      ) : (
        <div className="rounded-full border border-app-ink/10 bg-app-card/95 px-3 py-1 font-mono text-[11px] text-app-ink/60 shadow-lg backdrop-blur">
          keyboard mode · <kbd className="text-app-ink">?</kbd> keys ·{" "}
          <kbd className="text-app-ink">\</kbd> off
        </div>
      )}
    </div>
  )
}
