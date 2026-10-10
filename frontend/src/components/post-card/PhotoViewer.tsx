/**
 * The full-screen photo viewer (PTR-02, SUMTAB-01), opened from a card's photo.
 *
 * At 1x the whole photo is in view, `object-contain` in a box sized in
 * viewport units, whatever its shape. Scroll or a two-finger pinch zooms about
 * the pointer or the fingers, a double-click or double-tap toggles 2.5x, drag
 * pans a zoomed photo (arithmetic in `photo-viewer-model.ts`). The arrow keys,
 * two side buttons and, at 1x, a sideways swipe step through every photo the
 * page has loaded, each starting whole again; a swipe follows the page's
 * reading direction. A click at 1x, a swipe down, Escape or the close button
 * closes it, and the page is left at the Post or Channel of the last photo
 * viewed. On touch a single tap shows or hides the caption, arrows and close
 * button instead. The Channels tab's cards open it too.
 *
 * The photo is the card's cached thumbnail; there is no larger image.
 */
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import {
  clampView,
  DOUBLE_CLICK_ZOOM,
  pinchZoom,
  WHOLE,
  type ZoomView,
  zoomAbout,
} from "./photo-viewer-model"

// Viewport units, so nothing depends on a %-height chain.
const BOX = "w-[96vw] h-[94vh]"

/** The marker a card's photo carries so the gallery can find it. */
export const GALLERY_CAPTION_ATTR = "data-gallery-caption"

/**
 * A window event naming a Channel (`detail`) whose card the Channels grid
 * should scroll to the middle of the screen.
 */
export const REVEAL_CHANNEL = "tg:reveal-channel"

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
        className={`${BOX} block max-w-none sm:max-w-none overflow-hidden border-0 bg-transparent p-0 shadow-none [&>[data-slot=dialog-close]]:rounded-full [&>[data-slot=dialog-close]]:bg-black/50 [&>[data-slot=dialog-close]]:p-2 [&>[data-slot=dialog-close]]:text-white [&:has([data-controls=hidden])>[data-slot=dialog-close]]:hidden`}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <PhotoViewer start={start} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

type GalleryPhoto = {
  src: string
  caption: string
  card: HTMLElement | null
  rtl: boolean
}

