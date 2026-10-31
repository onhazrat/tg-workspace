import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { useState } from "react"

import {
  clock,
  incompleteOf,
  measure,
  postsPhrase,
  type WindowCheck,
} from "@/lib/complete-window/window-check"
import { WindowDetails } from "./WindowDetails"

/**
 * The one line for a window (ADR-043). What is unproven ("Unproven through
 * 09:07 AM: ~185 Posts (4%) · 8 frozen · last 18 h on 149"), an action slot,
 * and Details; or "Complete window" when nothing is missing. `updating`
 * dims a line that is for another selection or window until the new one
 * lands.
 */
export function WindowBanner({
  check,
  action,
  updating = false,
}: {
  check: WindowCheck
  action?: React.ReactNode
  updating?: boolean
}) {
  const [open, setOpen] = useState(false)
  const incomplete = incompleteOf(check)
  const line =
    incomplete.length === 0 ? (
      <p className="flex items-center gap-2 text-[12px] text-green-700 dark:text-green-300">
        <CheckCircle2 size={14} className="shrink-0" />
        Complete window: all {check.channels.length} Channels proven through{" "}
        {clock(check.end)}
      </p>
    ) : (
      <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-200">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <AlertTriangle size={14} className="shrink-0" />
          <span
            className="font-bold"
            title={`${incomplete.length} of ${check.channels.length} Channels cannot prove they hold every Post up to the window's end.`}
          >
            Unproven through {clock(check.end)}: {postsPhrase(check)} ·{" "}
            {measure(incomplete)}
          </span>
          {action}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="ml-auto text-[11px] underline"
          >
            {open ? "Hide" : "Details"}
          </button>
        </div>
        {open && <WindowDetails check={check} />}
      </section>
    )
  if (!updating) return <div data-testid="window-banner">{line}</div>
  return (
    <div data-testid="window-banner" className="relative" aria-busy="true">
      <div className="opacity-40">{line}</div>
      <span className="pointer-events-none absolute top-1/2 right-24 flex -translate-y-1/2 items-center gap-1 text-[11px] text-app-ink/60">
        <Loader2 size={12} className="animate-spin" /> Updating…
      </span>
    </div>
  )
}
