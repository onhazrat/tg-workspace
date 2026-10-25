// PROTOTYPE: an Artifact's Missing Posts, counted in the browser. Never merge.
//
// The real count is made once, on the server, when the prompt is built
// (ADR-038). Here the browser looks every Covered Post up instead: the lookup
// reads through the Follow-scoped seam, so a Post retention reclaimed and a
// Post of a Channel the Account no longer follows both fail to come back,
// which is exactly a Missing Post.
//
// `?missing=N` fakes the count, so a note can be seen on any Artifact.
import { useQuery } from "@tanstack/react-query"
import { CircleAlert } from "lucide-react"
import { useState } from "react"
import { api } from "@/api"
import type { ScopedPostRef } from "@/client"
import { useCoverageVariant } from "./variant"

const BATCH = 200
const PARALLEL = 4
// ponytail: a prototype cap; the real count is free at prompt time.
const MAX_REFS = 20_000

type Refs = ScopedPostRef[] | null | undefined

type ChannelCount = { channel: string; covered: number; missing: number }

export type Missing = {
  covered: number
  missing: number
  byChannel: ChannelCount[]
}

const keyOf = (channel: string, id: number) => `${channel.toLowerCase()}#${id}`

async function countMissing(refs: ScopedPostRef[]): Promise<Missing> {
  const capped = refs.slice(0, MAX_REFS)
  const batches: ScopedPostRef[][] = []
  for (let i = 0; i < capped.length; i += BATCH)
    batches.push(capped.slice(i, i + BATCH))
  const found = new Set<string>()
  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]
      for (const p of await api.lookupPosts(batch))
        found.add(keyOf(p.channelName, p.id))
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  const channels = new Map<string, ChannelCount>()
  for (const ref of capped) {
    const row = channels.get(ref.channelName) ?? {
      channel: ref.channelName,
      covered: 0,
      missing: 0,
    }
    row.covered += 1
    if (!found.has(keyOf(ref.channelName, ref.postId))) row.missing += 1
    channels.set(ref.channelName, row)
  }
  const byChannel = [...channels.values()].sort(
    (a, b) => b.missing - a.missing || b.covered - a.covered,
  )
  return {
    covered: capped.length,
    missing: byChannel.reduce((n, c) => n + c.missing, 0),
    byChannel,
  }
}

/** `?missing=N`: the same Covered Posts, with N of them, Channel by Channel, missing. */
function fakeCount(): number | null {
  // The router writes it back JSON-quoted: `?missing="40"`.
  const raw = new URLSearchParams(window.location.search)
    .get("missing")
    ?.replaceAll('"', "")
  return raw != null && /^\d+$/.test(raw) ? Number(raw) : null
}

function faked(real: Missing): Missing {
  const raw = fakeCount()
  if (raw == null) return real
  let left = Math.min(raw, real.covered)
  const byChannel = real.byChannel.map((c) => {
    const missing = Math.min(left, c.covered)
    left -= missing
    return { ...c, missing }
  })
  return { ...real, missing: Math.min(raw, real.covered), byChannel }
}

export function useMissingPosts(refs: Refs): Missing | null {
  const variant = useCoverageVariant()
  const { data } = useQuery({
    queryKey: [
      "prototype-missing",
      refs?.length,
      refs?.[0]?.channelName,
      refs?.[0]?.postId,
      refs?.at(-1)?.postId,
    ],
    queryFn: () => countMissing(refs ?? []),
    enabled: variant !== "0" && !!refs?.length,
    staleTime: Number.POSITIVE_INFINITY,
  })
  if (data) return faked(data)
  // No refs on record (no Chat or Tag run on staging has any yet): `?missing=`
  // still shows the note, over a made-up Channel.
  if (variant !== "0" && !refs?.length && fakeCount() != null) {
    const n = fakeCount() as number
    return {
      covered: n * 4,
      missing: n,
      byChannel: [{ channel: "example_channel", covered: n * 4, missing: n }],
    }
  }
  return null
}

const posts = (n: number) =>
  `${n.toLocaleString()} Covered Post${n === 1 ? "" : "s"}`

const WHY =
  "Retention reclaimed them, or you no longer follow their Channel. They are still listed as covered; the prompt left them out."

/** Variant 1: one line beside what the prompt produced. */
export function MissingLine({
  refs,
  className = "",
}: {
  refs: Refs
  className?: string
}) {
  const variant = useCoverageVariant()
  const m = useMissingPosts(refs)
  if (variant !== "1" || !m?.missing) return null
  return (
    <p
      className={`flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 ${className}`}
      title={WHY}
    >
      <CircleAlert size={13} className="mt-px shrink-0" />
      <span>
        {posts(m.missing)} {m.missing === 1 ? "is" : "are"} missing and{" "}
        {m.missing === 1 ? "was" : "were"} left out of the prompt.
      </span>
    </p>
  )
}

/** Variant 2: a count beside the Scope's other numbers, explained on tap. */
export function MissingChip({ refs }: { refs: Refs }) {
  const variant = useCoverageVariant()
  const m = useMissingPosts(refs)
  const [open, setOpen] = useState(false)
  if (variant !== "2" || !m?.missing) return null
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] text-amber-800 underline decoration-dotted underline-offset-2 dark:text-amber-300"
      >
        {m.missing.toLocaleString()} missing
      </button>
      {open && (
        <span className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-app-ink/10 bg-app-card p-3 text-xs font-sans text-app-ink/80 shadow-lg">
          {posts(m.missing)} of {m.covered.toLocaleString()} are missing. {WHY}
        </span>
      )}
    </span>
  )
}

/** Variant 3: where they are missing from, Channel by Channel. */
export function MissingByChannel({
  refs,
  className = "",
}: {
  refs: Refs
  className?: string
}) {
  const variant = useCoverageVariant()
  const m = useMissingPosts(refs)
  const [open, setOpen] = useState(false)
  if (variant !== "3" || !m?.missing) return null
  const rows = m.byChannel.filter((c) => c.missing)
  return (
    <section
      className={`rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left text-xs font-bold text-amber-800 dark:text-amber-300"
      >
        <CircleAlert size={13} className="shrink-0" />
        {posts(m.missing)} missing from the prompt, in{" "}
        {rows.length.toLocaleString()} Channel{rows.length === 1 ? "" : "s"}
        <span className="ml-auto font-normal text-app-ink/50">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <>
          <p className="mt-2 text-xs text-app-ink/60">{WHY}</p>
          <ul className="mt-2 space-y-1">
            {rows.map((c) => (
              <li
                key={c.channel}
                className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-xs"
              >
                <span className="truncate font-mono">{c.channel}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-app-ink/10">
                  <span
                    className="block h-full bg-amber-500"
                    style={{ width: `${(100 * c.missing) / c.covered}%` }}
                  />
                </span>
                <span className="font-mono text-app-ink/60">
                  {c.missing} of {c.covered}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
