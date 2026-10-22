// PROTOTYPE (request-stats): synthetic Requests, scaled from a deployment's real totals.
// Never merge. See docs/request-stats-prototype-plan.md.
//
// What is real: each day's charged Requests per Account and Budget (the quota ledger),
// each day's probe Requests, when probes ran and how often they found nothing (the
// Directory's latest verdicts), and every sync with its Channel, hour, source, status and
// Post count (the sync logs). What is invented: how a day's charged Requests divide
// between its syncs (weighted by pages), the Idle share of syncs that found no new Posts,
// the retry share, and every handle check, which nothing counts today.

import { request } from "@/api/base"

/** How long each tier keeps its Requests (plan, "Recording and retention"). */
export const REQUEST_DAYS = 7
export const HOURLY_DAYS = 30
/** Everything the prototype loads: the daily tier reaches back further than the hourly. */
export const LOADED_DAYS = 45

export type Kind = "auto" | "bulk" | "single" | "follow" | "probe" | "handle"
export type Outcome = "useful" | "idle" | "wasted"

export const KINDS: { id: Kind; label: string; charged: boolean }[] = [
  { id: "auto", label: "Auto sync", charged: true },
  { id: "bulk", label: "Manual bulk", charged: true },
  { id: "single", label: "Manual single", charged: true },
  { id: "follow", label: "Follow", charged: true },
  { id: "probe", label: "Directory probe", charged: false },
  { id: "handle", label: "Handle check", charged: false },
]
export const KIND_LABEL = Object.fromEntries(
  KINDS.map((k) => [k.id, k.label]),
) as Record<Kind, string>
export const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "useful", label: "Useful" },
  { id: "idle", label: "Idle" },
  { id: "wasted", label: "Wasted" },
]
/** Uncharged work has no Channel, so it gets one aggregate row per kind. */
export const AGGREGATE_ROW: Partial<Record<Kind, string>> = {
  probe: "Directory probes",
  handle: "Handle checks",
}

export const KIND_BY_SOURCE: Record<string, Kind> = {
  "Auto Sync (scheduler)": "auto",
  "Manual (Sync Selected)": "bulk",
  "Manual (Sync All)": "bulk",
  "Pre-Summary Sync": "bulk",
  "Discover bulk follow": "follow",
  "Manual (Single Sync)": "single",
  "Initial Sync": "single",
}
const BUDGET_BY_KIND: Partial<Record<Kind, string>> = {
  auto: "auto_sync",
  bulk: "manual_bulk",
  follow: "manual_bulk",
  single: "manual_single",
}

export interface Fact {
  day: string
  /** 0-23 on hour facts, null on Channel facts. */
  hour: number | null
  kind: Kind
  /** A Channel's name, an aggregate row's label, or null on hour facts. */
  channel: string | null
  /** The Account charged, or null for an Uncharged Request. */
  account: string | null
  outcome: Outcome
  requests: number
  /** On a 5-minute fact: the bucket's start, epoch ms. */
  at?: number
  /**
   * Real counts behind a Channel fact, on one fact per sync row so they add up once:
   * syncs (or handles probed), how many failed (or came back unavailable), new Posts.
   */
  stats?: Stats
}

export interface Stats {
  runs: number
  failed: number
  posts: number
}

export interface Model {
  since: string
  days: string[]
  accounts: { id: string; email: string; synthetic?: boolean }[]
  channelFacts: Fact[]
  hourFacts: Fact[]
  /** The last REQUEST_DAYS in 5-minute buckets, the grain each Request allows. */
  fineFacts: Fact[]
}

type Row = [string, ...unknown[]]
interface Raw {
  since: string
  ledger: [string, string, string, number][]
  accounts: [string, string][]
  probes: [string, number][]
  verdicts: [string, number, string, number][]
  channel_days: [string, string, string, string, boolean, number, number][]
  hours: [string, number, string, string, boolean, number, number][]
  fine_syncs: [number, string, string, boolean, number, number][]
  fine_probes: [number, string, number][]
}

export async function loadModel(days: number): Promise<Model> {
  const raw = await request<Raw>(`/proto/request-stats?days=${days}`)
  return synthesize(raw)
}

