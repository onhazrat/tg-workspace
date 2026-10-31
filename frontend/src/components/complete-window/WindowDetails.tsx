import { BarChart3, List } from "lucide-react"
import { useState } from "react"

import {
  behindLag,
  type Gap,
  gapCounts,
  incompleteOf,
  initiallyHidden,
  isolated,
  REASONS,
  type Reason,
  rowGroups,
  shortfall,
  span,
  stamp,
  stretchGap,
  type Tone,
  toggled,
  type Verdict,
  type WindowCheck,
} from "@/lib/complete-window/window-check"
import { HoverPopover } from "./HoverPopover"

// Charts colour what is missing, never why: three gap kinds from the dataviz
// palette, validated in both themes; routine lag a quieter step of the end
// gap's blue; a covered stretch the neutral track; what no sync can fix
// hatched, so it reads without colour.
export const TRACK = "bg-[#f0efec] dark:bg-[#383835]"
export const GAP: Record<Gap, { label: string; className: string }> = {
  hole: { label: "Hole", className: "bg-[#eb6834] dark:bg-[#d95926]" },
  start: {
    label: "Short history",
    className: "bg-[#1baf7a] dark:bg-[#199e70]",
  },
  overdue: {
    label: "End gap, overdue",
    className: "bg-[#2a78d6] dark:bg-[#3987e5]",
  },
  behind: {
    label: "End gap, behind",
    className: "bg-[#86b6ef] dark:bg-[#184f95]",
  },
  stuck: { label: "No sync can fix", className: "text-app-ink/45" },
  complete: { label: "Complete", className: TRACK },
}
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px)",
}
export const gapStyle = (g: Gap) => (g === "stuck" ? HATCH : undefined)

export const TONE: Record<Tone, string> = {
  red: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  amber:
    "bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/30",
  slate: "bg-app-ink/5 text-app-ink/60 border-app-ink/15",
}

