/**
 * The coverage wall (SUMTAB-06): every Channel the Summary drew on as its
 * avatar, with one split badge growing out of the photo's bottom-right corner,
 * Cited Posts on the blue half and Covered Posts on the grey one.
 */
import { useMemo } from "react"
import type { ScopedPostRef } from "@/client"
import { ChannelAvatar } from "@/components/ChannelAvatar"
import type { CitedPost } from "@/lib/summaries/cited-posts"
import { type CoverageRow, coverageRows } from "@/lib/summaries/coverage"
import type { CitationWorkspace } from "./SummaryCitation"

/** Set on a highlighted Channel's Citations and strip tiles. */
export const HIGHLIGHT_ATTR = "data-channel-highlight"

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

export function CoverageWall({
  scopeChannels,
  cited,
  covered,
  workspace,
}: {
  scopeChannels: string[]
  cited: CitedPost[]
  /** The frozen Scope's Post refs; null when none were recorded. */
  covered: ScopedPostRef[] | null | undefined
  workspace: CitationWorkspace
}) {
  const rows = useMemo(
    () => coverageRows(scopeChannels, cited, covered),
    [scopeChannels, cited, covered],
  )
  const citedChannels = rows.filter((r) => r.cited.length).length
  const outside = rows.filter((r) => r.outsideScope)
  return (
    <section
      aria-labelledby="coverage-heading"
      className="mt-10 border-t border-app-ink/10 pt-6"
    >
      <h4 id="coverage-heading" className="text-sm font-bold">
        Channel coverage
      </h4>
      <p className="mt-1 text-xs text-app-ink/60">
        {`${citedChannels} of ${plural(rows.length, "channel")} cited`}
        {covered ? ` · ${plural(covered.length, "post")} used` : ""}
      </p>
      <ul className="mt-4 flex flex-wrap gap-x-12 gap-y-4">
        {rows.map((row) => (
          <li key={row.channelName}>
            <CoverageAvatar row={row} workspace={workspace} />
          </li>
        ))}
      </ul>
      {outside.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
          <span className="font-semibold">Outside the Scope</span>
          {`: ${outside.map((r) => r.channelName).join(", ")}, cited though the Summary was not given ${outside.length === 1 ? "it" : "them"}.`}
        </p>
      )}
      <p className="mt-3 flex items-center gap-2 text-xs text-app-ink/60">
        {covered ? (
          <>
            <Badge cited={2} covered={12} />
            <span>
              means 2 of the 12 posts this channel gave the Summary were cited.
            </span>
          </>
        ) : (
          <span>
            The badge counts each channel's cited posts. The input was not
            recorded for this Summary, so what it read but did not cite is
            unknown.
          </span>
        )}
      </p>
    </section>
  )
}

function CoverageAvatar({
  row,
  workspace,
}: {
  row: CoverageRow
  workspace: CitationWorkspace
}) {
  const name = row.channelName
  const label = [
    `${name}: ${row.cited.length} cited`,
    ...(row.covered ? [`${row.covered.length} covered`] : []),
    ...(row.outsideScope ? ["outside the Scope"] : []),
  ].join(", ")
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={false}
      title={name}
      className={`relative block rounded-full ${row.cited.length ? "" : "opacity-50 grayscale"} ${row.outsideScope ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-app-card" : ""}`}
    >
      <ChannelAvatar
        channel={workspace.channel(name) ?? { id: name, name }}
        className="size-11"
        textClassName="text-base"
      />
      <span aria-hidden className="absolute bottom-0 left-[calc(100%-8px)]">
        <Badge cited={row.cited.length} covered={row.covered?.length ?? 0} />
      </span>
    </button>
  )
}

/** One pill, blue then grey; a half with nothing to say is left out. */
function Badge({ cited, covered }: { cited: number; covered: number }) {
  if (!cited && !covered) return null
  return (
    <span className="flex overflow-hidden whitespace-nowrap rounded-full text-[10px] font-semibold leading-4 ring-2 ring-app-card">
      {cited > 0 && (
        <span data-badge="cited" className="bg-blue-500 px-1.5 text-white">
          {cited}
        </span>
      )}
      {covered > 0 && (
        <span
          data-badge="covered"
          className="bg-app-ink/15 px-1.5 text-app-ink/70"
        >
          {covered}
        </span>
      )}
    </span>
  )
}
