/**
 * The live check's answer, said in words (ADR-043, CW-01). The server judges
 * each Channel (`POST /data/posts/window-check`); this module only groups,
 * sorts and phrases what it answered, so every surface says it the same way.
 *
 * A window is measured in what it lacks, not in Channels: "~185 Posts (4%)"
 * first, then the problems by kind, then routine lag as one phrase ("8 frozen
 * · 13 holes · last 18 h on 149").
 */

import type {
  ChannelVerdict,
  UnprovenStretch,
  WindowCheckResponse,
} from "@/client"

export type Verdict = ChannelVerdict
export type WindowCheck = WindowCheckResponse
export type Reason = NonNullable<Verdict["reason"]>

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Red is something went wrong, amber is not yet, slate is no sync can help. */
export type Tone = "red" | "amber" | "slate"

/**
 * Each reason's label, tone and word in the one-line phrase (singular,
 * plural), keyed in the server's order, what a person can act on first.
 */
export const REASONS: Record<
  Reason,
  { label: string; tone: Tone; word: [string, string] }
> = {
  skipped: {
    label: "Skipped by you",
    tone: "amber",
    word: ["skipped", "skipped"],
  },
  failed: { label: "Sync failed", tone: "red", word: ["failed", "failed"] },
  timed_out: {
    label: "Timed out",
    tone: "red",
    word: ["timed out", "timed out"],
  },
  refused: { label: "Refused", tone: "red", word: ["refused", "refused"] },
  end: {
    label: "Not synced to the end",
    tone: "amber",
    word: ["overdue", "overdue"],
  },
  hole: { label: "Hole in the window", tone: "amber", word: ["hole", "holes"] },
  start: {
    label: "History short of the start",
    tone: "amber",
    word: ["short history", "short histories"],
  },
  retention: {
    label: "Before the retention cutoff",
    tone: "slate",
    word: ["past retention", "past retention"],
  },
  frozen: { label: "Frozen", tone: "slate", word: ["frozen", "frozen"] },
  unavailable: {
    label: "Unavailable",
    tone: "slate",
    word: ["unavailable", "unavailable"],
  },
}

/** The server's order (`REASON_ORDER`), which the generated schema pins. */
export const REASON_ORDER = Object.keys(REASONS) as Reason[]

/** How much of the window a Channel cannot vouch for, in ms. */
export const unprovenMs = (c: Verdict, kinds?: UnprovenStretch["kind"][]) =>
  c.stretches
    .filter((s) => !kinds || kinds.includes(s.kind))
    .reduce((n, s) => n + Math.max(0, s.to - s.from), 0)

/** Most Posts at risk first, so the top of a list is where the risk is. */
const riskFirst = (list: Verdict[]) =>
  [...list].sort(
    (a, b) =>
      b.unprovenPosts - a.unprovenPosts ||
      unprovenMs(b) - unprovenMs(a) ||
      a.name.localeCompare(b.name),
  )

export const incompleteOf = (check: WindowCheck | undefined) =>
  (check?.channels ?? []).filter((c) => c.reason)

/**
 * The Incomplete Channels a sync can fix (problems, then the ones only
 * Behind) and the ones no sync can, each most Posts at risk first.
 */
export function byFix(incomplete: Verdict[]) {
  return {
    problems: riskFirst(incomplete.filter((c) => c.syncable && !c.behind)),
    behind: riskFirst(incomplete.filter((c) => c.behind)),
    stuck: riskFirst(incomplete.filter((c) => !c.syncable)),
  }
}

/** What a Channel needs looking at for; "behind" when it only lags. */
export type Kind = Reason | "behind"
/**
 * The one-line phrase's order, not the reasons': what no sync can fix comes
 * before a hole, and the end last, since lag is the routine kind.
 */
const KIND_ORDER: Reason[] = [
  "skipped",
  "failed",
  "timed_out",
  "refused",
  "frozen",
  "unavailable",
  "retention",
  "hole",
  "start",
]
export function kindOf(c: Verdict): Kind {
  if (c.behind) return "behind"
  // No sync can help a frozen Channel, so its last failure is not the news.
  if (!c.syncable && c.reasons.includes("frozen")) return "frozen"
  return KIND_ORDER.find((r) => c.reasons.includes(r)) ?? "end"
}
/** The longest lag among the Behind Channels, in ms. */
export const behindLag = (incomplete: Verdict[]) =>
  Math.max(
    0,
    ...incomplete.filter((c) => c.behind).map((c) => unprovenMs(c, ["end"])),
  )

