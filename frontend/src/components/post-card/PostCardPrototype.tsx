/**
 * PROTOTYPE (post-card): the redesigned post card plus a temporary
 * "only this Channel" focus, switchable via `?variant=` on `/workspace?tab=posts`.
 *
 *   A        card with an always-visible action footer, photo above the text
 *            opening the viewer in PhotoZoomPrototype
 *   current  the card as it ships today, for comparison
 *
 * Tried and dropped: B timeline rows, C reader, and four other photo zoom
 * behaviours (plain lightbox, grow-in-card, zoom-only, gallery-only).
 *
 * Every variant keeps every capability of the shipped card: avatar, channel
 * link, post id link, reply ref, forward source (+ add when unfollowed), time,
 * translate, find related, copy link, open in Telegram, media badges, views,
 * thumbnail, long-post collapse, search highlight. New: reactions, and the
 * channel focus. Throwaway; see the plan comment above.
 */
import {
  ArrowLeft,
  Copy,
  CornerUpLeft,
  ExternalLink,
  Eye,
  Filter,
  Hash,
  Keyboard,
  Languages,
  LayoutGrid,
  PlusCircle,
  Repeat2,
  Sparkles,
} from "lucide-react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import type { ChannelFocus } from "@/hooks/usePostsView"
import { formatCount } from "@/lib/format-count"
import { renderPostText } from "@/lib/posts/render-post-text"
import {
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { cn, highlightText } from "@/lib/utils"
import type { Post } from "@/types"
import { useData } from "../../contexts/DataContext"
import { useScraper } from "../../contexts/ScraperContext"
import { useSettings } from "../../contexts/SettingsContext"
import { ChannelAvatar } from "../ChannelAvatar"
import { pillClass } from "../PostFilterParts"
import { usePrototypeVariant } from "../PrototypeSwitcher"
import { RelativeTime } from "../RelativeTime"
import { ZoomablePhoto } from "./PhotoZoomPrototype"
import { PostCardBody } from "./PostCardBody"
import { PostCardMedia } from "./PostCardMedia"
import { SelectBox, useIsPostSelected } from "./PostSelectionPrototype"
import { postTime } from "./post-card-model"
import { usePostTranslation } from "./usePostTranslation"

export const CARD_VARIANTS = [
  { key: "A", name: "Card + footer, photo viewer" },
  { key: "A-plus", name: "A + toggles: compact grid, keyboard" },
  { key: "A-plus-menu", name: "A-plus, Filters menu like Channels" },
  {
    key: "A-plus-select",
    name: "A-plus-menu, Channels facets, filter row, selection",
  },
  { key: "current", name: "Shipped today" },
] as const
const CARD_VARIANT_KEYS = CARD_VARIANTS.map((v) => v.key)

export function useCardVariant(): string {
  return usePrototypeVariant(CARD_VARIANT_KEYS)
}

// ---------------------------------------------------------------------------
// A-plus: the Account switches compact grid and keyboard on and off.

type FeedPrefs = {
  compact: boolean
  keys: boolean
  /**
   * A-plus-* views "between": the server takes one bound, so the upper one is
   * applied to the loaded pages in the browser. ponytail: a `viewsMax` on the
   * Scope is the real fix; until then counts ignore it.
   */
  viewsMax: number | null
}
const FeedPrefsContext = createContext<
  FeedPrefs & { set: (p: Partial<FeedPrefs>) => void }
>({ compact: false, keys: false, viewsMax: null, set: () => {} })
export const useFeedPrefs = () => useContext(FeedPrefsContext)

// ponytail: in memory, so a reload resets both; scopedStorage once one ships.
export function FeedPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<FeedPrefs>({
    compact: false,
    keys: false,
    viewsMax: null,
  })
  const value = useMemo(
    () => ({
      ...prefs,
      set: (p: Partial<FeedPrefs>) => setPrefs((o) => ({ ...o, ...p })),
    }),
    [prefs],
  )
  return (
    <FeedPrefsContext.Provider value={value}>
      {children}
    </FeedPrefsContext.Provider>
  )
}

/** Whether the feed is a compact grid and answers the keyboard, per variant. */
export function useFeedMode(): { compact: boolean; keys: boolean } {
  const variant = useCardVariant()
  const prefs = useContext(FeedPrefsContext)
  const plus = variant.startsWith("A-plus")
  return { compact: plus && prefs.compact, keys: plus && prefs.keys }
}

