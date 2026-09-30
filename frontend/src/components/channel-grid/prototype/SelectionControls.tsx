/**
 * PROTOTYPE, throwaway: three ways to change the selection relative to what
 * the filters show (S1 menu, S3 Venn; S2's inline buttons are in e9b67fb), and the scope
 * switch that decides whether bulk actions, trim included, reach channels
 * the filters hide.
 */
import { ChevronDown, Eye, EyeOff } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { cn } from "@/lib/utils"
import { Pop, PopLabel } from "./Pop"
import {
  applyRegions,
  isNoop,
  type Regions,
  regionsOf,
  SELECTION_OPS,
  sizeAfter,
} from "./selection"
import type { ChannelControlsProps } from "./types"

const barButton =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold text-app-ink/80 hover:bg-app-ink/10 hover:text-app-ink disabled:opacity-40"

/** Two circles, the kept regions filled: a legend for each operation. */
export const VennIcon: React.FC<{ keep: Regions; size?: number }> = ({
  keep,
  size = 22,
}) => (
  <svg
    width={size * 1.5}
    height={size}
    viewBox="0 0 36 24"
    role="img"
    aria-label={`Venn: ${[keep.hidden && "hidden selected", keep.both && "selected and shown", keep.fresh && "shown unselected"].filter(Boolean).join(", ") || "nothing"} kept`}
    className="shrink-0"
  >
    <title>Which part of selected and shown is kept</title>
    <defs>
      <clipPath id="venn-left">
        <circle cx="13" cy="12" r="10" />
      </clipPath>
    </defs>
    {/* left = selected, right = shown; painted left, right, then the overlap */}
    <circle
      cx="13"
      cy="12"
      r="10"
      className={keep.hidden ? "fill-app-ink/70" : "fill-app-card"}
    />
    <circle
      cx="23"
      cy="12"
      r="10"
      className={keep.fresh ? "fill-sky-500/70" : "fill-app-card"}
    />
    <circle
      cx="23"
      cy="12"
      r="10"
      clipPath="url(#venn-left)"
      className={keep.both ? "fill-violet-500/80" : "fill-app-card"}
    />
    <circle cx="13" cy="12" r="10" className="fill-none stroke-app-ink/50" />
    <circle cx="23" cy="12" r="10" className="fill-none stroke-app-ink/50" />
  </svg>
)

/** "52 selected · 40 hidden" with the scope switch folded in. */
export const SelectionScopeSwitch: React.FC<ChannelControlsProps> = (p) => {
  const r = regionsOf(p.selectedChannels, p.shownNames)
  if (r.hidden.length === 0) return null
  const shownOnly = p.selectionScope === "shown"
  return (
    <button
      type="button"
      aria-pressed={shownOnly}
      onClick={() => p.onSelectionScopeChange(shownOnly ? "all" : "shown")}
      title={
        shownOnly
          ? `Bulk actions reach only the ${r.both.length} shown. Click to include the ${r.hidden.length} hidden too.`
          : `Bulk actions reach all ${p.selectedChannels.size}, ${r.hidden.length} of them hidden by filters. Click to act on shown only.`
      }
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold",
        shownOnly
          ? "border-sky-500/50 bg-sky-500/10 text-sky-600"
          : "border-amber-500/50 bg-amber-500/10 text-amber-700",
      )}
    >
      {shownOnly ? <Eye size={11} /> : <EyeOff size={11} />}
      {shownOnly
        ? `acting on ${r.both.length} shown`
        : `${r.hidden.length} hidden by filters`}
    </button>
  )
}