/** "3 holes · 6 failed · last 24 min on 324"; empty when nothing is Incomplete. */
export function measure(incomplete: Verdict[]): string {
  const counts = new Map<Reason, number>()
  for (const c of incomplete) {
    const k = kindOf(c)
    if (k !== "behind") counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const parts = KIND_ORDER.concat("end")
    .filter((k) => counts.has(k))
    .map((k) => {
      const n = counts.get(k) ?? 0
      return `${n} ${REASONS[k].word[n === 1 ? 0 : 1]}`
    })
  const behind = incomplete.filter((c) => c.behind).length
  if (behind) parts.push(`last ${span(behindLag(incomplete))} on ${behind}`)
  return parts.join(" · ")
}

/**
 * The Posts an Incomplete window may lack, as a share of what it holds:
 * "~340 Posts (7%)", "~40+ Posts" when a pace is unknown, "no Posts
 * expected" only at 0 with every pace known, "an unknown number of Posts"
 * at 0 otherwise.
 */
export function postsPhrase(check: WindowCheck): string {
  const n = check.unprovenPosts
  const floor = check.unprovenFloor
  if (n === 0) return floor ? "an unknown number of Posts" : "no Posts expected"
  const share = (n / (check.heldPosts + n)) * 100
  return `~${n.toLocaleString("en-US")}${floor ? "+" : ""} ${n === 1 ? "Post" : "Posts"} (${share < 1 ? "<1" : Math.round(share)}%)`
}

export function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / MINUTE))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} d`
}

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })

export const stamp = (ms: number | null | undefined) =>
  ms
    ? new Date(ms).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never"

const posts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`

/**
 * How far a Channel falls short, in its own terms: "31 h behind, ~114
 * posts", "hole: 4 posts, 7:13 PM to 7:30 PM", "history starts 2 h late".
 * Empty when no stretch says it (a failure or a freeze alone).
 */
export function shortfall(c: Verdict): string {
  const parts: string[] = []
  const end = c.stretches.find((s) => s.kind === "end")
  if (end) {
    const lag = end.to - end.from
    const paced =
      c.pacePerHour == null
        ? ""
        : `, ~${posts(Math.round((c.pacePerHour * lag) / HOUR))}`
    parts.push(
      c.lastSync == null && c.headReadAt == null
        ? "never synced"
        : `${span(lag)} behind${paced}`,
    )
  }
  const hole = c.stretches.find((s) => s.kind === "hole")
  if (hole) {
    const sameDay =
      new Date(hole.from).toDateString() === new Date(hole.to).toDateString()
    parts.push(
      `hole: ${posts(c.missingIds)}, ${sameDay ? clock(hole.from) : stamp(hole.from)} to ${clock(hole.to)}`,
    )
  }
  const short = c.stretches.find((s) => s.kind === "start")
  if (short) parts.push(`history starts ${span(short.to - short.from)} late`)
  return parts.join(" · ")
}

// ---- The coverage bar's kinds ------------------------------------------------

/**
 * What the charts colour: what is missing, never why. Complete is last; what
 * no sync can fix is hatched, so it reads without colour.
 */
export type Gap = "hole" | "start" | "overdue" | "behind" | "stuck" | "complete"
export const GAP_ORDER: Gap[] = [
  "hole",
  "start",
  "overdue",
  "behind",
  "stuck",
  "complete",
]

/** One unproven stretch's colour on a Channel's bar. */
export function stretchGap(c: Verdict, s: UnprovenStretch): Gap {
  if (!c.syncable) return "stuck"
  if (s.kind !== "end") return s.kind
  return c.behind ? "behind" : "overdue"
}

/** A Channel's one segment on the summary bar, its most telling stretch. */
export function channelGap(c: Verdict): Gap {
  if (!c.reason) return "complete"
  if (!c.syncable) return "stuck"
  const gaps = c.stretches.map((s) => stretchGap(c, s))
  return GAP_ORDER.find((g) => gaps.includes(g)) ?? "overdue"
}

/** How many Channels each kind holds, in the bar's order, absent kinds out. */
export function gapCounts(check: WindowCheck): [Gap, number][] {
  const counts = new Map<Gap, number>()
  for (const c of check.channels)
    counts.set(channelGap(c), (counts.get(channelGap(c)) ?? 0) + 1)
  return GAP_ORDER.filter((g) => counts.has(g)).map((g) => [
    g,
    counts.get(g) ?? 0,
  ])
}

/**
 * Which kinds Details starts with switched off. Complete always, Behind too
 * when anything else is there, so the list opens on what needs a look.
 */
export function initiallyHidden(check: WindowCheck): Set<Gap> {
  const present = gapCounts(check).map(([g]) => g)
  const others = present.filter((g) => g !== "behind" && g !== "complete")
  return new Set<Gap>(others.length ? ["complete", "behind"] : ["complete"])
}

/** Toggle one kind. */
export function toggled(hidden: Set<Gap>, gap: Gap): Set<Gap> {
  const next = new Set(hidden)
  if (next.has(gap)) next.delete(gap)
  else next.add(gap)
  return next
}

/**
 * A double-click shows this kind alone, or, when it already is, every kind
 * again.
 */
export function isolated(hidden: Set<Gap>, gap: Gap, present: Gap[]): Set<Gap> {
  const others = present.filter((g) => g !== gap)
  const alone = !hidden.has(gap) && others.every((g) => hidden.has(g))
  return new Set(alone ? [] : others)
}

/**
 * The rows Details lists, grouped by what a sync fixes, each group most
 * Posts at risk first; the hidden kinds left out.
 */
export function rowGroups(check: WindowCheck, hidden: Set<Gap>) {
  const shown = check.channels.filter((c) => !hidden.has(channelGap(c)))
  const { problems, behind, stuck } = byFix(shown.filter((c) => c.reason))
  return {
    fixable: [...problems, ...behind],
    stuck,
    complete: shown
      .filter((c) => !c.reason)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