export function FeedModeToggles() {
  const prefs = useContext(FeedPrefsContext)
  if (!useCardVariant().startsWith("A-plus")) return null
  // The filter bar's own pill look; the first one pushes both to the row's end.

  return (
    <>
      <button
        type="button"
        aria-pressed={prefs.compact}
        onClick={() => prefs.set({ compact: !prefs.compact })}
        className={cn(pillClass(prefs.compact), "ml-auto")}
      >
        <LayoutGrid size={12} /> Compact grid
      </button>
      <button
        type="button"
        aria-pressed={prefs.keys}
        onClick={() => prefs.set({ keys: !prefs.keys })}
        className={pillClass(prefs.keys)}
        title="j / k to move, action letters on the selected post"
      >
        <Keyboard size={12} /> Keyboard
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Channel focus: state lives in PostFeed, cards reach it through context.

type FocusApi = {
  focus: ChannelFocus | null
  enter: (post: Post, channel?: string) => void
  exit: () => void
  setKeepFilters: (keep: boolean) => void
}
const FocusContext = createContext<FocusApi>({
  focus: null,
  enter: () => {},
  exit: () => {},
  setKeepFilters: () => {},
})
export const useChannelFocus = () => useContext(FocusContext)

export function ChannelFocusProvider({
  scrollContainerRef,
  children,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  children: (focus: ChannelFocus | null) => ReactNode
}) {
  const [focus, setFocus] = useState<ChannelFocus | null>(null)
  // Where the Account was in the full feed, to put them back on exit.
  const origin = useRef<{ key: string; top: number } | null>(null)
  const restore = useRef(false)

  const enter = useCallback(
    (post: Post, channel = post.channelName) => {
      if (!origin.current) {
        origin.current = {
          key: `${post.channelName}_${post.id}`,
          top: scrollContainerRef.current?.scrollTop ?? 0,
        }
      }
      setFocus((f) => ({ channel, keepFilters: f?.keepFilters ?? false }))
      scrollContainerRef.current?.scrollTo({ top: 0 })
    },
    [scrollContainerRef],
  )
  const exit = useCallback(() => {
    restore.current = true
    setFocus(null)
  }, [])
  const setKeepFilters = useCallback(
    (keepFilters: boolean) => setFocus((f) => f && { ...f, keepFilters }),
    [],
  )

  // Back to the card the Account left from, once the full feed re-renders.
  useEffect(() => {
    if (focus || !restore.current || !origin.current) return
    const { key, top } = origin.current
    restore.current = false
    origin.current = null
    requestAnimationFrame(() => {
      const card = document.querySelector(
        `[data-post-key="${CSS.escape(key)}"]`,
      )
      if (card) card.scrollIntoView({ block: "center" })
      else scrollContainerRef.current?.scrollTo({ top })
    })
  }, [focus, scrollContainerRef])

  useEffect(() => {
    if (!focus) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      // Esc closing the image lightbox should not also leave the focus.
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === "Escape") exit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focus, exit])

  const api = useMemo(
    () => ({ focus, enter, exit, setKeepFilters }),
    [focus, enter, exit, setKeepFilters],
  )
  return (
    <FocusContext.Provider value={api}>{children(focus)}</FocusContext.Provider>
  )
}

export function ChannelFocusBanner() {
  const { focus, exit, setKeepFilters } = useChannelFocus()
  const { channels } = useData()
  if (!focus) return null
  const channel = channels.find(
    (c) => c.name.toLowerCase() === focus.channel.toLowerCase(),
  )
  return (
    <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-blue-500/30 bg-app-card/95 px-4 py-3 shadow-md backdrop-blur-md">
      <button
        type="button"
        onClick={exit}
        className="inline-flex items-center gap-1.5 rounded-full bg-app-ink/5 px-3 py-1.5 text-[12px] font-medium hover:bg-app-ink/10"
      >
        <ArrowLeft size={14} /> Back to feed
        <kbd className="ml-1 rounded border border-app-ink/15 px-1 font-mono text-[10px] text-app-ink/50">
          Esc
        </kbd>
      </button>
      <div className="flex items-center gap-2 min-w-0">
        {channel && (
          <ChannelAvatar
            channel={channel}
            className="w-6 h-6 shrink-0"
            textClassName="text-[10px]"
          />
        )}
        <span className="text-[13px] truncate">
          Only{" "}
          <a
            href={telegramWebViewChannelUrl(focus.channel)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold hover:underline"
          >
            {channel?.displayName || `@${focus.channel}`}
          </a>
          <span className="text-app-ink/50">
            {" "}
            ·{" "}
            {focus.keepFilters
              ? "with your filters"
              : "every post in this window"}
          </span>
        </span>
      </div>
      <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[12px] text-app-ink/70">
        <input
          type="checkbox"
          checked={focus.keepFilters}
          onChange={(e) => setKeepFilters(e.target.checked)}
        />
        Keep my filters
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// What every variant has to work with.

function usePostCardModel(post: Post) {
  const { embeddingsEnabled } = useSettings()
  const { setRelatedPostSearch, addNewChannel } = useScraper()
  const { channels } = useData()
  const translation = usePostTranslation(post)
  const focusApi = useChannelFocus()
  const find = (name?: string) =>
    name
      ? channels.find((c) => c.name.toLowerCase() === name.toLowerCase())
      : undefined
  const channel = useMemo(
    () => find(post.channelName),
    [channels, post.channelName],
  )
  const forwardChannel = find(post.forwardedFrom)
  const postUrl = telegramWebViewPostUrl(post.channelName, post.id)
  const focusedHere =
    focusApi.focus?.channel.toLowerCase() === post.channelName.toLowerCase()
  return {
    post,
    channel,
    title: channel?.displayName || post.channelName,
    forwardChannel,
    addNewChannel,
    postUrl,
    translation: translation.translatable ? translation : undefined,
    text: translation.text,
    linkSpans: translation.text === post.text ? post.linkSpans : null,
    findRelated: embeddingsEnabled
      ? () => {
          focusApi.exit()
          setRelatedPostSearch(post)
          window.scrollTo({ top: 0, behavior: "smooth" })
        }
      : undefined,
    copyLink: () =>
      navigator.clipboard
        .writeText(postUrl)
        .then(() => toast.success("Link copied")),
    focusChannel: focusedHere ? undefined : () => focusApi.enter(post),
    focusForward: forwardChannel
      ? () => focusApi.enter(post, forwardChannel.name)
      : undefined,
  }
}
type Model = ReturnType<typeof usePostCardModel>

// ---------------------------------------------------------------------------
// Pieces the variants arrange differently.

function Avatar({ m, size = "w-9 h-9" }: { m: Model; size?: string }) {
  return m.channel ? (
    <ChannelAvatar
      channel={m.channel}
      className={cn(size, "border border-app-ink/10 shrink-0")}
      textClassName="text-[12px]"
    />
  ) : (
    <div
      className={cn(
        size,
        "rounded-full bg-app-ink/10 flex items-center justify-center text-[12px] font-bold uppercase text-app-ink/70 shrink-0",
      )}
    >
      {m.post.channelName.charAt(0)}
    </div>
  )
}

/** Name focuses the feed on the channel; the handle opens it in Telegram. */
function ChannelName({ m, postSearch }: { m: Model; postSearch: string }) {
  const { post } = m
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      {m.focusChannel ? (
        <button
          type="button"
          onClick={m.focusChannel}
          title={`Show only posts from ${m.title}`}
          className="font-semibold text-[14px] truncate hover:underline underline-offset-2 text-left"
        >
          {highlightText(m.title, postSearch)}
        </button>
      ) : (
        <span className="font-semibold text-[14px] truncate">
          {highlightText(m.title, postSearch)}
        </span>
      )}
      <a
        href={telegramWebViewChannelUrl(post.channelName)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`post-channel-link-${post.channelName}`}
        title="Open channel in Telegram"
        className="text-[12px] text-app-ink/50 hover:text-app-ink hover:underline truncate"
      >
        @{highlightText(post.channelName, postSearch)}
      </a>
    </span>
  )
}

function PostIdLink({ m }: { m: Model }) {
  return (
    <a
      href={m.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`post-id-link-${m.post.channelName}-${m.post.id}`}
      className="inline-flex items-center gap-0.5 font-mono hover:underline hover:text-app-ink/80"
    >
      <Hash size={10} />
      {m.post.id}
    </a>
  )
}

function Time({ post }: { post: Post }) {
  return <RelativeTime timestamp={postTime(post)} />
}

function ReplyRef({ m }: { m: Model }) {
  const { post } = m
  if (post.replyToPostId == null) return null
  return (
    <a
      data-testid={`post-reply-badge-${post.channelName}-${post.id}`}
      href={
        post.replyTo?.url ??
        telegramWebViewPostUrl(post.channelName, post.replyToPostId)
      }
      target="_blank"
      rel="noopener noreferrer"
      title={post.replyTo?.text ?? undefined}
      className="inline-flex items-center gap-1 min-w-0 hover:underline hover:text-app-ink/80"
    >
      <CornerUpLeft size={11} className="shrink-0" />
      <span className="truncate">
        Reply to #{post.replyToPostId}
        {post.replyTo?.text && (
          <span className="text-app-ink/40"> · {post.replyTo.text}</span>
        )}
      </span>
    </a>
  )
}

function ForwardRef({ m }: { m: Model }) {
  const { post } = m
  if (!post.forwardedFrom) return null
  const name = post.forwardedFromName || post.forwardedFrom
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <Repeat2 size={12} className="shrink-0" />
      Forwarded from
      {m.forwardChannel ? (
        <button
          type="button"
          onClick={m.focusForward}
          title={`Show only posts from ${name}`}
          className="font-medium hover:underline truncate"
        >
          {name}
        </button>
      ) : (
        <button
          type="button"
          onClick={() =>
            post.forwardedFrom && m.addNewChannel(post.forwardedFrom)
          }
          title={`Add @${post.forwardedFrom} to workspace`}
          className="inline-flex min-w-0 items-center gap-1 rounded px-1 font-medium text-blue-500 hover:bg-blue-500/10"
        >
          <span className="truncate">{name}</span>
          <PlusCircle size={11} />
        </button>
      )}
    </span>
  )
}

function Views({ post }: { post: Post }) {
  if (post.viewsCount == null) return null
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`${post.viewsCount.toLocaleString()} views`}
    >
      <Eye size={12} />
      {formatCount(post.viewsCount)}
    </span>
  )
}

