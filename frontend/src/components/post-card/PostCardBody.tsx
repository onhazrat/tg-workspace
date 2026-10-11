import { ChevronDown, ChevronUp } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { renderPostText } from "@/lib/posts/render-post-text"
import type { Post } from "@/types"
import { isLongPost } from "./post-card-model"

/** The post text, collapsed behind "Show More" when it is long. */
export function PostCardBody({
  text,
  linkSpans,
  postSearch,
  whole = false,
}: {
  text: string
  /** Link positions in `text`; null for a translation, which has none of its own (ADR-022). */
  linkSpans: Post["linkSpans"] | null
  postSearch: string
  /** Never collapse: the card scrolls inside its own container (SUMTAB-04). */
  whole?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const long = !whole && isLongPost(text)
  const clipped = long && !expanded
  return (
    <>
      <div className="relative">
        <p
          dir="auto"
          className={`text-[14px] leading-relaxed whitespace-pre-wrap font-sans text-app-ink/80 ${
            clipped ? "max-h-64 overflow-hidden" : ""
          }`}
        >
          {renderPostText(text, postSearch, linkSpans)}
        </p>
        {clipped && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-app-card to-transparent" />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-app-ink/15 bg-app-muted/40 px-2.5 py-1 text-[10px] font-mono uppercase tracking-widest text-app-ink/70 transition-colors hover:bg-app-ink/5 hover:text-app-ink"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "Collapse" : "Show More"}
        </button>
      )}
    </>
  )
}

/** A compact card's text: three lines, then "More" when it runs past them. */
export function PostCardClampedBody({
  text,
  linkSpans,
  postSearch,
}: {
  text: string
  linkSpans: Post["linkSpans"] | null
  postSearch: string
}) {
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !open) setOver(el.scrollHeight > el.clientHeight + 2)
  }, [text, open])
  return (
    <div>
      {/* The font size sits on the clamp, so 4.5em is exactly three 1.5em lines. */}
      <div
        ref={ref}
        className={`text-[13px] leading-[1.5em] ${open ? "" : "max-h-[4.5em] overflow-hidden"}`}
      >
        <p dir="auto" className="whitespace-pre-wrap text-app-ink/80">
          {renderPostText(text, postSearch, linkSpans)}
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