/** Deterministic noise, so a reload shows the same invented numbers. */
export function noise(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++)
    h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** A sync row's Requests by outcome, before scaling to the ledger. */
function weigh(
  n: number,
  posts: number,
  failed: boolean,
  zero: boolean,
): Record<Outcome, number> {
  // A failed sync: the attempt and its two retries told the app nothing.
  if (failed) return { useful: 0, idle: 0, wasted: n * 3 }
  // No new Posts: usually Idle, but the overlap page sometimes moves View counts.
  if (zero) return { useful: n * 0.25, idle: n * 0.75, wasted: 0 }
  const pages = n * (1 + Math.floor(posts / n / 20))
  return { useful: pages, idle: 0, wasted: pages * 0.03 }
}

export function synthesize(raw: Raw): Model {
  const days: string[] = []
  const today = new Date().toISOString().slice(0, 10)
  for (
    let d = new Date(`${raw.since}T00:00:00Z`);
    ;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.toISOString().slice(0, 10)
    if (day > today) break
    days.push(day)
  }

  // Each (day, Budget)'s ledger total and how it splits between Accounts.
  const ledger = new Map<string, Map<string, number>>()
  const spentByAccount = new Map<string, number>()
  for (const [day, user, budget, requests] of raw.ledger) {
    const key = `${day}|${budget}`
    const m = ledger.get(key) ?? new Map<string, number>()
    m.set(user, (m.get(user) ?? 0) + requests)
    ledger.set(key, m)
    spentByAccount.set(user, (spentByAccount.get(user) ?? 0) + requests)
  }
  const fallbackAccount =
    [...spentByAccount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "unknown"

  /** Scales one grain of sync rows (per Channel, or per hour) to the ledger. */
  /** Each (day, Budget)'s ledger scale, from the Channel grain, for the 5-minute one to reuse. */
  const scales = new Map<string, number>()
  function syncFacts(
    rows: {
      day: string
      hour: number | null
      channel: string | null
      source: string
      status: string
      zero: boolean
      n: number
      posts: number
      at?: number
    }[],
    reuseScales = false,
  ): Fact[] {
    const weighed = rows.map((r) => {
      const kind = KIND_BY_SOURCE[r.source] ?? "bulk"
      return {
        ...r,
        kind,
        w: weigh(r.n, r.posts, r.status === "failed", r.zero),
      }
    })
    const weightSum = new Map<string, number>()
    for (const r of weighed) {
      const key = `${r.day}|${BUDGET_BY_KIND[r.kind]}`
      weightSum.set(
        key,
        (weightSum.get(key) ?? 0) + r.w.useful + r.w.idle + r.w.wasted,
      )
    }
    const facts: Fact[] = []
    for (const r of weighed) {
      const key = `${r.day}|${BUDGET_BY_KIND[r.kind]}`
      const shares = ledger.get(key)
      const total = shares ? [...shares.values()].reduce((a, b) => a + b, 0) : 0
      // A day before the ledger started keeps the unscaled page estimate. The 5-minute grain
      // covers part of its first day, so it borrows the Channel grain's whole-day scale.
      const scale = reuseScales
        ? (scales.get(key) ?? 1)
        : total
          ? total / (weightSum.get(key) || 1)
          : 1
      if (!reuseScales) scales.set(key, scale)
      const split = shares
        ? [...shares.entries()].map(([a, v]) => [a, v / total] as const)
        : [[fallbackAccount, 1] as const]
      let stats: Stats | undefined = {
        runs: r.n,
        failed: r.status === "failed" ? r.n : 0,
        posts: r.posts,
      }
      for (const o of OUTCOMES)
        for (const [account, frac] of split) {
          const requests = r.w[o.id] * scale * frac
          if (requests > 0) {
            facts.push({
              day: r.day,
              hour: r.hour,
              kind: r.kind,
              channel: r.channel,
              account,
              outcome: o.id,
              requests,
              stats,
              ...(r.at !== undefined && { at: r.at }),
            })
            stats = undefined
          }
        }
    }
    return facts
  }

  const channelFacts = syncFacts(
    raw.channel_days.map(([day, channel, source, status, zero, n, posts]) => ({
      day,
      hour: null,
      channel,
      source,
      status,
      zero,
      n,
      posts,
    })),
  )
  // A ledger day no sync log covers (they are pruned after 30 days) is a daily total only:
  // its Budget and Account are known, its Channels and outcomes are not.
  const covered = new Set(
    channelFacts
      .filter((x) => x.account !== null)
      .map((x) => `${x.day}|${BUDGET_BY_KIND[x.kind]}`),
  )
  for (const [key, shares] of ledger) {
    if (covered.has(key)) continue
    const [day, budget] = key.split("|")
    const kind = (Object.entries(BUDGET_BY_KIND).find(
      ([k, b]) => b === budget && k !== "follow",
    )?.[0] ?? "bulk") as Kind
    for (const [account, requests] of shares)
      channelFacts.push({
        day,
        hour: null,
        kind,
        channel: null,
        account,
        outcome: "useful",
        requests,
      })
  }
  const hourlyFrom = days[Math.max(0, days.length - HOURLY_DAYS)]
  const hourFacts = syncFacts(
    raw.hours.map(([day, hour, source, status, zero, n, posts]) => ({
      day,
      hour,
      channel: null,
      source,
      status,
      zero,
      n,
      posts,
    })),
  )
  const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const fineFacts = syncFacts(
    raw.fine_syncs.map(([at, source, status, zero, n, posts]) => ({
      day: utcDay(at),
      hour: null,
      channel: null,
      source,
      status,
      zero,
      n,
      posts,
      at,
    })),
    true,
  )

  // Probes: the real daily total, spread over the hours the Directory's verdicts landed in.
  const verdicts = new Map<
    string,
    { hours: number[]; total: number; missing: number }
  >()
  for (const [day, hour, status, count] of raw.verdicts) {
    const v = verdicts.get(day) ?? {
      hours: Array(24).fill(0),
      total: 0,
      missing: 0,
    }
    v.hours[hour] += count
    v.total += count
    if (status === "unavailable") v.missing += count
    verdicts.set(day, v)
  }
  for (const [day, requests] of raw.probes) {
    const v = verdicts.get(day)
    const wasted = v?.total ? v.missing / v.total : 0.25
    const push = (hour: number | null, channel: string | null, r: number) => {
      // Handles probed and found unavailable are the Directory's latest verdicts that day.
      const stats =
        hour === null && v
          ? { runs: v.total, failed: v.missing, posts: 0 }
          : undefined
      channelOrHour(hour).push(
        {
          day,
          hour,
          kind: "probe",
          channel,
          account: null,
          outcome: "useful",
          requests: r * (1 - wasted),
          stats,
        },
        {
          day,
          hour,
          kind: "probe",
          channel,
          account: null,
          outcome: "wasted",
          requests: r * wasted,
        },
      )
    }
    push(null, AGGREGATE_ROW.probe ?? null, requests)
    if (day >= hourlyFrom)
      for (let h = 0; h < 24; h++)
        push(
          h,
          null,
          v?.total ? (requests * v.hours[h]) / v.total : requests / 24,
        )
  }

  // Probes in 5-minute buckets: each verdict is a probe, priced at that day's real
  // Requests per verdict (retries and redirects make it more than one).
  const probeDay = new Map(raw.probes)
  for (const [at, status, count] of raw.fine_probes) {
    const day = utcDay(at)
    const perVerdict =
      (probeDay.get(day) ?? 0) / (verdicts.get(day)?.total || 1)
    if (!perVerdict) continue
    fineFacts.push({
      day,
      hour: null,
      at,
      kind: "probe",
      channel: null,
      account: null,
      outcome: status === "ok" ? "useful" : "wasted",
      requests: count * perVerdict,
    })
  }

  // Handle checks: counted nowhere today, so wholly invented.
  for (const day of days) {
    const n = Math.round(12 + noise(day) * 30)
    for (let i = 0; i < n; i++) {
      const hour = 8 + Math.floor(noise(`${day}#${i}`) * 16)
      const outcome: Outcome = noise(`${day}!${i}`) < 0.3 ? "wasted" : "useful"
      const base = {
        day,
        kind: "handle" as const,
        account: null,
        outcome,
        requests: 1,
      }
      channelFacts.push({
        ...base,
        hour: null,
        channel: AGGREGATE_ROW.handle ?? null,
        stats: { runs: 1, failed: outcome === "wasted" ? 1 : 0, posts: 0 },
      })
      if (day >= hourlyFrom) hourFacts.push({ ...base, hour, channel: null })
      const at =
        Date.parse(`${day}T00:00:00Z`) +
        hour * 3_600_000 +
        Math.floor(noise(`${day}@${i}`) * 12) * 300_000
      if (at >= Date.now() - REQUEST_DAYS * 86_400_000)
        fineFacts.push({ ...base, hour: null, channel: null, at })
    }
  }

  function channelOrHour(hour: number | null) {
    return hour === null ? channelFacts : hourFacts
  }

  const accounts: Model["accounts"] = raw.accounts.map(([id, email]) => ({
    id,
    email,
  }))
  if (accounts.length < 2)
    splitAcrossSyntheticAccounts(accounts, channelFacts, hourFacts, fineFacts)
  return {
    since: raw.since,
    days,
    accounts,
    channelFacts,
    hourFacts,
    fineFacts,
  }
}

/**
 * A deployment with one Account has nobody to compare. Three synthetic Accounts take
 * over some Channels: each Channel stays charged to exactly one Account (as a real sync
 * is), so every total stays real and only who pays is invented. Hour facts carry no
 * Channel, so they split by each (day, kind)'s Account shares from the Channel facts.
 */
function splitAcrossSyntheticAccounts(
  accounts: Model["accounts"],
  channelFacts: Fact[],
  ...grains: Fact[][]
) {
  const real = accounts[0]?.id ?? "unknown"
  const extra = [
    {
      id: "synthetic-newsroom",
      email: "newsroom@example.com",
      synthetic: true,
    },
    {
      id: "synthetic-research",
      email: "research@example.com",
      synthetic: true,
    },
    {
      id: "synthetic-bulk",
      email: "bulk-follower@example.com",
      synthetic: true,
    },
  ]
  accounts.push(...extra)
  // Cumulative odds per kind: the bulk follower does most manual bulk work and Follows.
  const odds: Partial<Record<Kind, number[]>> = {
    auto: [0.45, 0.75, 0.92, 1],
    bulk: [0.3, 0.4, 0.5, 1],
    follow: [0.15, 0.2, 0.25, 1],
    single: [0.5, 0.8, 0.95, 1],
  }
  const ids = [real, ...extra.map((a) => a.id)]
  const pick = (channel: string, kind: Kind) => {
    const r = noise(`${channel}~${kind === "auto" ? "auto" : "manual"}`)
    return ids[(odds[kind] ?? [1]).findIndex((c) => r < c)] ?? real
  }
  const shares = new Map<string, Map<string, number>>()
  for (const x of channelFacts) {
    if (x.account === null || x.channel === null) continue
    x.account = pick(x.channel, x.kind)
    const key = `${x.day}|${x.kind}`
    const m = shares.get(key) ?? new Map<string, number>()
    m.set(x.account, (m.get(x.account) ?? 0) + x.requests)
    shares.set(key, m)
  }
  for (const facts of grains) {
    const split: Fact[] = []
    for (const x of facts) {
      const m =
        x.account === null ? undefined : shares.get(`${x.day}|${x.kind}`)
      if (!m) {
        split.push(x)
        continue
      }
      const total = [...m.values()].reduce((a, b) => a + b, 0)
      for (const [account, v] of m)
        split.push({ ...x, account, requests: (x.requests * v) / total })
    }
    facts.splice(0, facts.length, ...split)
  }
}

/**
 * The model cut to [start, end), to the minute the range was picked at. An hourly or
 * 5-minute fact an edge cuts keeps the share of its span inside. A daily fact on a day an
 * edge cuts keeps the share of that day's Requests of its kind the hourly facts put inside,
 * or, before the hourly tier, the share of the day's hours inside. Its sync counts shrink
 * with it, so per-sync and per-Post measures stay in proportion.
 */
export function clipToRange(
  m: Model,
  start: number | undefined,
  end: number | undefined,
): Model {
  if (start === undefined && end === undefined) return m
  const lo = start ?? Number.NEGATIVE_INFINITY
  const hi = end ?? Number.POSITIVE_INFINITY
  const HOUR_MS = 3_600_000
  const inside = (t: number, span: number) =>
    Math.max(0, Math.min(hi, t + span) - Math.max(lo, t)) / span
  const shrink = (x: Fact, f: number): Fact[] =>
    f >= 1
      ? [x]
      : f <= 0
        ? []
        : [
            {
              ...x,
              requests: x.requests * f,
              ...(x.stats && {
                stats: {
                  runs: x.stats.runs * f,
                  failed: x.stats.failed * f,
                  posts: x.stats.posts * f,
                },
              }),
            },
          ]
  const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
  const hourAt = (x: Fact) => dayMs(x.day) + (x.hour ?? 0) * HOUR_MS
  const share = new Map<string, [number, number]>()
  for (const x of m.hourFacts) {
    const k = `${x.day}|${x.kind}`
    const s = share.get(k) ?? [0, 0]
    s[0] += x.requests * inside(hourAt(x), HOUR_MS)
    s[1] += x.requests
    share.set(k, s)
  }
  return {
    ...m,
    channelFacts: m.channelFacts.flatMap((x) => {
      const whole = inside(dayMs(x.day), 24 * HOUR_MS)
      if (whole >= 1 || whole <= 0) return shrink(x, whole)
      const s = share.get(`${x.day}|${x.kind}`)
      return shrink(x, s?.[1] ? s[0] / s[1] : whole)
    }),
    hourFacts: m.hourFacts.flatMap((x) =>
      shrink(x, inside(hourAt(x), HOUR_MS)),
    ),
    fineFacts: m.fineFacts.flatMap((x) =>
      x.at === undefined ? [x] : shrink(x, inside(x.at, 5 * 60_000)),
    ),
  }
}

/**
 * The model narrowed to the Channels picked; `off` holds the rows left out, an aggregate
 * row ("Directory probes", "Handle checks") standing for its whole kind. Channel facts
 * drop the rest. The hourly and 5-minute grains carry no Channel in the prototype's data,
 * so they are scaled by the picked share of their day and kind (the recorded hourly
 * totals and Requests will carry the Channel), as are ledger-only days, by the kind's
 * picked share over the whole range.
 */
export function pickChannels(m: Model, off: ReadonlySet<string>): Model {
  if (!off.size) return m
  const all = new Map<string, number>()
  const kept = new Map<string, number>()
  const add = (map: Map<string, number>, k: string, v: number) =>
    map.set(k, (map.get(k) ?? 0) + v)
  for (const x of m.channelFacts) {
    if (x.channel === null) continue
    for (const k of [`${x.day}|${x.kind}`, x.kind]) {
      add(all, k, x.requests)
      if (!off.has(x.channel)) add(kept, k, x.requests)
    }
  }
  const share = (k: string) => {
    const a = all.get(k)
    return a ? (kept.get(k) ?? 0) / a : undefined
  }
  const scale = (x: Fact) => {
    const s = share(`${x.day}|${x.kind}`) ?? share(x.kind) ?? 1
    return s === 1 ? [x] : s === 0 ? [] : [{ ...x, requests: x.requests * s }]
  }
  return {
    ...m,
    channelFacts: m.channelFacts.flatMap((x) =>
      x.channel === null ? scale(x) : off.has(x.channel) ? [] : [x],
    ),
    hourFacts: m.hourFacts.flatMap(scale),
    fineFacts: m.fineFacts.flatMap(scale),
  }
}

export interface Filter {
  /** Inclusive UTC days. */
  from: string
  to: string
  /** The range to the minute, [start, end), within the loaded days. */
  start: number
  end: number
  /** Empty means every Account. Picking any hides Uncharged Requests: nobody pays them. */
  accounts: string[]
  /** Which layers to count. At least one is always on. */
  charged: boolean
  uncharged: boolean
}

export function applyFilter(facts: Fact[], f: Filter): Fact[] {
  return facts.filter(
    (x) =>
      x.day >= f.from &&
      x.day <= f.to &&
      (x.account === null ? f.uncharged && !f.accounts.length : f.charged) &&
      (!f.accounts.length ||
        (x.account !== null && f.accounts.includes(x.account))),
  )
}

export interface Tally {
  total: number
  useful: number
  idle: number
  wasted: number
  charged: number
  uncharged: number
}
export const emptyTally = (): Tally => ({
  total: 0,
  useful: 0,
  idle: 0,
  wasted: 0,
  charged: 0,
  uncharged: 0,
})

function add(t: Tally, x: Fact) {
  t.total += x.requests
  t[x.outcome] += x.requests
  if (x.account === null) t.uncharged += x.requests
  else t.charged += x.requests
}

export function tally(facts: Fact[]): Tally {
  const t = emptyTally()
  for (const x of facts) add(t, x)
  return t
}

export function groupBy<K extends string>(
  facts: Fact[],
  key: (x: Fact) => K,
): Map<K, Tally> {
  const m = new Map<K, Tally>()
  for (const x of facts) {
    const k = key(x)
    const t = m.get(k) ?? emptyTally()
    add(t, x)
    m.set(k, t)
  }
  return m
}

export type KindTally = Tally & Stats

export interface ChannelRow extends KindTally {
  channel: string
  /** Set on the aggregate rows that stand for Uncharged work. */
  aggregate: boolean
  /** The kind that spent most on this row. */
  mainKind: Kind
  kinds: Map<Kind, number>
  /** The same numbers for each kind of work on this row. */
  perKind: Map<Kind, KindTally>
}

const emptyKindTally = (): KindTally => ({
  ...emptyTally(),
  runs: 0,
  failed: 0,
  posts: 0,
})

/**
 * One row per Channel. A hidden outcome's Requests stay out of the tallies, but the
 * real counts in `stats` still add up: a sync happened whether or not its Requests show.
 */
export function channelRows(
  facts: Fact[],
  hiddenOutcomes: ReadonlySet<Outcome> = new Set(),
): ChannelRow[] {
  const rows = new Map<string, ChannelRow>()
  for (const x of facts) {
    if (x.channel === null) continue
    const r =
      rows.get(x.channel) ??
      ({
        ...emptyKindTally(),
        channel: x.channel,
        aggregate: x.account === null,
        mainKind: x.kind,
        kinds: new Map(),
        perKind: new Map(),
      } as ChannelRow)
    const k = r.perKind.get(x.kind) ?? emptyKindTally()
    for (const t of [r, k]) {
      if (!hiddenOutcomes.has(x.outcome)) add(t, x)
      if (x.stats) {
        t.runs += x.stats.runs
        t.failed += x.stats.failed
        t.posts += x.stats.posts
      }
    }
    if (!hiddenOutcomes.has(x.outcome))
      r.kinds.set(x.kind, (r.kinds.get(x.kind) ?? 0) + x.requests)
    r.perKind.set(x.kind, k)
    rows.set(x.channel, r)
  }
  const shown = [...rows.values()].filter((r) => r.total > 0)
  for (const r of shown)
    r.mainKind = [...r.kinds.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return shown.sort((a, b) => b.total - a.total)
}

/**
 * One point per day of the range from the daily totals, or per hour of one day from the
 * hourly ones, which reach back only HOURLY_DAYS.
 */
export function trend(
  hourFacts: Fact[],
  dayFacts: Fact[],
  f: Filter,
  days: string[],
) {
  const hourly = f.from === f.to
  const keys = hourly
    ? Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))
    : days.filter((d) => d >= f.from && d <= f.to)
  const points = new Map(
    keys.map((k) => [
      k,
      {
        x: k,
        total: 0,
        charged: 0,
        uncharged: 0,
        useful: 0,
        idle: 0,
        wasted: 0,
        ...Object.fromEntries(KINDS.map((k) => [k.id, 0])),
      } as Record<string, number | string>,
    ]),
  )
  for (const x of applyFilter(hourly ? hourFacts : dayFacts, f)) {
    const p = points.get(hourly ? String(x.hour).padStart(2, "0") : x.day)
    if (!p) continue
    for (const k of [
      "total",
      x.kind,
      x.outcome,
      x.account === null ? "uncharged" : "charged",
    ])
      p[k] = (p[k] as number) + x.requests
  }
  return { hourly, points: [...points.values()] }
}

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US")
export const pct = (part: number, whole: number) =>
  whole
    ? `${((100 * part) / whole).toFixed(part / whole < 0.1 ? 1 : 0)}%`
    : "0%"