function Reactions({ post, max = 4 }: { post: Post; max?: number }) {
  const chips = post.reactionCounts ?? []
  if (chips.length === 0) return null
  const sorted = [...chips].sort((a, b) => b.count - a.count)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {sorted.slice(0, max).map((r, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-app-ink/5 px-1.5 py-0.5 text-[11px]"
        >
          <span>{r.isPaid ? "⭐" : r.emoji || "◆"}</span>
          <span className="font-mono text-app-ink/60">
            {formatCount(r.count)}
          </span>
        </span>
      ))}
      {sorted.length > max && (
        <span className="text-[11px] text-app-ink/40">
          +{sorted.length - max}
        </span>
      )}
    </span>
  )
}

/** Media kind badges only (views drawn elsewhere), via the shipped component. */
function MediaBadges({ post }: { post: Post }) {
  return (
    <PostCardMedia
      post={{
        ...post,
        viewsCount: null,
        media: post.media && { ...post.media, thumbApiPath: null },
      }}
    />
  )
}

/** A-keys: the letter that fires each action on the selected post. */
const SHORTCUTS: Record<string, string> = {
  focus: "f",
  translate: "t",
  related: "r",
  copy: "c",
  open: "o",
}

type Action = {
  key: string
  label: string
  icon: ReactNode
  onClick?: () => void
  href?: string
  active?: boolean
  busy?: boolean
}