const ScopeChoice: React.FC<ChannelControlsProps> = (p) => {
  const r = regionsOf(p.selectedChannels, p.shownNames)
  return (
    <div className="mt-2 space-y-1 border-t border-app-ink/10 pt-2">
      <PopLabel>Bulk actions apply to</PopLabel>
      {(
        [
          [
            "all",
            `All ${p.selectedChannels.size} selected`,
            `${r.hidden.length} hidden by filters included`,
          ],
          [
            "shown",
            `Only the ${r.both.length} shown`,
            "Hidden ones stay selected, untouched",
          ],
        ] as const
      ).map(([k, label, hint]) => (
        <label
          key={k}
          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-[11px] hover:bg-app-ink/5"
        >
          <input
            type="radio"
            checked={p.selectionScope === k}
            onChange={() => p.onSelectionScopeChange(k)}
            className="mt-0.5 accent-app-ink"
          />
          <span>
            <span className="block font-semibold">{label}</span>
            <span className="block text-[10px] text-app-ink/50">{hint}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

// ---- S1: a Selection menu -------------------------------------------------

/** One "Selection ▾" menu: each operation with its Venn and the count after. */
export const SelectionMenu: React.FC<ChannelControlsProps> = (p) => {
  const [open, setOpen] = useState(false)
  const r = regionsOf(p.selectedChannels, p.shownNames)
  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className={cn(barButton, "border border-app-ink/15")}
        >
          Selection
          <ChevronDown size={11} className="opacity-50" />
        </button>
      }
      className="w-80"
    >
      <PopLabel>
        {p.selectedChannels.size} selected · {p.shownNames.length} shown ·{" "}
        {r.both.length} both
      </PopLabel>
      {SELECTION_OPS.map((op) => {
        const noop = isNoop(p.selectedChannels, p.shownNames, op.regions)
        return (
          <button
            key={op.key}
            type="button"
            disabled={noop}
            onClick={() => {
              p.onSetSelection(
                applyRegions(p.selectedChannels, p.shownNames, op.regions),
              )
              setOpen(false)
            }}
            className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-app-ink/5 disabled:opacity-35"
          >
            <VennIcon keep={op.regions} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold">
                {op.label}
              </span>
              <span className="block text-[10px] text-app-ink/50">
                {op.detail}
              </span>
            </span>
            <span className="text-[10px] tabular-nums text-app-ink/60">
              → {sizeAfter(p.selectedChannels, p.shownNames, op.regions)}
            </span>
          </button>
        )
      })}
      <ScopeChoice {...p} />
    </Pop>
  )
}

// ---- S3: pick regions of a Venn -------------------------------------------

/**
 * Click the regions to keep. The four common picks are presets under it, but
 * any of the eight combinations is one click away.
 */
export const SelectionVenn: React.FC<ChannelControlsProps> = (p) => {
  const [open, setOpen] = useState(false)
  const r = regionsOf(p.selectedChannels, p.shownNames)
  const [keep, setKeep] = useState<Regions>({
    hidden: true,
    both: true,
    fresh: false,
  })
  const toggle = (k: keyof Regions) => setKeep({ ...keep, [k]: !keep[k] })
  const after = sizeAfter(p.selectedChannels, p.shownNames, keep)
  const region = (k: keyof Regions, label: string, n: number, on: string) => (
    <button
      type="button"
      aria-pressed={keep[k]}
      onClick={() => toggle(k)}
      className={cn(
        "flex flex-col items-center rounded-md px-2 py-1 text-[10px] font-semibold",
        keep[k] ? on : "text-app-ink/40 line-through",
      )}
    >
      <span className="text-[16px] tabular-nums">{n}</span>
      {label}
    </button>
  )
  return (
    <Pop
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setKeep({ hidden: true, both: true, fresh: false })
      }}
      trigger={
        <button
          type="button"
          className={cn(barButton, "border border-app-ink/15")}
        >
          <VennIcon
            keep={{ hidden: true, both: true, fresh: false }}
            size={14}
          />
          Selection
          <ChevronDown size={11} className="opacity-50" />
        </button>
      }
      className="w-[22rem]"
    >
      <PopLabel>Click what to keep selected</PopLabel>
      <div className="relative mx-auto my-1 h-28 w-72">
        <div
          className={cn(
            "absolute left-2 top-1 h-26 w-40 rounded-full border-2 border-app-ink/40",
            keep.hidden && "bg-app-ink/10",
          )}
          style={{ height: "6.5rem" }}
        />
        <div
          className={cn(
            "absolute right-2 top-1 w-40 rounded-full border-2 border-sky-500/60",
            keep.fresh && "bg-sky-500/10",
          )}
          style={{ height: "6.5rem" }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-5">
          {region(
            "hidden",
            "selected, hidden",
            r.hidden.length,
            "text-app-ink",
          )}
          <span className={cn("rounded-lg", keep.both && "bg-violet-500/15")}>
            {region(
              "both",
              "selected & shown",
              r.both.length,
              "text-violet-600",
            )}
          </span>
          {region(
            "fresh",
            "shown, not selected",
            r.fresh.length,
            "text-sky-600",
          )}
        </div>
        <span className="absolute -bottom-0.5 left-6 text-[9px] font-bold uppercase tracking-widest text-app-ink/45">
          selected
        </span>
        <span className="absolute -bottom-0.5 right-8 text-[9px] font-bold uppercase tracking-widest text-sky-600/70">
          shown
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {SELECTION_OPS.map((op) => {
          const on =
            op.regions.hidden === keep.hidden &&
            op.regions.both === keep.both &&
            op.regions.fresh === keep.fresh
          return (
            <button
              key={op.key}
              type="button"
              onClick={() => setKeep(op.regions)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                on
                  ? "border-app-ink bg-app-ink text-app-bg"
                  : "border-app-ink/15 hover:border-app-ink/40",
              )}
            >
              {op.label}
            </button>
          )
        })}
      </div>
      <TgButton
        size="sm"
        className="mt-2 w-full"
        disabled={isNoop(p.selectedChannels, p.shownNames, keep)}
        onClick={() => {
          p.onSetSelection(applyRegions(p.selectedChannels, p.shownNames, keep))
          setOpen(false)
        }}
      >
        Apply · {after} selected
      </TgButton>
      <ScopeChoice {...p} />
    </Pop>
  )
}
