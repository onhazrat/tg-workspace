/**
 * [ and ] in the Posts feed: up a reply chain and back. The Post a reply
 * answers takes the Highlight when the feed shows it; otherwise it opens in
 * the chain panel, where [ keeps climbing. ] retraces one step either way.
 *
 * The panel is not a dialog: keyboard mode ignores keys while one is open,
 * and [ and ] have to reach it.
 */
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { queryKeys } from "@/hooks/queryKeys"
import { LIST_KEYS } from "@/lib/keyboard/key-list"
import type { Post } from "@/types"
import { usePreviewWorkspace } from "../PostPreview"
import { cardOf, postCardKey } from "./FeedKeyboard"
import { replyParentRef, replyParentUrl } from "./post-card-model"
import { ReplyParentLookup } from "./ReplyParent"

/** One step up: the reply left, and whether its parent took the Highlight. */
export interface ReplyStep {
  from: Post
  inFeed: boolean
}

export type ReplyUp =
  | { to: "feed"; key: string }
  | { to: "panel" }
  | { refused: string }

/**
 * Where [ leads from `from`, the Post the chain is on: undefined while its
 * lookup runs, null when it is not stored. Once the panel is open the chain
 * stays in it, so it reads as one thread.
 */
export function replyUp(
  from: Post | null | undefined,
  feedKey: (key: string) => string | undefined,
  panelOpen: boolean,
): ReplyUp {
  if (from === undefined) return { refused: "That post is still loading" }
  if (from === null) return { refused: "That post is not stored" }
  if (from.replyToPostId == null) return { refused: "That post is not a reply" }
  const ref = replyParentRef(from)
  const key =
    ref && !panelOpen
      ? feedKey(postCardKey({ channelName: ref.channelName, id: ref.postId }))
      : undefined
  return key ? { to: "feed", key } : { to: "panel" }
}

/** The parent the panel shows for `reply`, as its lookup cached it. */
export function cachedParent(queryClient: QueryClient, reply: Post) {
  const ref = replyParentRef(reply)
  if (!ref) return null
  return queryClient.getQueryData<Post | null>(
    queryKeys.replyParent(ref.channelName, ref.postId),
  )
}

export interface ReplyChain {
  steps: readonly ReplyStep[]
  /** [ or ] from keyboard mode; true when taken. */
  key: (
    key: string,
    highlight: string | null,
    setHighlight: (id: string) => void,
  ) => boolean
  clear: () => void
  /**
   * PROTOTYPE (posts-reply-chain): a click on a reply link. On the chain's
   * newest Post it climbs one more; anywhere else it starts a new chain.
   */
  open: (reply: Post) => void
  /** One step back, as ] is. */
  back: () => void
}

export function useReplyChain(posts: readonly Post[]): ReplyChain {
  const queryClient = useQueryClient()
  const [steps, setSteps] = useState<readonly ReplyStep[]>([])
  const clear = useCallback(() => setSteps([]), [])

  const key: ReplyChain["key"] = (key, highlight, setHighlight) => {
    const jump = (id: string) => {
      setHighlight(id)
      cardOf(id)?.scrollIntoView({ block: "start", behavior: "smooth" })
    }
    const last = steps.at(-1)
    if (key === LIST_KEYS.later) {
      if (!last) return false
      setSteps(steps.slice(0, -1))
      if (last.inFeed) jump(postCardKey(last.from))
      return true
    }
    if (key !== LIST_KEYS.earlier) return false
    const panelOpen = last !== undefined && !last.inFeed
    if (!panelOpen && !highlight) return false
    const from = panelOpen
      ? cachedParent(queryClient, last.from)
      : posts.find((p) => postCardKey(p) === highlight)
    const lower = (k: string) => k.toLowerCase()
    const up = replyUp(
      from,
      (want) => posts.map(postCardKey).find((k) => lower(k) === lower(want)),
      panelOpen,
    )
    if ("refused" in up) {
      toast(up.refused, { id: "reply-chain" })
      return true
    }
    setSteps([...steps, { from: from as Post, inFeed: up.to === "feed" }])
    if (up.to === "feed") jump(up.key)
    return true
  }

  const open = (reply: Post) => {
    const last = steps.at(-1)
    const top =
      last && !last.inFeed ? cachedParent(queryClient, last.from) : undefined
    const climbs = top && postCardKey(top) === postCardKey(reply)
    const step = { from: reply, inFeed: false }
    setSteps(climbs ? [...steps, step] : [step])
  }
  const back = () => setSteps(steps.slice(0, -1))

  return { steps, key, clear, open, back }
}

/** The panel's steps, the Post the chain is on first, as a thread reads. */
export function ReplyChainPanel({
  steps,
  onClose,
  onBack,
}: {
  steps: readonly ReplyStep[]
  onClose: () => void
  /** PROTOTYPE (posts-reply-chain): Back for a mouse or a phone. */
  onBack?: () => void
}) {
  const workspace = usePreviewWorkspace()
  const shown = steps.filter((s) => !s.inFeed).reverse()
  const top = shown[0] && postCardKey(shown[0].from)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (top) panel.current?.scrollTo({ top: 0 })
  }, [top])
  if (!shown.length) return null
  return (
    <aside
      ref={panel}
      aria-label="Reply chain"
      className="fixed inset-y-0 right-0 z-40 flex w-[min(28rem,100vw)] flex-col gap-3 overflow-y-auto overscroll-contain border-l border-app-ink/10 bg-app-bg p-3 shadow-xl"
    >
      <header className="flex items-center gap-2 text-[12px] text-app-ink/60">
        <span className="font-semibold text-app-ink">Reply chain</span>
        <span className="hidden md:inline">
          [ earlier · ] back · Esc closes
        </span>
        {onBack && shown.length > 1 && (
          <button
            type="button"
            onClick={onBack}
            className="ml-auto rounded px-2 py-1 hover:bg-app-ink/10"
          >
            Back
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the reply chain"
          className="rounded p-1 hover:bg-app-ink/10 first-of-type:ml-auto"
        >
          <X size={14} />
        </button>
      </header>
      {shown.map(({ from }, i) => (
        <div
          key={postCardKey(from)}
          data-highlight={i === 0 || undefined}
          className="rounded-2xl"
        >
          <ReplyParentLookup
            reply={from}
            href={replyParentUrl(from, from.replyToPostId ?? 0)}
            workspace={workspace}
          />
        </div>
      ))}
    </aside>
  )
}
