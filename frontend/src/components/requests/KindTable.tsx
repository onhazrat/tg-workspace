import type React from "react"
import { fmt, type KindRow, type Outcome, pct } from "@/lib/requests/breakdown"
import { kindColor, OutcomeBar, Swatch } from "./parts"

export const th =
  "px-3 py-2 text-left font-normal text-[11px] uppercase tracking-wider text-app-ink/50 max-sm:px-1.5"
export const td = "px-3 py-1.5 tabular-nums max-sm:px-1.5"

/**
 * By kind of work (RQS-03): a Show box per kind, its Requests and share, the
 * outcome bar, Idle % and Wasted %. A hidden kind keeps its row, faded, with
 * its count; a hidden outcome shows as a dash. Clicking a row narrows the
 * Channel table to the rows with that work, and again undoes it (RQS-04).
 */
export function KindTable({
  rows,
  max,
  hiddenOutcomes,
  onToggleKind,
  picked = [],
  onPickKind = () => {},
  chips,
}: {
  rows: KindRow[]
  max: number
  hiddenOutcomes: ReadonlySet<Outcome>
  onToggleKind: (kind: string) => void
  /** The kinds the Channel table is narrowed to. */
  picked?: readonly string[]
  onPickKind?: (kind: string) => void
  /** The outcome chips, in the heading. */
  chips: React.ReactNode
}) {
  const share = (o: Outcome, r: KindRow) =>
    hiddenOutcomes.has(o) || !r.total ? "–" : pct(r[o] / r.total)
  return (
    <section
      aria-labelledby="requests-by-kind"
      className="rounded-md border border-app-ink/10 bg-app-card"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
        <h3 id="requests-by-kind" className="text-sm font-semibold">
          By kind of work
        </h3>
        <span className="ml-auto">{chips}</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            <th className={`${th} w-8`}>
              <span className="sr-only">Shown</span>
            </th>
            <th className={th}>Kind</th>
            <th className={`${th} text-right`}>Requests</th>
            <th className={`${th} text-right max-sm:hidden`}>Share</th>
            <th className={`${th} w-1/3 max-sm:hidden`}>
              Useful · Idle · Wasted
            </th>
            <th className={`${th} text-right`}>Idle</th>
            <th className={`${th} text-right`}>Wasted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.kind.id}
              data-picked={picked.includes(r.kind.id)}
              title="Narrow the Channels below to this work"
              onClick={() => onPickKind(r.kind.id)}
              className={`cursor-pointer border-t border-app-ink/5 hover:bg-app-ink/5 data-[picked=true]:bg-app-ink/10 ${r.hidden ? "opacity-40" : ""}`}
            >
              <td className="pl-3">
                <input
                  type="checkbox"
                  aria-label={`Show ${r.kind.label}`}
                  checked={!r.hidden}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleKind(r.kind.id)}
                />
              </td>
              <td className="px-3 py-1.5 max-sm:px-1.5">
                <span className="flex flex-wrap items-center gap-x-2">
                  <Swatch color={kindColor(r.kind.id)} />
                  {r.kind.label}
                  {!r.kind.charged && (
                    <span className="text-[10px] text-app-ink/40">
                      uncharged
                    </span>
                  )}
                </span>
              </td>
              <td className={`${td} text-right font-semibold`}>
                {fmt(r.total)}
              </td>
              <td className={`${td} text-right text-app-ink/60 max-sm:hidden`}>
                {r.share === null ? "–" : pct(r.share)}
              </td>
              <td className="px-3 py-1.5 max-sm:hidden">
                {!r.hidden && <OutcomeBar t={r} max={max} />}
              </td>
              <td className={`${td} text-right`}>{share("idle", r)}</td>
              <td className={`${td} text-right`}>{share("wasted", r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 pb-2 text-[11px] text-app-ink/40">
        Untick a kind or an outcome to read the rest in proportion. Click a kind
        to narrow the Channels below to it.
      </p>
    </section>
  )
}
