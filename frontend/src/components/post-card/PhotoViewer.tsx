/**
 * The full-screen photo viewer (PTR-02), opened from a card's photo.
 *
 * At 1x the whole photo is in view, `object-contain` in a box sized in
 * viewport units, whatever its shape. Scroll or pinch zooms about the pointer,
 * a double-click toggles 2.5x, drag pans a zoomed photo (arithmetic in
 * `photo-viewer-model.ts`). The arrow keys and two side buttons step through
 * every photo the page has loaded, each starting whole again. A click at 1x,
 * Escape or the close button closes it, and the page is left at the Post or
 * Channel of the last photo viewed. The Channels tab's cards open it too.
 *
 * The photo is the card's cached thumbnail; there is no larger image.
 */
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import {
  clampView,
  DOUBLE_CLICK_ZOOM,
  WHOLE,
  zoomAbout,
} from "./photo-viewer-model"

// Viewport units, so nothing depends on a %-height chain.
const BOX = "w-[96vw] h-[94vh]"

/** The marker a card's photo carries so the gallery can find it. */
export const GALLERY_CAPTION_ATTR = "data-gallery-caption"

export function PhotoViewerDialog({
  start,
  open,
  onOpenChange,
  title = "Post image",
}: {
  /** The photo clicked: its `src` on the card. */
  start: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The dialog's accessible title. */
  title?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Closing moves the feed to the last photo's Post; focus returning to
        // the first photo's button would scroll it straight back.
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={`${BOX} block max-w-none sm:max-w-none overflow-hidden border-0 bg-transparent p-0 shadow-none [&>[data-slot=dialog-close]]:rounded-full [&>[data-slot=dialog-close]]:bg-black/50 [&>[data-slot=dialog-close]]:p-2 [&>[data-slot=dialog-close]]:text-white`}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <PhotoViewer start={start} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

type GalleryPhoto = { src: string; caption: string; card: HTMLElement | null }

/** Every photo the feed has loaded, in feed order, read off the page once. */
function loadedPhotos(): GalleryPhoto[] {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>(`img[${GALLERY_CAPTION_ATTR}]`),
  ).map((el) => ({
    src: el.src,
    caption: el.getAttribute(GALLERY_CAPTION_ATTR) ?? "",
    // A Post's card in the feed, or a Channel's card or tile in the grid.
    card: el.closest<HTMLElement>("[data-post-key], [data-channel-name]"),
  }))
}

export function PhotoViewer({
  start,
  onClose,
}: {
  start: string
  onClose: () => void
}) {
  const [photos] = useState(loadedPhotos)
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      photos.findIndex((p) => p.src === start),
    ),
  )
  const last = useRef(at)
  last.current = at
  const step = (d: number) =>
    setAt((n) => Math.min(photos.length - 1, Math.max(0, n + d)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  // Leave the feed where the browsing ended, once, on close (unmount).
  useEffect(
    () => () => photos[last.current]?.card?.scrollIntoView({ block: "center" }),
    [],
  )

  const photo = photos[at] ?? { src: start, caption: "", card: null }
  const nav =
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70 disabled:opacity-20"
  return (
    <div className={`relative ${BOX}`}>
      {/* Keyed by photo, so each step starts whole again. */}
      <PanZoom
        key={photo.src}
        src={photo.src}
        onClose={onClose}
        caption={
          photos.length > 1
            ? `${photo.caption} · ${at + 1} / ${photos.length}`
            : photo.caption
        }
      />
      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            className={`${nav} left-2`}
            disabled={at === 0}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            className={`${nav} right-2`}
            disabled={at === photos.length - 1}
            onClick={() => step(1)}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  )
}

/** Long enough for the second click of a double-click to cancel the close. */
const CLOSE_DELAY_MS = 250

function PanZoom({
  src,
  onClose,
  caption,
}: {
  src: string
  onClose: () => void
  caption: string
}) {
  const [view, setView] = useState(WHOLE)
  const viewRef = useRef(view)
  viewRef.current = view
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const drag = useRef<{
    px: number
    py: number
    x: number
    y: number
    moved: boolean
  } | null>(null)
  const pendingClose = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(pendingClose.current), [])

  const sizes = () => {
    const r = box.current?.getBoundingClientRect()
    return {
      r,
      box: { w: r?.width ?? 0, h: r?.height ?? 0 },
      photo: {
        w: img.current?.naturalWidth ?? 0,
        h: img.current?.naturalHeight ?? 0,
      },
    }
  }
  const zoomAt = (clientX: number, clientY: number, next: number) => {
    const { r, box: b, photo } = sizes()
    const point = {
      x: clientX - (r?.left ?? 0) - b.w / 2,
      y: clientY - (r?.top ?? 0) - b.h / 2,
    }
    setView(zoomAbout(viewRef.current, point, next, b, photo))
  }

  // Non-passive, so a trackpad pinch (ctrl+wheel) zooms the photo, not the page.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(
        e.clientX,
        e.clientY,
        viewRef.current.s * Math.exp(-e.deltaY * 0.004),
      )
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  })

  const zoomed = view.s > 1
  return (
    <div
      ref={box}
      data-testid="photo-viewer"
      className={`relative ${BOX} overflow-hidden touch-none select-none`}
      style={{ cursor: zoomed ? "grab" : "zoom-in" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        drag.current = {
          px: e.clientX,
          py: e.clientY,
          x: view.x,
          y: view.y,
          moved: false,
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.px
        const dy = e.clientY - d.py
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        if (!d.moved || viewRef.current.s === 1) return
        const { box: b, photo } = sizes()
        setView((v) =>
          clampView({ s: v.s, x: d.x + dx, y: d.y + dy }, b, photo),
        )
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d && !d.moved && viewRef.current.s === 1) {
          // One timer at a time: a double-click's first click must not survive.
          window.clearTimeout(pendingClose.current)
          pendingClose.current = window.setTimeout(onClose, CLOSE_DELAY_MS)
        }
      }}
      onDoubleClick={(e) => {
        window.clearTimeout(pendingClose.current)
        zoomAt(e.clientX, e.clientY, zoomed ? 1 : DOUBLE_CLICK_ZOOM)
      }}
    >
      <img
        ref={img}
        src={src}
        alt=""
        draggable={false}
        className="block h-full w-full object-contain"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
          transition: drag.current ? "none" : "transform 120ms ease-out",
        }}
      />
      <div
        data-testid="photo-viewer-label"
        className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 font-mono text-[11px] text-white"
      >
        {caption && `${caption} · `}
        {zoomed
          ? `${view.s.toFixed(1)}x · drag to move · double-click to reset`
          : "scroll to zoom · click to close"}
      </div>
    </div>
  )
}
