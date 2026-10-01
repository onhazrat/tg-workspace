import { ChevronDown, Eye, EyeOff } from "lucide-react"
import type React from "react"
import { useId, useState } from "react"
import { BarPopover } from "@/components/BarPopover"
import { TgButton } from "@/components/ui/tg-button"
import {
  type ActionLimit,
  applyRegions,
  editFor,
  type Regions,
  regionsOf,
  SELECTION_EDITS,
  selectionChange,
  UNCHANGED,
} from "@/lib/channels/selection-regions"
import { cn } from "@/lib/utils"

type RegionKey = keyof Regions

// One colour per region, shared by the Venn, the preset icons and the counts.
const FILL: Record<RegionKey, string> = {
  hidden: "fill-amber-500/55",
  both: "fill-violet-500/70",
  fresh: "fill-sky-500/55",
}

const LABEL: Record<RegionKey, string> = {
  hidden: "Selected, hidden by filters",
  both: "Selected and shown",
  fresh: "Shown, not selected",
}

const CAPTION: Record<RegionKey, [string, string]> = {
  hidden: ["selected,", "hidden"],
  both: ["selected", "& shown"],
  fresh: ["shown, not", "selected"],
}

/** Two small circles with the kept regions filled: a preset's legend. */
function VennIcon({ keep, size = 16 }: { keep: Regions; size?: number }) {
  const clip = useId()
  return (
    <svg
      width={size * 1.5}
      height={size}
      viewBox="0 0 36 24"
      // Always beside a text label, so it stays out of the accessible name.
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

/**
 * Painted left circle, right circle, then the overlap on top, so each region
 * is its own click target and keyboard checkbox without computing crescents.
 * A dropped region is hatched with its count faded, so it reads as removed
 * rather than empty. Each hatch is painted straight after its own region, so
 * the overlap painted later covers a crescent's hatch where it reaches in.
 */
function Venn({
  counts,
  keep,
  onToggle,
}: {
  counts: Record<RegionKey, number>
  keep: Regions
  onToggle: (k: RegionKey) => void
}) {
  const id = useId()
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
    className: cn(
      "cursor-pointer outline-none transition-[fill] hover:opacity-80 focus-visible:stroke-app-ink focus-visible:stroke-2",
      keep[k] ? FILL[k] : "fill-app-card",
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
        {CAPTION[k][0]}
      </text>
      <text x={x} y={104} className="fill-app-ink/55 text-[9px] font-semibold">
        {CAPTION[k][1]}
      </text>
    </g>
  )
  const hatch = (k: RegionKey, cx: number, clipPath?: string) =>
    keep[k] ? null : (
      <circle
        cx={cx}
        cy="80"
        r="64"
        fill={`url(#${id}-x)`}
        clipPath={clipPath}
        className="pointer-events-none"
      />
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
      {hatch("hidden", 122)}
      <circle cx="198" cy="80" r="64" {...region("fresh")} />
      {hatch("fresh", 198)}
      {/* An opaque base, so neither crescent's paint or hatch shows through. */}
      <circle
        cx="198"
        cy="80"
        r="64"
        clipPath={`url(#${id}-l)`}
        className="pointer-events-none fill-app-card"
      />
      <circle
        cx="198"
        cy="80"
        r="64"
        clipPath={`url(#${id}-l)`}
        {...region("both")}
      />
      {hatch("both", 198, `url(#${id}-l)`)}
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

type LimitProps = {
  selection: ReadonlySet<string>
  shown: string[]
  limit: ActionLimit
  onLimitChange: (limit: ActionLimit) => void
}

/**
 * Row 2's indicator: shown only while the filters hide part of the selection,
 * blue while the actions reach the shown part alone, amber while they reach
 * Channels off screen. A click switches the limit.
 */
export function ActionLimitIndicator({
  selection,
  shown,
  limit,
  onLimitChange,
}: LimitProps) {
  const r = regionsOf(selection, shown)
  if (r.hidden.length === 0) return null
  const onShown = limit === "shown"
  return (
    <button
      type="button"
      data-testid="action-limit-indicator"
      aria-pressed={onShown}
      onClick={() => onLimitChange(onShown ? "all" : "shown")}
      title={
        onShown
          ? `Actions, Trim and the sort rank reach only the ${r.both.length} shown. Click to include the ${r.hidden.length} hidden.`
          : `Actions reach all ${selection.size}, ${r.hidden.length} of them hidden by filters. Click to act on the shown only.`
      }
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold",
        onShown
          ? "border-sky-500/50 bg-sky-500/10 text-sky-600"
          : "border-amber-500/50 bg-amber-500/10 text-amber-700",
      )}
    >
      {onShown ? (
        <Eye size={11} aria-hidden />
      ) : (
        <EyeOff size={11} aria-hidden />
      )}
      {onShown
        ? `acting on ${r.both.length} shown`
        : `${r.hidden.length} hidden by filters`}
    </button>
  )
}

/**
 * Adjust selection (CTB-04): click regions of a Venn of Selected and Shown to
 * keep or drop them, or start from a preset. The line under it says what
 * changes before Apply does it, and the action limit sits here too because it
 * answers the same question.
 */
export function ChannelSelectionAdjust({
  selection,
  shown,
  onApply,
  limit,
  onLimitChange,
}: LimitProps & { onApply: (next: Set<string>) => void }) {
  const [open, setOpen] = useState(false)
  const [keep, setKeep] = useState<Regions>(UNCHANGED)
  const r = regionsOf(selection, shown)
  const counts = {
    hidden: r.hidden.length,
    both: r.both.length,
    fresh: r.fresh.length,
  }
  const { before, after, dropped, added } = selectionChange(
    selection,
    shown,
    keep,
  )
  const noop = dropped === 0 && added === 0
  const active = editFor(keep)

  return (
    <BarPopover
      width="w-[23rem]"
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setKeep(UNCHANGED)
      }}
      trigger={
        <button
          type="button"
          data-testid="adjust-selection"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-app-ink/15 px-2.5 text-[11px] font-semibold text-app-ink/80 hover:border-app-ink/40 hover:text-app-ink data-[state=open]:border-app-ink/40"
        >
          <VennIcon keep={UNCHANGED} size={14} />
          Adjust selection
          <ChevronDown size={11} className="opacity-50" />
        </button>
      }
    >
      <div className="p-1">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[12px] font-bold">Adjust selection</span>
          <span className="text-[10px] tabular-nums text-app-ink/50">
            {selection.size} selected · {shown.length} shown
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
          {SELECTION_EDITS.map((edit) => (
            <button
              key={edit.key}
              type="button"
              aria-pressed={active?.key === edit.key}
              title={edit.detail}
              onClick={() => setKeep(edit.regions)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[10px] font-semibold",
                active?.key === edit.key
                  ? "border-app-ink bg-app-ink/[0.06]"
                  : "border-app-ink/10 hover:border-app-ink/35",
                edit.key === "replace" && "col-span-2",
              )}
            >
              <VennIcon keep={edit.regions} />
              {edit.label}
            </button>
          ))}
        </div>

        <div
          data-testid="adjust-selection-change"
          className="mt-3 flex items-center justify-between gap-2 rounded-md bg-app-ink/[0.04] px-2.5 py-2 text-[10px] tabular-nums"
        >
          <span>
            <span className="font-bold text-app-ink">
              {before} → {after}
            </span>{" "}
            <span className="text-app-ink/55">selected</span>
          </span>
          <span className="flex gap-2">
            {dropped > 0 && (
              <span className="text-amber-600">−{dropped} dropped</span>
            )}
            {added > 0 && <span className="text-sky-600">+{added} added</span>}
            {noop && <span className="text-app-ink/40">no change</span>}
            {!noop && !active && (
              <span className="text-app-ink/40">custom</span>
            )}
          </span>
        </div>

        <TgButton
          size="sm"
          className="mt-2 w-full"
          disabled={noop}
          data-testid="adjust-selection-apply"
          onClick={() => {
            onApply(applyRegions(selection, shown, keep))
            setOpen(false)
          }}
        >
          Apply · {after} selected
        </TgButton>

        <div className="mt-3 border-t border-app-ink/10 pt-3">
          <div className="mb-1.5 text-[10px] font-semibold text-app-ink/60">
            Actions, trim and sort rank apply to
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-app-ink/10 p-0.5">
            {(
              [
                ["shown", "Shown", `${counts.both} selected and shown`, Eye],
                ["all", "All", `all ${selection.size} selected`, EyeOff],
              ] as const
            ).map(([value, text, hint, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={limit === value}
                title={hint}
                onClick={() => onLimitChange(value)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-bold",
                  limit === value
                    ? "bg-app-ink text-app-bg"
                    : "text-app-ink/70 hover:bg-app-ink/5",
                )}
              >
                <Icon size={12} aria-hidden />
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </BarPopover>
  )
}