function actionsFor(m: Model): Action[] {
  const list: Action[] = []
  if (m.focusChannel)
    list.push({
      key: "focus",
      label: "More from this channel",
      icon: <Filter size={14} />,
      onClick: m.focusChannel,
    })
  if (m.translation)
    list.push({
      key: "translate",
      label: m.translation.showing ? "Show original" : "Translate",
      icon: <Languages size={14} />,
      onClick: m.translation.toggle,
      active: m.translation.showing,
      busy: m.translation.busy,
    })
  if (m.findRelated)
    list.push({
      key: "related",
      label: "Find related",
      icon: <Sparkles size={14} />,
      onClick: m.findRelated,
    })
  list.push({
    key: "copy",
    label: "Copy link",
    icon: <Copy size={14} />,
    onClick: m.copyLink,
  })
  list.push({
    key: "open",
    label: "Open in Telegram",
    icon: <ExternalLink size={14} />,
    href: m.postUrl,
  })
  return list
}

function ActionButton({ a, showLabel }: { a: Action; showLabel: boolean }) {
  const keys = useFeedMode().keys
  const shortcut = SHORTCUTS[a.key]
  const title = keys && shortcut ? `${a.label} (${shortcut})` : a.label
  const cls = cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] text-app-ink/60 hover:text-app-ink hover:bg-app-ink/5 transition-colors disabled:opacity-40",
    a.active && "text-blue-500 bg-blue-500/10",
  )
  const body = (
    <>
      {a.icon}
      <span className={showLabel ? "hidden sm:inline" : "sr-only"}>
        {a.busy ? "Translating…" : a.label}
      </span>
    </>
  )
  return a.href ? (
    <a
      href={a.href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      data-shortcut={shortcut}
      className={cls}
    >
      {body}
    </a>
  ) : (
    <button
      type="button"
      onClick={a.onClick}
      disabled={a.busy}
      title={title}
      data-shortcut={shortcut}
      className={cls}
    >
      {body}
    </button>
  )
}

