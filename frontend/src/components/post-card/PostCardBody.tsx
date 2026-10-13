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

/**
 * A compact card's text (PTI-05): three lines, or with `fill` (a text-only
 * card) as many whole lines as the height its grid row gives the card, then
 * "More" when it still runs past them. The text sits in a layer positioned inside a box that grows to fill
 * the card, so it never makes its row taller on its own; expanded, it is laid
 * out normally and the card grows.
 */
export function PostCardClampedBody({
  text,
  linkSpans,
  postSearch,
  fill = false,
}: {
  text: string
  linkSpans: Post["linkSpans"] | null
  postSearch: string
  /** Grow into the row's height, as a card with no photo does. */
  fill?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<number>()
  const [over, setOver] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || open) return
    const fit = () => {
      const line = Number.parseFloat(getComputedStyle(el).lineHeight)
      // Unmeasurable (no layout): the layer keeps its three-line minimum.
      if (line > 0)
        setLines(fill ? Math.max(3, Math.floor(el.clientHeight / line)) : 3)
      const shown = layer.current
      setOver(!!shown && shown.scrollHeight > shown.clientHeight + 2)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, open, fill])
  const content = (
    <p dir="auto" className="whitespace-pre-wrap text-app-ink/80">
      {renderPostText(text, postSearch, linkSpans)}
    </p>
  )
  // The font size sits on the box, so 4.5em is exactly three 1.5em lines.
  return (
    <div className="flex min-h-0 flex-1 flex-col text-[13px] leading-[1.5em]">
      {open ? (
        <div data-testid="compact-text">{content}</div>
      ) : (
        <div ref={box} className="relative min-h-[4.5em] flex-1">
          <div
            ref={layer}
            data-testid="compact-text"
            className="absolute inset-x-0 top-0 h-[4.5em] overflow-hidden"
            style={lines ? { height: `${lines * 1.5}em` } : undefined}
          >
            {content}
          </div>
        </div>
      )}
      {(over || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 self-start text-[12px] font-medium text-blue-500 hover:underline"
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  )
}