function Swatch({ gap }: { gap: Gap }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-3 shrink-0 rounded-sm ${GAP[gap].className}`}
      style={gapStyle(gap)}
    />
  )
}

/** A reason's chip; with an error, the error opens on hover or tap. */
export function ReasonChip({
  reason,
  error,
}: {
  reason: Reason
  error?: string | null
}) {
  const chip = `inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[REASONS[reason].tone]}`
  if (!error) return <span className={chip}>{REASONS[reason].label}</span>
  return (
    <HoverPopover
      testId="reason-error"
      className={`${chip} cursor-help underline decoration-dotted`}
      trigger={REASONS[reason].label}
    >
      <p className="text-[12px]">{error}</p>
    </HoverPopover>
  )
}

/** A row's chips, minus what its words already say; a failure's error opens. */
export function Chips({ c }: { c: Verdict }) {
  const worded: Reason[] = shortfall(c) ? ["end", "hole", "start"] : []
  return (
    <>
      {c.reasons
        .filter((r) => !worded.includes(r))
        .map((r) => (
          <ReasonChip
            key={r}
            reason={r}
            error={r === "failed" ? c.error : null}
          />
        ))}
    </>
  )
}

/** The bar: one segment per kind sized by its Channels, and its legend. */
function CoverageBar({
  check,
  hidden,
  onToggle,
  onIsolate,
}: {
  check: WindowCheck
  hidden: Set<Gap>
  onToggle: (gap: Gap) => void
  onIsolate: (gap: Gap, present: Gap[]) => void
}) {
  const groups = gapCounts(check)
  const present = groups.map(([g]) => g)
  const lag = behindLag(incompleteOf(check))
  return (
    <div className="space-y-1">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {groups.map(([gap, n]) => (
          <div
            key={gap}
            title={`${GAP[gap].label}: ${n}`}
            className={`min-w-[2px] ${GAP[gap].className} ${hidden.has(gap) && gap !== "complete" ? "opacity-25" : ""}`}
            style={{ flex: `${n} 1 0`, ...gapStyle(gap) }}
          />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-app-ink/60">
        {groups.map(([gap, n]) => (
          <button
            key={gap}
            type="button"
            aria-pressed={!hidden.has(gap)}
            title="Show or hide these below; double-click to show only these"
            onClick={() => onToggle(gap)}
            onDoubleClick={() => onIsolate(gap, present)}
            className={`-mx-1 inline-flex select-none items-center gap-1 rounded px-1 hover:bg-app-ink/5 ${hidden.has(gap) ? "line-through opacity-50" : ""}`}
          >
            <Swatch gap={gap} /> {GAP[gap].label}{" "}
            <span className="font-bold tabular-nums">
              {n}
              {gap === "behind" && lag > 0 && (
                <span className="font-normal">, up to {span(lag)}</span>
              )}
              {gap === "complete" && (
                <span className="font-normal"> of {check.channels.length}</span>
              )}
            </span>
          </button>
        ))}
      </p>
    </div>
  )
}

/** Visualize: each Channel's window as a bar, its unproven stretches coloured. */
function Timeline({ check, rows }: { check: WindowCheck; rows: Verdict[] }) {
  const width = Math.max(1, check.end - check.start)
  const at = (ms: number) =>
    Math.min(100, (Math.max(0, ms - check.start) / width) * 100)
  return (
    <div className="space-y-2" data-testid="window-timeline">
      <div className="flex justify-between text-[10px] text-app-ink/40">
        <span>{stamp(check.start)}</span>
        <span>{stamp(check.end)}</span>
      </div>
      {rows.map((c) => (
        <div
          key={c.name}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] sm:flex-nowrap"
        >
          <span className="min-w-0 max-w-full truncate sm:w-36 sm:shrink-0">
            @{c.name}
          </span>
          {/* A phone gives the bar a line of its own. */}
          <div
            className={`relative order-last h-3 basis-full overflow-hidden rounded sm:order-none sm:basis-auto sm:flex-1 ${TRACK}`}
          >
            {c.stretches.map((s) => (
              <div
                key={`${s.kind}${s.from}`}
                title={`${GAP[stretchGap(c, s)].label}: ${stamp(s.from)} to ${stamp(s.to)}`}
                className={`absolute inset-y-0 rounded ${GAP[stretchGap(c, s)].className}`}
                style={{
                  ...gapStyle(stretchGap(c, s)),
                  left: `${at(s.from)}%`,
                  width: `${Math.max(1, at(s.to) - at(s.from))}%`,
                }}
              />
            ))}
          </div>
          <span className="ml-auto min-w-0 max-w-full text-[11px] text-app-ink/60 sm:w-64 sm:shrink-0 sm:truncate">
            {shortfall(c) || (c.reason ? REASONS[c.reason].label : "complete")}
          </span>
        </div>
      ))}
    </div>
  )
}

function RowGroup({ title, rows }: { title: string; rows: Verdict[] }) {
  if (rows.length === 0) return null
  return (
    <tbody className="divide-y divide-app-ink/5">
      <tr>
        <th
          colSpan={3}
          className="pt-2 pb-1 text-left text-[11px] font-bold text-app-ink/70"
        >
          {title} · {rows.length}
        </th>
      </tr>
      {rows.map((c) => (
        // A phone stacks each row: the name, then why, under it.
        <tr
          key={c.name}
          data-testid="window-row"
          className="max-sm:flex max-sm:flex-col max-sm:py-1.5"
        >
          <td className="py-1.5 pr-2 max-sm:py-0">@{c.name}</td>
          <td className="py-1.5 pr-2 max-sm:py-0">
            <span className="flex flex-wrap items-center gap-1 text-app-ink/70">
              {shortfall(c) && <span>{shortfall(c)}</span>}
              <Chips c={c} />
            </span>
          </td>
          <td className="hidden py-1.5 text-app-ink/60 sm:table-cell">
            {stamp(c.lastSync)}
          </td>
        </tr>
      ))}
    </tbody>
  )
}

function Rows({ check, hidden }: { check: WindowCheck; hidden: Set<Gap> }) {
  const { fixable, stuck, complete } = rowGroups(check, hidden)
  return (
    <table className="w-full text-left text-[12px]">
      <thead className="text-app-ink/50 max-sm:hidden">
        <tr>
          <th className="py-1 font-medium">Channel</th>
          <th className="py-1 font-medium">Why</th>
          <th className="hidden py-1 font-medium sm:table-cell">Last sync</th>
        </tr>
      </thead>
      <RowGroup title="A sync can fix these" rows={fixable} />
      <RowGroup title="No sync can fix these" rows={stuck} />
      <RowGroup title="Complete" rows={complete} />
    </table>
  )
}

function ToggleButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-app-ink/15 px-2 py-1 text-[11px] font-bold text-app-ink hover:bg-app-ink/5"
    >
      {children}
    </button>
  )
}

/**
 * Details: the bar and its legend, whose items toggle their rows (a
 * double-click isolates, again restores), Visualize, Hide rows, and the rows
 * grouped by what a sync fixes, most Posts at risk first.
 */
export function WindowDetails({ check }: { check: WindowCheck }) {
  const [hidden, setHidden] = useState(() => initiallyHidden(check))
  const [chart, setChart] = useState(false)
  const [rows, setRows] = useState(true)
  const { fixable, stuck, complete } = rowGroups(check, hidden)
  const shown = [...fixable, ...stuck, ...complete]
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-app-card p-2 text-app-ink">
      <CoverageBar
        check={check}
        hidden={hidden}
        onToggle={(gap) => setHidden((h) => toggled(h, gap))}
        onIsolate={(gap, present) =>
          setHidden((h) => isolated(h, gap, present))
        }
      />
      <div className="flex flex-wrap justify-end gap-2">
        <ToggleButton pressed={chart} onClick={() => setChart(!chart)}>
          <BarChart3 size={12} />
          {chart ? "Hide chart" : "Visualize"}
        </ToggleButton>
        <ToggleButton pressed={rows} onClick={() => setRows(!rows)}>
          <List size={12} />
          {rows ? "Hide rows" : "Show rows"}
        </ToggleButton>
      </div>
      {shown.length === 0 ? (
        <p className="text-[12px] text-app-ink/50">
          Every kind is hidden. Turn one back on in the legend above.
        </p>
      ) : (
        <>
          {chart && <Timeline check={check} rows={shown} />}
          {rows && <Rows check={check} hidden={hidden} />}
        </>
      )}
    </div>
  )
}
