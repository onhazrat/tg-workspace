// PROTOTYPE (find-prototype): throwaway, never merge. Shared bits of the Find tab.
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Check, ExternalLink, Eye, Loader2, Plus } from "lucide-react"
import { createContext, useContext, useEffect, useState } from "react"
import { headers } from "@/api/base"
import { renderPostText } from "@/lib/posts/render-post-text"
import { scopedStorage } from "@/lib/storage/scoped"

export type Entry = {
  handle: string
  display_name: string | null
  bio: string | null
  subscribers: number | null
  photo_url: string | null
  language: string | null
  posts_per_week: number | null
  last_post_at: string | null
  reach: number | null
  following?: boolean
}

export type Sample = {
  post_id: number
  text: string
  timestamp: number
  has_media: boolean
  /** Views when the Directory captured the Post, from `media.viewsCount`. */
  views: number | null
  captured_at?: string
  /**
   * Every Link the Directory saw on the Post, but with no position in the
   * text, so the renderer cannot place one that hides behind other words.
   */
  links?: { url: string; channel?: string }[] | null
}

export type Via = { channelName: string; postId: number; timestamp: number }

async function protoFetch<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`/proto${path}`, {
    method,
    signal,
    headers: headers(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

export const protoPost = (path: string, method = "POST") =>
  protoFetch(path, method)

/** GET `path`, or POST it with `body` when one is given. */
export function useProto<T>(
  path: string | null,
  keepPrevious = false,
  body?: unknown,
) {
  return useQuery({
    queryKey: ["proto", path, body],
    // Taking the signal lets React Query abort a request nobody is waiting
    // for any more, such as a search superseded by the next keystroke.
    queryFn: ({ signal }) =>
      protoFetch<T>(
        path as string,
        body === undefined ? "GET" : "POST",
        body,
        signal,
      ),
    enabled: path !== null,
    staleTime: 5 * 60_000,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  })
}

/**
 * useState that survives a reload and a workspace tab switch, per account.
 * An object value is merged over `initial`, so a field added later starts at
 * its default rather than undefined.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const slot = `findPrototype:${key}`
  const [value, setValue] = useState<T>(() => {
    const raw = scopedStorage.getItem(slot)
    if (raw == null) return initial
    try {
      const parsed = JSON.parse(raw) as T
      return isPlainObject(initial) && isPlainObject(parsed)
        ? { ...initial, ...parsed }
        : parsed
    } catch {
      return initial
    }
  })
  useEffect(() => {
    scopedStorage.setItem(slot, JSON.stringify(value))
  }, [slot, value])
  return [value, setValue] as const
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// --- follow ------------------------------------------------------------------

type FollowState = "pending" | "done" | "error"
export const FollowCtx = createContext<{
  state: (handle: string) => FollowState | undefined
  follow: (handle: string, via?: Via) => void
  /** One job for many Channels, as Discover's bulk follow runs. */
  followMany: (handles: string[]) => Promise<void>
}>({ state: () => undefined, follow: () => {}, followMany: async () => {} })

export function FollowButton({
  handle,
  via,
  size = "md",
}: {
  handle: string
  via?: Via
  size?: "sm" | "md"
}) {
  const { state, follow } = useContext(FollowCtx)
  const s = state(handle)
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1.5 text-xs"
  if (s === "done")
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-emerald-600/15 font-semibold text-emerald-600 ${pad}`}
      >
        <Check size={12} /> Following
      </span>
    )
  return (
    <button
      type="button"
      disabled={s === "pending"}
      onClick={(e) => {
        e.stopPropagation()
        follow(handle, via)
      }}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-app-ink font-semibold text-app-bg hover:opacity-85 disabled:opacity-50 ${pad}`}
    >
      {s === "pending" ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Plus size={12} />
      )}
      {s === "error" ? "Retry" : "Follow"}
    </button>
  )
}

// --- display -----------------------------------------------------------------

export function Avatar({
  entry,
  size = 40,
}: {
  entry: Pick<Entry, "handle" | "display_name" | "photo_url">
  size?: number
}) {
  const [broken, setBroken] = useState(false)
  const label = (entry.display_name || entry.handle).trim()
  const hue = [...entry.handle].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  if (entry.photo_url && !broken)
    return (
      <img
        src={entry.photo_url}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    )
  return (
    <span
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 45% 45%)`,
        fontSize: size * 0.4,
      }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {[...label][0]?.toUpperCase()}
    </span>
  )
}

export function fmt(n: number | null | undefined) {
  if (n == null) return "?"
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
  return String(n)
}

export function ago(ms: number | string | null | undefined) {
  if (ms == null) return ""
  const t = typeof ms === "string" ? Date.parse(`${ms}Z`) : ms
  const d = (Date.now() - t) / 1000
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}m ago`
  if (d < 86400) return `${Math.round(d / 3600)}h ago`
  if (d < 86400 * 60) return `${Math.round(d / 86400)}d ago`
  return `${Math.round(d / 86400 / 30)}mo ago`
}