// ---------------------------------------------------------------------------
// A: card, identity header, everything a click away in a visible footer.

const SELECTABLE =
  "scroll-mt-24 data-[kbd-selected]:ring-2 data-[kbd-selected]:ring-blue-500 data-[kbd-selected]:border-transparent"

function VariantA({ m, postSearch }: { m: Model; postSearch: string }) {
  const { post } = m
  const thumb = post.media?.thumbApiPath
  const actions = actionsFor(m)
  const picked = useIsPostSelected(post)
  return (
    <article
      data-post-key={`${post.channelName}_${post.id}`}
      className={cn(
        "bg-app-card border border-app-ink/10 rounded-2xl shadow-sm hover:border-app-ink/20 transition-colors overflow-hidden",
        SELECTABLE,
        picked && "border-violet-500/60 bg-violet-500/[0.03]",
      )}
    >
      <header className="flex items-start gap-3 px-5 pt-4">
        <span className="pt-2.5 empty:hidden">
          <SelectBox post={post} />
        </span>
        <Avatar m={m} />
        <div className="min-w-0 flex-1">
          <ChannelName m={m} postSearch={postSearch} />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-app-ink/50">
            <Time post={post} />
            <span>·</span>
            <PostIdLink m={m} />
            {(post.replyToPostId != null || post.forwardedFrom) && (
              <span>·</span>
            )}
            <ReplyRef m={m} />
            <ForwardRef m={m} />
          </div>
        </div>
      </header>
      {/* Picture above the text, as Telegram draws it, at the shipped size. */}
      {thumb && (
        <div className="mt-3 px-5 flex justify-center">
          <ZoomablePhoto thumbApiPath={thumb} caption={m.title} />
        </div>
      )}
      <div className="px-5 pt-3 pb-2 flex flex-col gap-3">
        <PostCardBody
          text={m.text}
          linkSpans={m.linkSpans}
          postSearch={postSearch}
        />
        <MediaBadges post={post} />
      </div>
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-app-ink/5 px-3 py-1.5 text-[12px] text-app-ink/50">
        <span className="px-2 inline-flex items-center gap-3">
          <Views post={post} />
          <Reactions post={post} />
        </span>
        <span className="ml-auto flex items-center">
          {actions.map((a) => (
            <ActionButton
              key={a.key}
              a={a}
              showLabel={a.key === "focus" || a.key === "translate"}
            />
          ))}
        </span>
      </footer>
    </article>
  )
}

// ---------------------------------------------------------------------------
// A-compact: one header line with icon actions, a smaller photo, three lines
// of text until asked for more. For scanning a long feed.

