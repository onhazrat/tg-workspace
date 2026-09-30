/**
 * PROTOTYPE, throwaway: S3, the selection edited against what the filters
 * show by picking regions of a Venn, and the scope that decides whether bulk
 * actions, trim and the rank numbers reach channels the filters hide. The S1
 * menu and S2 buttons it beat live in 427aff6.
 */
import { ChevronDown, Eye, EyeOff } from "lucide-react"
import type React from "react"
import { useId, useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { cn } from "@/lib/utils"
import { Pop } from "./Pop"
import {
  applyRegions,
  isNoop,
  type Regions,
  regionsOf,
  SELECTION_OPS,
} from "./selection"
import type { ChannelControlsProps } from "./types"

// One colour per region, used by the big Venn, the legend icons and the counts.
const FILL = {
  hidden: "fill-amber-500/55",
  both: "fill-violet-500/70",
  fresh: "fill-sky-500/55",
} as const
const TEXT = {
  hidden: "text-amber-600",
  both: "text-violet-600",
  fresh: "text-sky-600",
} as const

/** Two small circles, the kept regions filled: a preset's legend. */
export const VennIcon: React.FC<{ keep: Regions; size?: number }> = ({
  keep,
  size = 16,
}) => {
  const clip = useId()
  return (
    <svg
      width={size * 1.5}
      height={size}
      viewBox="0 0 36 24"
      // Always next to a text label, so it stays out of the accessible name.
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="13" cy="12" r="10" />
        </clipPath>
      </defs>
      <circle
        cx="13"
        cy="12"
        r="10"
        className={keep.hidden ? FILL.hidden : "fill-transparent"}
      />
      <circle
        cx="23"
        cy="12"
        r="10"
        className={keep.fresh ? FILL.fresh : "fill-app-card"}
      />
      <circle
        cx="23"
        cy="12"
        r="10"
        clipPath={`url(#${clip})`}
        className={keep.both ? FILL.both : "fill-app-card"}
      />
      <circle cx="13" cy="12" r="10" className="fill-none stroke-app-ink/45" />
      <circle cx="23" cy="12" r="10" className="fill-none stroke-app-ink/45" />
    </svg>
  )
}

/** Row 2's hint: how much of the selection the filters hide, and the scope. */
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
          ? `Actions, trim and ranks reach only the ${r.both.length} shown. Click to include the ${r.hidden.length} hidden.`
          : `Actions reach all ${p.selectedChannels.size}, ${r.hidden.length} of them hidden by filters. Click to act on the shown only.`
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

type RegionKey = keyof Regions

const LABEL: Record<RegionKey, string> = {
  hidden: "Selected, hidden by filters",
  both: "Selected and shown",
  fresh: "Shown, not selected",
}
const SHORT: Record<RegionKey, [string, string]> = {
  hidden: ["selected,", "hidden"],
  both: ["selected", "& shown"],
  fresh: ["shown, not", "selected"],
}

/**
 * The Venn itself. Painted left circle, right circle, then the overlap on
 * top, so each region is its own click target without computing crescents.
 */
const Venn: React.FC<{
  counts: Record<RegionKey, number>
  keep: Regions
  onToggle: (k: RegionKey) => void
}> = ({ counts, keep, onToggle }) => {
  const id = useId()
  const [hover, setHover] = useState<RegionKey | null>(null)
  const region = (k: RegionKey) => ({
    role: "checkbox" as const,
    "aria-checked": keep[k],
    "aria-label": `${LABEL[k]}: ${counts[k]}`,
    tabIndex: 0,
    onClick: () => onToggle(k),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault()
        onToggle(k)
      }
    },
    onMouseEnter: () => setHover(k),
    onMouseLeave: () => setHover(null),
    className: cn(
      "cursor-pointer outline-none transition-[fill] focus-visible:stroke-app-ink focus-visible:stroke-2",
      keep[k] ? FILL[k] : hover === k ? "fill-app-ink/[0.07]" : "fill-app-card",
    ),
  })
  const label = (k: RegionKey, x: number) => (
    <g className="pointer-events-none" textAnchor="middle">
      <text
        x={x}
        y={76}
        className={cn(
          "text-[22px] font-bold tabular-nums",
          keep[k] ? "fill-app-ink" : "fill-app-ink/30",
        )}
      >
        {counts[k]}
      </text>
      <text x={x} y={93} className="fill-app-ink/55 text-[9px] font-semibold">
        {SHORT[k][0]}
      </text>
      <text x={x} y={104} className="fill-app-ink/55 text-[9px] font-semibold">
        {SHORT[k][1]}
      </text>
    </g>
  )
  return (
    <svg viewBox="0 0 320 150" className="w-full">
      <title>Pick what stays selected</title>
      <defs>
        <clipPath id={`${id}-l`}>
          <circle cx="122" cy="80" r="64" />
        </clipPath>
        <pattern
          id={`${id}-x`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            className="stroke-app-ink/10"
            strokeWidth="2"
          />
        </pattern>
      </defs>
      {/* Labels sit at the outer edges: the circles meet in the middle. */}
      <text
        x="58"
        y="14"
        className="fill-amber-600 text-[10px] font-bold uppercase tracking-widest"
      >
        Selected
      </text>
      <text
        x="262"
        y="14"
        textAnchor="end"
        className="fill-sky-600 text-[10px] font-bold uppercase tracking-widest"
      >
        Shown
      </text>
      <circle cx="122" cy="80" r="64" {...region("hidden")} />
      <circle cx="198" cy="80" r="64" {...region("fresh")} />
      <circle
        cx="198"
        cy="80"
        r="64"
        clipPath={`url(#${id}-l)`}
        {...region("both")}
      />
      {/* A dropped region is hatched, so "off" reads as removed, not empty. */}
      {(["hidden", "fresh", "both"] as const).map((k) =>
        keep[k] ? null : (
          <circle
            key={k}
            cx={k === "hidden" ? 122 : 198}
            cy="80"
            r="64"
            fill={`url(#${id}-x)`}
            clipPath={k === "both" ? `url(#${id}-l)` : undefined}
            className="pointer-events-none"
          />
        ),
      )}
      <circle
        cx="122"
        cy="80"
        r="64"
        className="pointer-events-none fill-none stroke-amber-600/70"
        strokeWidth="1.5"
      />
      <circle
        cx="198"
        cy="80"
        r="64"
        className="pointer-events-none fill-none stroke-sky-600/70"
        strokeWidth="1.5"
      />
      {label("hidden", 88)}
      {label("both", 160)}
      {label("fresh", 232)}
    </svg>
  )
}

