/**
 * The Requests tab's small pieces (RQS-03): swatches, the outcome bar and
 * chips, and the stat strip. Colours are the `--kind-*` and `--outcome-*`
 * tokens in `index.css`.
 */
import { AlertTriangle, CircleCheck, CircleDashed } from "lucide-react"
import type React from "react"
import {
  fmt,
  KINDS,
  OUTCOMES,
  type Outcome,
  pct,
  type Tally,
} from "@/lib/requests/breakdown"
import { STEP } from "@/lib/requests/zoom"

/** A kind this build does not know takes Other's colour. */
export const kindColor = (id: string) =>
  `var(--kind-${KINDS.some((k) => k.id === id) ? id : "other"})`

export const outcomeColor = (o: Outcome) => `var(--outcome-${o})`

const OUTCOME_ICON: Record<Outcome, React.FC<{ size?: number }>> = {
  useful: CircleCheck,
  idle: CircleDashed,
  wasted: AlertTriangle,
}

export function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-sm"
      style={{ background: color }}
    />
  )
}

export function OutcomeIcon({ outcome }: { outcome: Outcome }) {
  const Icon = OUTCOME_ICON[outcome]
  return (
    <span aria-hidden style={{ color: outcomeColor(outcome) }}>
      <Icon size={12} />
    </span>
  )
}

/** A bar split by outcome, as wide as `t` is against `max`. */
export function OutcomeBar({ t, max }: { t: Tally; max: number }) {
  const width = max ? Math.min(100, (100 * t.total) / max) : 0
  return (
    <div
      className="flex h-2.5 min-w-1 items-stretch gap-px"
      style={{ width: `${width}%` }}
    >
      {OUTCOMES.filter((o) => t[o.id] > 0).map((o) => (
        <div
          key={o.id}
          className="first:rounded-l-sm last:rounded-r-sm"
          style={{ flexGrow: t[o.id], background: outcomeColor(o.id) }}
          title={`${o.label} ${fmt(t[o.id])}`}
        />
      ))}
      {t.ledgerOnly > 0 && (
        <div
          className="last:rounded-r-sm"
          style={{ flexGrow: t.ledgerOnly, background: LEDGER_HATCH }}
          title={`Before recording ${fmt(t.ledgerOnly)}`}
        />
      )}
    </div>
  )
}

/** The ledger's days before recording, which have no outcome: hatched, as on the trend (RQS-16). */
const LEDGER_HATCH =
  "repeating-linear-gradient(45deg, var(--viz-axis) 0 2px, transparent 2px 4px)"

/**
 * Useful, Idle and Wasted as chips that hide or show each on the whole tab.
 * The last one shown stays: hiding it would leave nothing to read.
 */
export function OutcomeChips({
  hidden,
  onToggle,
  shades = false,
}: {
  hidden: ReadonlySet<Outcome>
  onToggle: (outcome: Outcome) => void
  /** Each outcome's shade beside it, in the ink: the trend's key when kinds are shaded (RQS-08). */
  shades?: boolean
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {OUTCOMES.map((o) => {
        const off = hidden.has(o.id)
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={!off}
            disabled={!off && hidden.size === OUTCOMES.length - 1}
            onClick={() => onToggle(o.id)}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] disabled:cursor-not-allowed ${off ? "border-app-ink/15 text-app-ink/40 line-through" : "border-app-ink/40 text-app-ink/80"}`}
          >
            {shades && <Shade outcome={o.id} />}
            <OutcomeIcon outcome={o.id} />
            {o.label}
          </button>
        )
      })}
    </span>
  )
}

/** An outcome's step of the ink toward the card, as the trend shades each kind. */
function Shade({ outcome }: { outcome: Outcome }) {
  return (
    <span
      aria-hidden
      data-testid={`requests-shade-${outcome}`}
      className="inline-block size-2.5 rounded-sm border border-app-ink/20"
      style={{
        background: `color-mix(in srgb, var(--ink) ${STEP[outcome] * 100}%, var(--card-bg))`,
      }}
    />
  )
}

/**
 * Requests, then each outcome with its share of them. Requests on days
 * before recording have no outcome, and a line says so (RQS-16).
 */
export function StatStrip({ t }: { t: Tally }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Requests" value={fmt(t.total)} />
        {OUTCOMES.map((o) => (
          <Stat
            key={o.id}
            label={o.label}
            icon={<OutcomeIcon outcome={o.id} />}
            value={fmt(t[o.id])}
            share={t.total ? `${pct(t[o.id] / t.total)} of all` : undefined}
          />
        ))}
      </div>
      {t.ledgerOnly > 0 && (
        <p
          data-testid="requests-before-recording"
          className="mt-1 text-[11px] text-app-ink/50"
        >
          {fmt(t.ledgerOnly)} Requests come from the ledger's daily totals, on
          days before recording started: they have no Channel or outcome.
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  icon,
  value,
  share,
}: {
  label: string
  icon?: React.ReactNode
  value: string
  share?: string
}) {
  return (
    <div
      data-testid={`requests-stat-${label.toLowerCase()}`}
      className="rounded-md border border-app-ink/10 bg-app-card px-3 py-2"
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-app-ink/50">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {share && <div className="text-[11px] text-app-ink/50">{share}</div>}
    </div>
  )
}
