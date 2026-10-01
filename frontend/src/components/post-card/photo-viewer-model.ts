/** Scale and offset (px from the box centre) of the photo in the viewer. */
export type View = { s: number; x: number; y: number }
type Size = { w: number; h: number }

export const MAX_ZOOM = 8
export const DOUBLE_CLICK_ZOOM = 2.5
const WHOLE: View = { s: 1, x: 0, y: 0 }

/**
 * Pan only as far as the zoomed photo reaches past the box. The reach is
 * measured on the photo as `object-contain` draws it, not on the box, so an
 * axis the photo does not fill stays centred.
 */
export function clampView(v: View, box: Size, photo: Size): View {
  if (!photo.w || !photo.h) return { s: v.s, x: 0, y: 0 }
  const fit = Math.min(box.w / photo.w, box.h / photo.h)
  const mx = Math.max(0, (v.s * photo.w * fit - box.w) / 2)
  const my = Math.max(0, (v.s * photo.h * fit - box.h) / 2)
  return {
    s: v.s,
    x: Math.min(mx, Math.max(-mx, v.x)),
    y: Math.min(my, Math.max(-my, v.y)),
  }
}

/** Zoom to `next` (clamped to 1x..8x) keeping the photo point under `at` still. */
export function zoomAbout(
  v: View,
  at: { x: number; y: number },
  next: number,
  box: Size,
  photo: Size,
): View {
  const s = Math.min(MAX_ZOOM, Math.max(1, next))
  if (s === 1) return WHOLE
  const k = s / v.s
  return clampView(
    { s, x: at.x - k * (at.x - v.x), y: at.y - k * (at.y - v.y) },
    box,
    photo,
  )
}