/** Renders `«match»` spans from ts_headline as marks. */
export function Highlight({ text }: { text: string }) {
  return (
    <>
      {text.split(/(«[^»]*»)/).map((part, i) =>
        part.startsWith("«") ? (
          <mark key={i} className="rounded bg-amber-300/60 px-0.5 text-inherit">
            {part.slice(1, -1)}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

export function Stats({ entry }: { entry: Entry }) {
  return (
    <span className="font-mono text-[11px] text-app-ink/50">
      {fmt(entry.subscribers)} subs
      {entry.language && <> · {entry.language}</>}
      {entry.posts_per_week != null && (
        <>
          {" "}
          · {entry.posts_per_week.toFixed(entry.posts_per_week < 10 ? 1 : 0)}/wk
        </>
      )}
      {entry.last_post_at && <> · last post {ago(entry.last_post_at)}</>}
    </span>
  )
}

export function TelegramLink({
  handle,
  post,
}: {
  handle: string
  post?: number
}) {
  return (
    <a
      href={`https://t.me/s/${handle}${post ? `/${post}` : ""}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-0.5 text-app-ink/40 hover:text-app-ink"
      title="Open the public web view"
    >
      <ExternalLink size={12} />
    </a>
  )
}

/** Posts the full list shows before "Show more". */
const FIRST_POSTS = 3
/** A post longer than this is clamped to a few lines until "Read more". */
const LONG_POST = 280

/**
 * A Channel's stored sample Posts: the newest `n` as a short preview, or (no
 * `n`) every stored one, collapsed to the first few with a "Show more".
 */
export function SampleList({ handle, n }: { handle: string; n?: number }) {
  const { data, isLoading } = useProto<{ samples: Sample[] }>(
    `/entry/${handle}`,
  )
  // Keyed on the handle, so opening another Channel starts collapsed again.
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  if (isLoading)
    return <p className="text-xs text-app-ink/40">Loading recent posts…</p>
  const all = data?.samples ?? []
  const preview = n !== undefined
  const expanded = expandedFor === handle
  const samples = preview
    ? all.filter((s) => s.text).slice(0, n)
    : expanded
      ? all
      : all.slice(0, FIRST_POSTS)
  if (!samples.length)
    return <p className="text-xs text-app-ink/40">No sample posts stored.</p>
  const hidden = all.length - samples.length
  return (
    <>
      {!preview && (
        <p className="mb-2 font-mono text-[10px] text-app-ink/40">
          {all.length} stored post{all.length === 1 ? "" : "s"}, newest first
        </p>
      )}
      <ul className="space-y-2">
        {samples.map((s) => (
          <li
            key={s.post_id}
            dir="auto"
            className="rounded-md border border-app-ink/10 bg-app-ink/5 p-2 text-xs leading-relaxed text-app-ink/80"
          >
            {s.text ? (
              preview ? (
                <span className="whitespace-pre-line">
                  {renderPostText(s.text.slice(0, 300), "")}
                  {s.text.length > 300 && "…"}
                </span>
              ) : (
                <PostText text={s.text} />
              )
            ) : (
              <span className="text-app-ink/40 italic">
                media only, no text
              </span>
            )}
            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-app-ink/40">
              {ago(s.timestamp)}
              {s.views != null && (
                <span
                  title={`${s.views.toLocaleString()} views${s.captured_at ? `, counted ${ago(s.captured_at)}` : ""}`}
                  className="inline-flex items-center gap-0.5"
                >
                  · <Eye size={10} /> {fmt(s.views)}
                </span>
              )}
              {s.has_media && s.text && <span>· has media</span>}
              <TelegramLink handle={handle} post={s.post_id} />
            </div>
            {!preview && <HiddenLinks text={s.text} links={s.links} />}
          </li>
        ))}
      </ul>
      {!preview && all.length > FIRST_POSTS && (
        <button
          type="button"
          onClick={() => setExpandedFor(expanded ? null : handle)}
          className="mt-2 w-full rounded-md border border-app-ink/15 py-1.5 text-xs text-app-ink/70 hover:bg-app-ink/5"
        >
          {expanded
            ? "Show fewer"
            : `Show ${hidden} more post${hidden === 1 ? "" : "s"}`}
        </button>
      )}
    </>
  )
}

/**
 * The Links a Post carries that its visible text does not show (a "click
 * here" anchor, a button), since those are the ones the renderer cannot find.
 */
function HiddenLinks({
  text,
  links,
}: {
  text: string
  links?: Sample["links"]
}) {
  const seen = new Set<string>()
  const lower = text.toLowerCase()
  const hidden = (Array.isArray(links) ? links : []).filter((l) => {
    const bare = l.url
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .toLowerCase()
    const shown =
      lower.includes(bare) ||
      (l.channel ? lower.includes(`@${l.channel.toLowerCase()}`) : false)
    if (shown || seen.has(l.url)) return false
    seen.add(l.url)
    return true
  })
  if (!hidden.length) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {hidden.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          title={l.url}
          className="max-w-full truncate rounded bg-app-ink/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-600 hover:underline dark:text-sky-400"
        >
          {l.url.replace(/^https?:\/\//, "")}
        </a>
      ))}
    </div>
  )
}

/** One post's text, clamped to six lines with "Read more" when it is long. */
export function PostText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > LONG_POST || text.split("\n").length > 6
  return (
    <>
      <p
        className={`whitespace-pre-line ${long && !open ? "line-clamp-6" : ""}`}
      >
        {renderPostText(text, "")}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-0.5 text-[11px] font-semibold text-app-ink/60 hover:text-app-ink"
        >
          {open ? "Less" : "Read more"}
        </button>
      )}
    </>
  )
}