function CompactA({ m, postSearch }: { m: Model; postSearch: string }) {
  const { post } = m
  const thumb = post.media?.thumbApiPath
  const picked = useIsPostSelected(post)
  return (
    <article
      data-post-key={`${post.channelName}_${post.id}`}
      className={cn(
        "flex flex-col gap-2 bg-app-card border border-app-ink/10 rounded-xl px-4 pt-3 pb-1.5 hover:border-app-ink/20 transition-colors",
        SELECTABLE,
        picked && "border-violet-500/60 bg-violet-500/[0.03]",
      )}
    >
      <header className="flex items-center gap-2 text-[12px] text-app-ink/50 min-w-0">
        <SelectBox post={post} />
        <Avatar m={m} size="w-6 h-6" />
        <ChannelName m={m} postSearch={postSearch} />
        <span>·</span>
        <span className="shrink-0">
          <Time post={post} />
        </span>
      </header>
      {(post.forwardedFrom || post.replyToPostId != null) && (
        <div className="flex flex-wrap gap-x-3 text-[12px] text-app-ink/50">
          <ForwardRef m={m} />
          <ReplyRef m={m} />
        </div>
      )}
      {thumb && (
        <div className="flex justify-center">
          <ZoomablePhoto thumbApiPath={thumb} caption={m.title} small />
        </div>
      )}
      <ClampedBody m={m} postSearch={postSearch} />
      {/* Pinned to the bottom, so footers line up across a grid row. */}
      <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-app-ink/5 pt-1.5 text-[12px] text-app-ink/50">
        <PostIdLink m={m} />
        <Views post={post} />
        <Reactions post={post} max={2} />
        <MediaBadges post={post} />
        <span className="ml-auto flex items-center -mr-2">
          {actionsFor(m).map((a) => (
            <ActionButton key={a.key} a={a} showLabel={false} />
          ))}
        </span>
      </footer>
    </article>
  )
}

/** Three lines, then "More" if the text runs past them. */
function ClampedBody({ m, postSearch }: { m: Model; postSearch: string }) {
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !open) setOver(el.scrollHeight > el.clientHeight + 2)
  }, [m.text, open])
  return (
    <div>
      <div ref={ref} className={open ? "" : "max-h-[4.5em] overflow-hidden"}>
        <p
          dir="auto"
          className="text-[13px] leading-[1.5em] whitespace-pre-wrap text-app-ink/80"
        >
          {renderPostText(m.text, postSearch, m.linkSpans)}
        </p>
      </div>
      {(over || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 text-[12px] font-medium text-blue-500 hover:underline"
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A-keys: j/k select a post, its action letters fire on it.

const KEY_HELP = [
  ["j / k", "next / previous post"],
  ["p", "open photo"],
  ["f", "only this channel (Esc back)"],
  ["t", "translate"],
  ["r", "find related"],
  ["c", "copy link"],
  ["o", "open in Telegram"],
  ["x", "select (A-plus-select)"],
] as const

export function FeedKeyboard() {
  const on = useFeedMode().keys
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return
      if (document.querySelector('[role="dialog"]')) return
      const cards = Array.from(
        document.querySelectorAll<HTMLElement>("article[data-post-key]"),
      )
      const at = cards.findIndex((c) => c.hasAttribute("data-kbd-selected"))
      const select = (n: number) => {
        const next = cards[Math.max(0, Math.min(cards.length - 1, n))]
        if (!next) return
        cards[at]?.removeAttribute("data-kbd-selected")
        next.setAttribute("data-kbd-selected", "")
        next.scrollIntoView({ block: "start", behavior: "smooth" })
      }
      if (e.key === "j" || e.key === "k") {
        e.preventDefault()
        if (at < 0) {
          // Start from the first post on screen, not the top of the feed.
          const first = cards.findIndex(
            (c) => c.getBoundingClientRect().bottom > 80,
          )
          select(Math.max(0, first))
        } else select(at + (e.key === "j" ? 1 : -1))
        return
      }
      const target = cards[at]?.querySelector<HTMLElement>(
        `[data-shortcut="${e.key}"]`,
      )
      if (target) {
        e.preventDefault()
        target.click()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [on])

  if (!on) return null
  return (
    <div className="fixed bottom-4 left-4 z-50 hidden md:block rounded-xl border border-app-ink/10 bg-app-card/95 p-3 text-[11px] shadow-lg backdrop-blur">
      {KEY_HELP.map(([k, what]) => (
        <div key={k} className="flex gap-3">
          <kbd className="w-10 font-mono text-app-ink">{k}</kbd>
          <span className="text-app-ink/60">{what}</span>
        </div>
      ))}
    </div>
  )
}

export function PostCardVariant({
  post,
  postSearch,
}: {
  post: Post
  postSearch: string
}) {
  const m = usePostCardModel(post)
  if (useFeedMode().compact) return <CompactA m={m} postSearch={postSearch} />
  return <VariantA m={m} postSearch={postSearch} />
}
