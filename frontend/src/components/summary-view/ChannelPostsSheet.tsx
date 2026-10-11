/**
 * Every Post one Channel gave a Summary (SUMTAB-06), opened from the coverage
 * wall: its Cited Posts first, outlined, each with a Find; then the rest of
 * its Covered Posts newest first, looked up 20 at a time as the reader
 * scrolls. A side sheet on wide screens, a bottom sheet on phones.
 *
 * Not modal, so the report stays readable beside it with the Channel's
 * Citations highlighted; a press on the wall is left to the wall, which
 * toggles or switches the Channel rather than closing and reopening.
 */
import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef } from "react"
import { queryKeys } from "@/hooks/queryKeys"
import { useIsMobile } from "@/hooks/useMobile"
import { citationKey, findCitation } from "@/lib/citations/find-citation"
import { lookupPosts } from "@/lib/posts/store"
import type { CoverageRow } from "@/lib/summaries/coverage"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet"
import { type CitationWorkspace, CitedPostCard } from "./SummaryCitation"

const PAGE = 20

export function ChannelPostsSheet({
  row,
  open,
  onClose,
  workspace,
  wall,
}: {
  /** The Channel last opened; kept while the sheet animates out. */
  row: CoverageRow | undefined
  open: boolean
  onClose: () => void
  workspace: CitationWorkspace
  /** The wall, whose presses are not "outside" the sheet. */
  wall: React.RefObject<HTMLElement | null>
}) {
  const phone = useIsMobile()
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        className={`gap-0 ${phone ? "max-h-[85dvh] rounded-t-2xl" : "w-full sm:max-w-md"}`}
        onInteractOutside={(e) => {
          if (wall.current?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        <SheetHeader className="pb-2">
          <SheetTitle>{row?.channelName}</SheetTitle>
          <SheetDescription>
            Every post this channel gave the Summary
          </SheetDescription>
        </SheetHeader>
        {row && (
          <div className="flex flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-6">
            {row.cited.length > 0 && (
              <section aria-label="Cited in the summary">
                <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-ink/60">
                  {`Cited in the summary (${row.cited.length})`}
                </h5>
                <div className="flex flex-col gap-3">
                  {row.cited.map((c) => (
                    <div
                      key={c.postId}
                      className="rounded-2xl p-1 ring-2 ring-blue-500"
                    >
                      <p className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                        <span>Cited in the report</span>
                        <span aria-hidden>·</span>
                        <button
                          type="button"
                          aria-label={`Find ${c.channelName} #${c.postId} in the report`}
                          className="underline-offset-2 hover:underline"
                          onClick={() => {
                            onClose()
                            void findCitation(c.channelName, c.postId)
                          }}
                        >
                          Find
                        </button>
                      </p>
                      <CitedPostCard
                        cited={c}
                        loading={false}
                        workspace={workspace}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
            <AlsoCovered row={row} workspace={workspace} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function AlsoCovered({
  row,
  workspace,
}: {
  row: CoverageRow
  workspace: CitationWorkspace
}) {
  const rest = useMemo(() => {
    const cited = new Set(
      row.cited.map((c) => citationKey(c.channelName, c.postId)),
    )
    // Telegram numbers a Channel's Posts in order, so newest is highest.
    return (row.covered ?? [])
      .filter((r) => !cited.has(citationKey(r.channelName, r.postId)))
      .sort((a, b) => b.postId - a.postId)
  }, [row])
  const { data, hasNextPage, isFetching, fetchNextPage } = useInfiniteQuery({
    queryKey: queryKeys.coveredPosts(rest),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = rest.slice(pageParam, pageParam + PAGE)
      const found = await lookupPosts(page)
      return page.map((ref) => ({
        ref,
        post: found.find((p) => p.id === ref.postId) ?? null,
      }))
    },
    getNextPageParam: (_last, pages) =>
      pages.length * PAGE < rest.length ? pages.length * PAGE : undefined,
    enabled: rest.length > 0,
  })
  const more = useRef<HTMLButtonElement>(null)
  const loadMore = () => {
    if (!isFetching) void fetchNextPage()
  }
  // Load the next 20 as the button scrolls into view; a press works too.
  useEffect(() => {
    const el = more.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && loadMore(),
    )
    io.observe(el)
    return () => io.disconnect()
  })

  if (!row.covered)
    return (
      <p className="text-xs text-app-ink/60">
        The input was not recorded for this Summary, so the posts this channel
        gave it but were not cited are unknown.
      </p>
    )
  return (
    <section aria-label="Also covered">
      <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-ink/60">
        {`Also covered (${rest.length})`}
      </h5>
      <div className="flex flex-col gap-3">
        {data?.pages.flat().map(({ ref, post }) => (
          <CitedPostCard
            key={ref.postId}
            cited={{
              ...ref,
              post,
              source: post ? "live" : "missing",
              outsideScope: false,
            }}
            loading={false}
            workspace={workspace}
          />
        ))}
      </div>
      {hasNextPage && (
        <button
          ref={more}
          type="button"
          className="mt-3 w-full rounded-lg py-2 text-xs text-app-ink/60 hover:bg-app-ink/5"
          onClick={loadMore}
        >
          {isFetching ? "Loading…" : "Show more"}
        </button>
      )}
    </section>
  )
}