const sameRegions = (a: Regions, b: Regions) =>
  a.hidden === b.hidden && a.both === b.both && a.fresh === b.fresh

const UNCHANGED: Regions = { hidden: true, both: true, fresh: false }

/**
 * S3: click regions to keep or drop them, or start from a preset. The footer
 * says what changes before Apply does it, and the scope for actions, trim and
 * ranks sits in the same popover because it answers the same question.
 */
export const SelectionVenn: React.FC<ChannelControlsProps> = (p) => {
  const [open, setOpen] = useState(false)
  const [keep, setKeep] = useState<Regions>(UNCHANGED)
  const r = regionsOf(p.selectedChannels, p.shownNames)
  const counts = {
    hidden: r.hidden.length,
    both: r.both.length,
    fresh: r.fresh.length,
  }
  const dropped =
    (keep.hidden ? 0 : counts.hidden) + (keep.both ? 0 : counts.both)
  const added = keep.fresh ? counts.fresh : 0
  const after = p.selectedChannels.size - dropped + added
  const noop = isNoop(p.selectedChannels, p.shownNames, keep)
  const active = SELECTION_OPS.find((op) => sameRegions(op.regions, keep))
  const apply = () => {
    if (noop) return
    p.onSetSelection(applyRegions(p.selectedChannels, p.shownNames, keep))
    setOpen(false)
  }

  return (
    <Pop
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setKeep(UNCHANGED)
      }}
      trigger={
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-app-ink/15 px-2.5 text-[11px] font-semibold text-app-ink/80 hover:border-app-ink/40 hover:text-app-ink data-[state=open]:border-app-ink/40"
        >
          <VennIcon keep={UNCHANGED} size={14} />
          Adjust selection
          <ChevronDown size={11} className="opacity-50" />
        </button>
      }
      className="w-[23rem] p-3"
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] font-bold">Adjust selection</span>
        <span className="text-[10px] tabular-nums text-app-ink/50">
          {p.selectedChannels.size} selected · {p.shownNames.length} shown
        </span>
      </div>
      <p className="mb-1 text-[10px] text-app-ink/55">
        Click a region to keep it selected or drop it.
      </p>

      <Venn
        counts={counts}
        keep={keep}
        onToggle={(k) => setKeep({ ...keep, [k]: !keep[k] })}
      />

      <div className="mt-1 grid grid-cols-2 gap-1">
        {SELECTION_OPS.map((op) => {
          const on = active?.key === op.key
          return (
            <button
              key={op.key}
              type="button"
              aria-pressed={on}
              title={op.detail}
              onClick={() => setKeep(op.regions)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[10px] font-semibold",
                on
                  ? "border-app-ink bg-app-ink/[0.06]"
                  : "border-app-ink/10 hover:border-app-ink/35",
                op.key === "replace" && "col-span-2",
              )}
            >
              <VennIcon keep={op.regions} />
              {op.label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-md bg-app-ink/[0.04] px-2.5 py-2 text-[10px] tabular-nums">
        <span>
          <span className="font-bold text-app-ink">
            {p.selectedChannels.size} → {after}
          </span>{" "}
          <span className="text-app-ink/55">selected</span>
        </span>
        <span className="flex gap-2">
          {dropped > 0 && (
            <span className={TEXT.hidden}>−{dropped} dropped</span>
          )}
          {added > 0 && <span className={TEXT.fresh}>+{added} added</span>}
          {noop && <span className="text-app-ink/40">no change</span>}
          {!noop && !active && <span className="text-app-ink/40">custom</span>}
        </span>
      </div>

      <TgButton
        size="sm"
        className="mt-2 w-full"
        disabled={noop}
        onClick={apply}
      >
        {noop ? "Nothing to change" : `Apply · ${after} selected`}
      </TgButton>

      {counts.hidden > 0 && (
        <div className="mt-3 border-t border-app-ink/10 pt-3">
          <div className="mb-1.5 text-[10px] font-semibold text-app-ink/60">
            Actions, trim and sort rank apply to
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-app-ink/10 p-0.5">
            {(
              [
                [
                  "all",
                  `All ${p.selectedChannels.size}`,
                  `incl. ${counts.hidden} hidden`,
                  EyeOff,
                ],
                ["shown", `Shown ${counts.both}`, "hidden stay selected", Eye],
              ] as const
            ).map(([k, label, hint, Icon]) => (
              <button
                key={k}
                type="button"
                aria-pressed={p.selectionScope === k}
                onClick={() => p.onSelectionScopeChange(k)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left",
                  p.selectionScope === k
                    ? "bg-app-ink text-app-bg"
                    : "text-app-ink/70 hover:bg-app-ink/5",
                )}
              >
                <Icon size={12} />
                <span>
                  <span className="block text-[11px] font-bold">{label}</span>
                  <span className="block text-[9px] opacity-70">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Pop>
  )
}
