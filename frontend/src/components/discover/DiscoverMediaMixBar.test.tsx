import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { DiscoveryMediaMix } from "@/lib/posts/discover-candidates"
import { DiscoverMediaMixBar } from "./DiscoverMediaMixBar"

const mix = (over: Partial<DiscoveryMediaMix> = {}): DiscoveryMediaMix => ({
  photos: null,
  videos: null,
  files: null,
  links: null,
  ...over,
})

const render = (value: DiscoveryMediaMix | null) =>
  renderToStaticMarkup(<DiscoverMediaMixBar mix={value} handle="chan" />)

/**
 * The one column that is a shape rather than a number (ticket 02).
 *
 * What matters is that it never claims to be a percentage of the Post count.
 * Those counters count media *items*, so an album of five photos adds five and
 * a Post with a photo and a link counts in both; presenting the result over a
 * Post count would be a number that looks right and is not. The bar shows the
 * counters against each other and the tooltip says which it is.
 */
describe("DiscoverMediaMixBar", () => {
  test("a segment per counter, widths in proportion", () => {
    const html = render(mix({ photos: 0.75, links: 0.25 }))
    expect(html).toContain("width:75%")
    expect(html).toContain("width:25%")
  })

  test("a counter Telegram did not show gets no segment", () => {
    /**
     * `null` is "no counter of this kind was rendered", not a share of zero, so
     * a photo-only Channel is one full bar rather than one bar and three
     * zero-width slivers.
     */
    const html = render(mix({ photos: 1 }))
    expect(html).toContain("width:100%")
    expect(html).not.toContain("width:0%")
  })

  test("the tooltip refuses the percentage reading", () => {
    const html = render(mix({ photos: 0.6, videos: 0.4 }))
    expect(html).toContain("Photos 60%")
    expect(html).toContain("Videos 40%")
    expect(html).toContain("not of the Post count")
  })

  test("density stays off the row", () => {
    /**
     * The spec puts density in the panel, which is ticket 03. It is on the
     * wire already — derived at read, so ticket 03 is a consumer rather than a
     * schema change — and this is what stops it drifting onto the row early,
     * where it would be the tenth number on a line meant to be scanned.
     */
    expect(render(mix({ photos: 1 }))).not.toContain("per post")
  })

  test("an entry with no mix renders nothing at all", () => {
    /**
     * Every entry whose page has gone away, which is where the mix and the
     * sample-derived statistics part company: the row keeps its cadence and
     * loses this, exactly as it already loses its subscriber count.
     */
    expect(render(null)).toBe("")
    expect(render(mix())).toBe("")
  })

  test("the shape is announced as text, not as four unlabelled boxes", () => {
    expect(render(mix({ videos: 1 }))).toContain('aria-label="Videos 100%"')
  })
})
