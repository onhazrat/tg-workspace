/**
 * PROTOTYPE (post-card): the photo viewer card A settled on, after a plain
 * lightbox, grow-in-card, zoom-only and gallery-only were tried and dropped.
 *
 * On the card the photo keeps its own shape at the shipped card's size (never
 * wider than the card, at most 20rem tall). A click opens it full screen, the
 * whole photo in view. Scroll or pinch zooms about the pointer, double-click
 * toggles 2.5x, drag moves a zoomed photo. ← → (or the side buttons) step
 * through every photo the feed has loaded, each starting whole again. A click
 * at 1x, Esc or × closes, and the feed is left at the last photo's post.
 */
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import { usePostThumbSrc } from "./PostCardMedia"

// The shipped card's size: at most 20rem tall, framed, centred.
const FIT =
  "block max-w-full max-h-80 rounded-lg border border-app-ink/10 bg-app-muted"

// The viewer's box, in viewport units so nothing depends on a %-height chain.
const VIEW_W = "w-[96vw]"
const VIEW_H = "h-[94vh]"

export function ZoomablePhoto({
  thumbApiPath,
  caption,
  small = false,
}: {
  thumbApiPath: string
  /** Shown in the viewer, e.g. the channel's name. */
  caption: string
  /** A-compact: at most 10rem tall on the card. */
  small?: boolean
}) {
  const [src, setSrc] = usePostThumbSrc(thumbApiPath)
  const [open, setOpen] = useState(false)
  if (!src) return null

  return (
    <>
      <button
        type="button"
        aria-label="View image larger"
        data-shortcut="p"
        className="block max-w-full"
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt=""
          data-testid="post-card-thumb"
          data-gallery-caption={caption}
          className={`${FIT} ${small ? "!max-h-40" : ""} cursor-zoom-in`}
          loading="lazy"
          onError={() => setSrc(null)}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          // The viewer moves the feed on close; focus going back to the first
          // photo's button would scroll it straight back.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={`${VIEW_W} ${VIEW_H} block max-w-none sm:max-w-none border-0 bg-transparent p-0 shadow-none overflow-hidden [&>[data-slot=dialog-close]]:text-white`}
        >
          <DialogTitle className="sr-only">Post image</DialogTitle>
          <PhotoViewer start={src} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Every photo the feed has loaded, in feed order, read off the page. */
function PhotoViewer({
  start,
  onClose,
}: {
  start: string
  onClose: () => void
}) {
  const [photos] = useState(() =>
    Array.from(
      document.querySelectorAll<HTMLImageElement>("img[data-gallery-caption]"),
    ).map((el) => ({
      src: el.src,
      caption: el.dataset.galleryCaption ?? "",
      card: el.closest<HTMLElement>("[data-post-key]"),
    })),
  )
  const [i, setI] = useState(() =>
    Math.max(
      0,
      photos.findIndex((p) => p.src === start),
    ),
  )
  const last = useRef(i)
  last.current = i
  const step = (d: number) =>
    setI((n) => Math.min(photos.length - 1, Math.max(0, n + d)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  // Leave the feed where the browsing ended, once, on close.
  useEffect(
    () => () => photos[last.current]?.card?.scrollIntoView({ block: "center" }),
    [],
  )

  const photo = photos[i] ?? { src: start, caption: "", card: null }
  const nav =
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70 disabled:opacity-20"
  return (
    <div className={`relative ${VIEW_W} ${VIEW_H}`}>
      {/* Keyed by photo, so each step starts whole again. */}
      <PanZoom
        key={photo.src}
        src={photo.src}
        onClose={onClose}
        label={
          photos.length > 1
            ? `${photo.caption} · ${i + 1} / ${photos.length}`
            : photo.caption
        }
      />
      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            className={`${nav} left-2`}
            disabled={i === 0}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            className={`${nav} right-2`}
            disabled={i === photos.length - 1}
            onClick={() => step(1)}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  )
}

const MAX_ZOOM = 8

/**
 * At 1x the photo is `object-contain` in the viewer box: all of it in view,
 * shape kept. Wheel or pinch zooms about the pointer, double-click toggles
 * 2.5x, drag pans, never past the photo's edge.
 */
function PanZoom({
  src,
  onClose,
  label,
}: {
  src: string
  onClose: () => void
  label?: string
}) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 })
  const tRef = useRef(t)
  tRef.current = t
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    px: number
    py: number
    x: number
    y: number
    moved: boolean
  } | null>(null)
  const pendingClose = useRef<number | undefined>(undefined)

  const img = useRef<HTMLImageElement>(null)

  // Pan only as far as the zoomed photo reaches past the viewer: an axis the
  // photo does not fill stays centred, so it can never be dragged away.
  const clamp = (s: number, x: number, y: number) => {
    const r = box.current?.getBoundingClientRect()
    const el = img.current
    if (!r || !el?.naturalWidth) return { s, x, y }
    const fit = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight)
    const mx = Math.max(0, (s * el.naturalWidth * fit - r.width) / 2)
    const my = Math.max(0, (s * el.naturalHeight * fit - r.height) / 2)
    return {
      s,
      x: Math.min(mx, Math.max(-mx, x)),
      y: Math.min(my, Math.max(-my, y)),
    }
  }

  const zoomAt = (clientX: number, clientY: number, next: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const px = clientX - r.left - r.width / 2
    const py = clientY - r.top - r.height / 2
    const { s, x, y } = tRef.current
    const s2 = Math.min(MAX_ZOOM, Math.max(1, next))
    if (s2 === 1) return setT({ s: 1, x: 0, y: 0 })
    const k = s2 / s
    setT(clamp(s2, px - k * (px - x), py - k * (py - y)))
  }

  // Non-passive, so a trackpad pinch (ctrl+wheel) zooms the photo, not the page.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, tRef.current.s * Math.exp(-e.deltaY * 0.004))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  })

  return (
    <div
      ref={box}
      data-testid="photo-viewer"
      className={`relative ${VIEW_W} ${VIEW_H} overflow-hidden touch-none select-none`}
      style={{ cursor: t.s > 1 ? "grab" : "zoom-in" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = {
          px: e.clientX,
          py: e.clientY,
          x: t.x,
          y: t.y,
          moved: false,
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.px
        const dy = e.clientY - d.py
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        if (d.moved && tRef.current.s > 1)
          setT((p) => clamp(p.s, d.x + dx, d.y + dy))
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        // A plain click at 1x closes, after a beat so a double-click can cancel it.
        if (d && !d.moved && tRef.current.s === 1) {
          pendingClose.current = window.setTimeout(onClose, 250)
        }
      }}
      onDoubleClick={(e) => {
        window.clearTimeout(pendingClose.current)
        zoomAt(e.clientX, e.clientY, tRef.current.s > 1 ? 1 : 2.5)
      }}
    >
      <img
        ref={img}
        src={src}
        alt=""
        draggable={false}
        className="block w-full h-full object-contain"
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
          transition: drag.current ? "none" : "transform 120ms ease-out",
        }}
      />
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 font-mono text-[11px] text-white">
        {label && `${label} · `}
        {t.s > 1
          ? `${t.s.toFixed(1)}x · drag to move · double-click to reset`
          : "scroll to zoom · click to close"}
      </div>
    </div>
  )
}
