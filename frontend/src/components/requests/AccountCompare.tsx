import {
  type AccountRow,
  accountColor,
  COMPARE_KINDS,
  fmt,
  type Outcome,
  outcomeShare,
  pct,
} from "@/lib/requests/breakdown"
import { td, th } from "./KindTable"
import { kindColor, OutcomeBar, Swatch } from "./parts"

/**
 * Two or more Accounts side by side (RQS-05): each one's charged Requests,
 * its share of theirs, each charged kind, Idle %, Wasted % and the outcome
 * bar. Each Account wears its step of the violet ramp. Kind columns and the
 * bar go at phone width.
 */
export function AccountCompare({
  rows,
  every,
  hiddenKinds,
  hiddenOutcomes,
}: {
  /** The picked Accounts, busiest first. */
  rows: AccountRow[]
  /** Every Account's id, in the order that gives each its colour. */
  every: readonly string[]
  hiddenKinds: ReadonlySet<string>
  hiddenOutcomes: ReadonlySet<Outcome>
}) {
  const all = rows.reduce((sum, r) => sum + r.total, 0)
  const max = Math.max(0, ...rows.map((r) => r.total))
  const kinds = COMPARE_KINDS.filter((k) => !hiddenKinds.has(k.id))
  const share = (o: Outcome, r: AccountRow) =>
    outcomeShare(hiddenOutcomes, o, r)
  return (
    <section
      aria-labelledby="requests-compare"
      className="rounded-md border border-app-ink/10 bg-app-card"
    >
      <h3 id="requests-compare" className="px-3 pt-2.5 text-sm font-semibold">
        Comparing {rows.length} Accounts
      </h3>
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            <th className={th}>Account</th>
            <th className={`${th} text-right`}>Requests</th>
            <th className={`${th} text-right max-sm:hidden`}>Share</th>
            {kinds.map((k) => (
              <th key={k.id} className={`${th} text-right max-sm:hidden`}>
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={kindColor(k.id)} />
                  {k.label}
                </span>
              </th>
            ))}
            <th className={`${th} text-right`}>Idle</th>
            <th className={`${th} text-right`}>Wasted</th>
            <th className={`${th} w-1/5 max-sm:hidden`}>
              <span className="sr-only">Useful · Idle · Wasted</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-app-ink/5">
              <td className="min-w-0 px-3 py-1.5 font-medium max-sm:px-1.5">
                <span className="flex items-center gap-2 break-all">
                  <Swatch color={accountColor(r.id, every)} />
                  {r.email || "Deleted Account"}
                </span>
              </td>
              <td className={`${td} text-right font-semibold`}>
                {fmt(r.total)}
              </td>
              <td className={`${td} text-right text-app-ink/60 max-sm:hidden`}>
                {pct(all ? r.total / all : 0)}
              </td>
              {kinds.map((k) => (
                <td key={k.id} className={`${td} text-right max-sm:hidden`}>
                  {fmt(r.byKind[k.id] ?? 0)}
                </td>
              ))}
              <td className={`${td} text-right`}>{share("idle", r)}</td>
              <td className={`${td} text-right`}>{share("wasted", r)}</td>
              <td className="px-3 py-1.5 max-sm:hidden">
                <OutcomeBar t={r} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
