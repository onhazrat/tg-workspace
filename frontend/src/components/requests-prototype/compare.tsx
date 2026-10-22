// PROTOTYPE (request-stats): two or more Accounts side by side. Never merge.
import { type Fact, fmt, groupBy, KINDS, pct, type Tally } from "./data"
import { accountColor, KIND_COLOR, OutcomeBar, Swatch } from "./shared"

const thBase =
  "px-3 py-2 font-normal text-[11px] uppercase tracking-wider text-app-ink/50"
const th = `${thBase} text-right`

export function AccountCompare({
  facts,
  accounts,
  all: everyAccount,
}: {
  facts: Fact[]
  accounts: { id: string; email: string; synthetic?: boolean }[]
  all: { id: string }[]
}) {
  const byAccount = groupBy(facts, (x) => x.account ?? "")
  const byAccountKind = groupBy(facts, (x) => `${x.account}|${x.kind}`)
  const charged = KINDS.filter((k) => k.charged)
  const max = Math.max(
    0,
    ...accounts.map((a) => byAccount.get(a.id)?.total ?? 0),
  )
  const all = accounts.reduce(
    (s, a) => s + (byAccount.get(a.id)?.total ?? 0),
    0,
  )
  return (
    <section className="rounded-md border border-app-ink/10 bg-app-card">
      <h3 className="px-3 pt-2.5 text-sm font-semibold">
        Comparing {accounts.length} Accounts
      </h3>
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            <th className={`${thBase} text-left`}>Account</th>
            <th className={th}>Requests</th>
            <th className={th}>Share</th>
            {charged.map((k) => (
              <th key={k.id} className={th}>
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={KIND_COLOR[k.id]} />
                  {k.label}
                </span>
              </th>
            ))}
            <th className={th}>Idle</th>
            <th className={th}>Wasted</th>
            <th className={`${th} w-1/5`} />
          </tr>
        </thead>
        <tbody>
          {accounts
            .map((a) => ({ a, t: byAccount.get(a.id) as Tally | undefined }))
            .sort((x, y) => (y.t?.total ?? 0) - (x.t?.total ?? 0))
            .map(({ a, t }) => (
              <tr key={a.id} className="border-t border-app-ink/5 tabular-nums">
                <td className="px-3 py-1.5 font-medium">
                  <span className="mr-2 inline-block">
                    <Swatch
                      color={accountColor(
                        everyAccount.findIndex((x) => x.id === a.id),
                      )}
                    />
                  </span>
                  {a.email}
                  {a.synthetic && (
                    <span className="ml-1.5 text-[10px] text-fuchsia-400">
                      synthetic
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-semibold">
                  {fmt(t?.total ?? 0)}
                </td>
                <td className="px-3 py-1.5 text-right text-app-ink/60">
                  {pct(t?.total ?? 0, all)}
                </td>
                {charged.map((k) => (
                  <td key={k.id} className="px-3 py-1.5 text-right">
                    {fmt(byAccountKind.get(`${a.id}|${k.id}`)?.total ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  {pct(t?.idle ?? 0, t?.total ?? 0)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {pct(t?.wasted ?? 0, t?.total ?? 0)}
                </td>
                <td className="px-3 py-1.5">
                  {t && <OutcomeBar t={t} max={max} />}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  )
}