/** Every photo the feed has loaded, in feed order, read off the page once. */
function loadedPhotos(): GalleryPhoto[] {
  return Array.from(
    document.querySelectorAll<HTMLImageElement>(`img[${GALLERY_CAPTION_ATTR}]`),
  ).map((el) => ({
    src: el.src,
    caption: el.getAttribute(GALLERY_CAPTION_ATTR) ?? "",
    // A Post's card in the feed, or a Channel's card or tile in the grid.
    card: el.closest<HTMLElement>("[data-post-key], [data-channel-name]"),
    rtl: el.closest("[dir]")?.getAttribute("dir") === "rtl",
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
  // A swipe's "next" follows the page the viewer was opened from.
  const [rtl] = useState(() => photos[at]?.rtl === true)
  const [controls, setControls] = useState(true)
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
  // Leave the feed where the browsing ended, once, on close (unmount). The
  // Channels grid is virtualised and may have unmounted that Channel's card,
  // so it is asked to scroll its own way to the Channel.
  useEffect(
    () => () => {
      const card = photos[last.current]?.card
      if (card?.isConnected) card.scrollIntoView({ block: "center" })
      else if (card?.dataset.channelName)
        window.dispatchEvent(
          new CustomEvent(REVEAL_CHANNEL, { detail: card.dataset.channelName }),
        )
    },
    [],
  )

  const photo = photos[at] ?? { src: start, caption: "", card: null }
  const nav =
    "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70 disabled:opacity-20"
  return (
    <div
      className={`relative ${BOX}`}
      // The dialog hides its close button off this.
      data-controls={controls ? undefined : "hidden"}
    >
      {/* Keyed by photo, so each step starts whole again. */}
      <PanZoom
        key={photo.src}
        src={photo.src}
        rtl={rtl}
        controls={controls}
        onClose={onClose}
        onStep={step}
        onToggleControls={() => setControls((c) => !c)}
        caption={
          photos.length > 1
            ? `${photo.caption} · ${at + 1} / ${photos.length}`
            : photo.caption
        }
      />
      {controls && photos.length > 1 && (
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

/**
 * Long enough for the second click or tap of a double to arrive before the
 * first one closes the viewer or toggles its controls.
 */
const DOUBLE_TAP_MS = 250
/** How far apart, in px, the two taps of a double-tap may land. */
const DOUBLE_TAP_PX = 30
/** How far one finger must travel at 1x before it steps or closes. */
const SWIPE_PX = 60

type Point = { x: number; y: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The gesture under way: one pointer dragging, or two fingers pinching.
 * `multi` marks a drag that is what is left of a pinch, so it is neither a
 * tap nor a swipe.
 */
type Gesture =
  | {
      kind: "drag"
      from: Point
      view: ZoomView
      moved: boolean
      multi: boolean
    }
  | { kind: "pinch"; mid: Point; from: number; view: ZoomView }

function PanZoom({
  src,
  caption,
  controls,
  rtl,
  onClose,
  onStep,
  onToggleControls,
}: {
  src: string
  caption: string
  /** Whether the caption shows; a touch tap toggles it. */
  controls: boolean
  /** Whether the page reads right to left, which reverses a swipe. */
  rtl: boolean
  onClose: () => void
  onStep: (by: number) => void
  onToggleControls: () => void
}) {
  const [view, setView] = useState(WHOLE)
  const viewRef = useRef(view)
  viewRef.current = view
  // The hint names the gestures of the input last used.
  const [touch, setTouch] = useState(
    () => window.matchMedia?.("(pointer: coarse)").matches ?? false,
  )
  const box = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  // The first tap of a possible double, until its window passes.
  const firstTap = useRef<Point | null>(null)
  const pendingTap = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(pendingTap.current), [])

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
  /** A point on screen, as px from the box's centre. */
  const local = (p: Point) => {
    const { r, box: b } = sizes()
    return {
      x: p.x - (r?.left ?? 0) - b.w / 2,
      y: p.y - (r?.top ?? 0) - b.h / 2,
    }
  }
  const zoomAt = (clientX: number, clientY: number, next: number) => {
    const { box: b, photo } = sizes()
    const at = local({ x: clientX, y: clientY })
    setView(zoomAbout(viewRef.current, at, next, b, photo))
  }

  const startDrag = (from: Point, multi: boolean) => {
    gesture.current = {
      kind: "drag",
      from,
      view: viewRef.current,
      moved: multi,
      multi,
    }
  }
  const startPinch = (a: Point, b: Point) => {
    gesture.current = {
      kind: "pinch",
      mid: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      from: distance(a, b) || 1,
      view: viewRef.current,
    }
  }
  /** Whatever pointers are still down carry on, without a jump. */
  const regroup = () => {
    const [a, b] = [...pointers.current.values()]
    if (a && b) startPinch(a, b)
    else if (a) startDrag(a, true)
    else gesture.current = null
  }

  // A second tap close by is a double: toggle 2.5x. Otherwise wait out the
  // window, then a touch toggles the controls and a click at 1x closes.
  const onTap = (p: Point, byTouch: boolean) => {
    window.clearTimeout(pendingTap.current)
    const first = firstTap.current
    if (first && distance(first, p) < DOUBLE_TAP_PX) {
      firstTap.current = null
      zoomAt(p.x, p.y, viewRef.current.s > 1 ? 1 : DOUBLE_CLICK_ZOOM)
      return
    }
    firstTap.current = p
    pendingTap.current = window.setTimeout(() => {
      firstTap.current = null
      if (byTouch) onToggleControls()
      else if (viewRef.current.s === 1) onClose()
    }, DOUBLE_TAP_MS)
  }
  // At 1x a sideways swipe steps, "next" in the page's reading direction,
  // and a downward one closes.
  const onSwipe = (dx: number, dy: number) => {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_PX)
      onStep(dx < 0 !== rtl ? 1 : -1)
    else if (dy > SWIPE_PX && dy > Math.abs(dx)) onClose()
  }
  const onLift = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return
    const g = gesture.current
    regroup()
    if (pointers.current.size || g?.kind !== "drag" || g.multi) return
    const p = { x: e.clientX, y: e.clientY }
    const byTouch = e.pointerType === "touch"
    if (!g.moved) onTap(p, byTouch)
    else if (byTouch && g.view.s === 1) onSwipe(p.x - g.from.x, p.y - g.from.y)
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
        setTouch(e.pointerType === "touch")
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.current.size === 1)
          startDrag({ x: e.clientX, y: e.clientY }, false)
        else regroup()
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const g = gesture.current
        const { box: b, photo } = sizes()
        if (g?.kind === "pinch") {
          const [p, q] = [...pointers.current.values()]
          if (p && q)
            setView(pinchZoom(g.view, g.mid, g.from, distance(p, q), b, photo))
          return
        }
        if (!g) return
        const dx = e.clientX - g.from.x
        const dy = e.clientY - g.from.y
        if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true
        if (!g.moved || g.view.s === 1) return
        setView(
          clampView(
            { s: g.view.s, x: g.view.x + dx, y: g.view.y + dy },
            b,
            photo,
          ),
        )
      }}
      onPointerUp={onLift}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        regroup()
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
          transition: gesture.current ? "none" : "transform 120ms ease-out",
        }}
      />
      {controls && (
        <div
          data-testid="photo-viewer-label"
          // w-max up to the box's width, so a long caption wraps on a phone.
          className="pointer-events-none absolute bottom-3 left-1/2 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 break-words rounded-2xl bg-black/60 px-3 py-1 text-center font-mono text-[11px] text-white"
        >
          {caption && `${caption} · `}
          {zoomed
            ? `${view.s.toFixed(1)}x · drag to move · ${touch ? "double-tap" : "double-click"} to reset`
            : touch
              ? "pinch or double-tap to zoom · swipe down to close"
              : "scroll or double-click to zoom · click to close"}
        </div>
      )}
    </div>
  )
}
