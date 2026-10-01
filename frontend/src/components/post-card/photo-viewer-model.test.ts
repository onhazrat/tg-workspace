/**
 * The photo viewer's arithmetic (PTR-02). At 1x the photo is `object-contain`
 * in the viewer box; zoom is a transform about the pointer and pan is clamped
 * to the photo's *drawn* size, so a narrow photo stays centred sideways and no
 * photo can be dragged off screen.
 */
import { describe, expect, test } from "bun:test"
import { clampView, MAX_ZOOM, zoomAbout } from "./photo-viewer-model"

const box = { w: 1000, h: 1000 }
const narrow = { w: 100, h: 1000 } // drawn 100x1000 at 1x
const wide = { w: 2000, h: 500 } // drawn 1000x250 at 1x
const whole = { s: 1, x: 0, y: 0 }

describe("zoomAbout", () => {
  test("zoom stays between 1x and 8x, and back at 1x the photo is whole again", () => {
    expect(zoomAbout(whole, { x: 0, y: 0 }, 50, box, wide).s).toBe(MAX_ZOOM)
    expect(MAX_ZOOM).toBe(8)
    const zoomed = zoomAbout(whole, { x: 300, y: 0 }, 4, box, wide)
    expect(zoomAbout(zoomed, { x: 300, y: 0 }, 0.2, box, wide)).toEqual(whole)
  })

  test("zooming at the centre does not move the photo", () => {
    expect(zoomAbout(whole, { x: 0, y: 0 }, 2.5, box, wide)).toEqual({
      s: 2.5,
      x: 0,
      y: 0,
    })
  })

  test("the point under the pointer stays under it", () => {
    // 2x about 200px right of centre: that point moves to 400 unless panned back.
    const v = zoomAbout(whole, { x: 200, y: 0 }, 2, box, wide)
    expect(v).toEqual({ s: 2, x: -200, y: 0 })
  })
})

describe("clampView", () => {
  test("a narrow photo cannot be dragged sideways, only along its length", () => {
    const v = clampView({ s: 2, x: 900, y: -900 }, box, narrow)
    // Drawn 200 wide: narrower than the box, so x is pinned to the centre.
    // Drawn 2000 tall: 500 over each edge.
    expect(v).toEqual({ s: 2, x: 0, y: -500 })
  })

  test("a wide photo pans sideways only as far as its own edge", () => {
    const v = clampView({ s: 4, x: -9000, y: 300 }, box, wide)
    // Drawn 4000x1000: 1500 past each side, and exactly the box's height.
    expect(v).toEqual({ s: 4, x: -1500, y: 0 })
  })

  test("before the photo's size is known nothing moves off centre", () => {
    expect(clampView({ s: 3, x: 50, y: 50 }, box, { w: 0, h: 0 })).toEqual({
      s: 3,
      x: 0,
      y: 0,
    })
  })
})
