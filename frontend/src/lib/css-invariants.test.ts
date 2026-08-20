import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Source-level guard for a CSS trap that is invisible in review and in types.
 *
 * `truncate` (and `line-clamp-*`) work by clipping a *block container's* line box.
 * Putting them on an element that is also `display: flex` makes the text an
 * anonymous flex item, which `text-overflow` never reaches: you get
 * `overflow: hidden`'s hard clip mid-glyph and no ellipsis.
 *
 * This is exactly what shipped on the channel-card title — the class was present
 * the whole time and did nothing. The fix is to move the clamp onto the text's own
 * child element. This test fails if the combination reappears anywhere.
 */

const SRC = join(import.meta.dir, "..")

function tsxFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === "client") continue
      found.push(...tsxFiles(path))
    } else if (entry.endsWith(".tsx")) {
      found.push(path)
    }
  }
  return found
}

/** Every `className="..."` / `className={\`...\`}` literal run in a file. */
function classNameLiterals(source: string): string[] {
  const literals: string[] = []
  const pattern = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g
  let match = pattern.exec(source)
  while (match !== null) {
    literals.push(match[1] ?? match[2] ?? "")
    match = pattern.exec(source)
  }
  return literals
}

const CLAMPS = /(?:^|\s)(truncate|line-clamp-\d+)(?:\s|$)/
/** Bare `flex`/`inline-flex` set display; `flex-1`, `flex-col` etc. do not. */
const SETS_FLEX_DISPLAY = /(?:^|\s)(?:inline-)?flex(?:\s|$)/

function clampsOnFlexContainer(classes: string): boolean {
  return CLAMPS.test(classes) && SETS_FLEX_DISPLAY.test(classes)
}

describe("CSS invariants", () => {
  // Guards the guard: without this, weakening the predicate would turn the sweep
  // below into a test that passes because it detects nothing.
  it("detects the combination it is meant to catch", () => {
    // Verbatim, the class list that shipped the A7 defect.
    expect(
      clampsOnFlexContainer(
        "font-bold text-lg leading-tight truncate mb-1 text-app-ink flex items-center gap-2",
      ),
    ).toBe(true)
    expect(clampsOnFlexContainer("line-clamp-2 flex items-center")).toBe(true)
    expect(clampsOnFlexContainer("inline-flex truncate")).toBe(true)
  })

  it("does not flag the shapes that are actually correct", () => {
    // The fix: clamp on the text's own child, flex left on the parent.
    expect(clampsOnFlexContainer("truncate min-w-0")).toBe(false)
    expect(
      clampsOnFlexContainer("text-app-ink flex items-center gap-2 min-w-0"),
    ).toBe(false)
    // `flex-1` is flex-grow on a child, not display:flex on a container.
    expect(clampsOnFlexContainer("truncate flex-1 min-w-0")).toBe(false)
    expect(clampsOnFlexContainer("truncate flex-col")).toBe(false)
  })

  it("never puts truncate or line-clamp on a flex container", () => {
    const offenders: string[] = []

    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8")
      for (const literal of classNameLiterals(source)) {
        // Template literals interpolate conditional classes; `${...}` runs are
        // opaque here, so only the static text is checked.
        const staticClasses = literal.replace(/\$\{[^}]*\}/g, " ")
        if (clampsOnFlexContainer(staticClasses)) {
          offenders.push(`${file.slice(SRC.length + 1)}: "${literal.trim()}"`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("actually scans a meaningful number of files", () => {
    // A path bug that silently found nothing would make the sweep vacuous.
    expect(tsxFiles(SRC).length).toBeGreaterThan(50)
  })
})

/**
 * Source-level guard for the letterbox trap on media.
 *
 * `w-full` forces an `<img>` box to the container width; a fixed `max-h-*` caps
 * its height; `object-contain` then fits the picture inside that box preserving
 * aspect ratio. Whatever is left over is the element's own background.
 *
 * On the post feed that leftover was enormous, because the box was a full card
 * wide and the photos are not: measured on staging, an 800x427 photo drew 600px
 * inside a 1413px box (813px of dead band, 58% of the row) and a 180x320 one
 * drew 180px (1233px, 87%). The remedy is to let the box take the picture's own
 * aspect — `max-w-full` with `max-h-*` — so there is no leftover at all.
 */

const FULL_WIDTH = /(?:^|\s)w-full(?:\s|$)/
const CONTAIN = /(?:^|\s)object-contain(?:\s|$)/
const CAPPED_HEIGHT = /(?:^|\s)max-h-\S+/

function letterboxesMedia(classes: string): boolean {
  return (
    FULL_WIDTH.test(classes) &&
    CONTAIN.test(classes) &&
    CAPPED_HEIGHT.test(classes)
  )
}

describe("media sizing invariants", () => {
  it("detects the combination it is meant to catch", () => {
    // Verbatim, the class list that shipped the C5 defect.
    expect(
      letterboxesMedia(
        "w-full max-h-80 rounded-lg border border-app-ink/10 object-contain bg-app-muted",
      ),
    ).toBe(true)
  })

  it("does not flag the shapes that are actually correct", () => {
    // The fix: intrinsic aspect, centred, no forced width.
    expect(
      letterboxesMedia(
        "max-w-full max-h-80 mx-auto rounded-lg border border-app-ink/10 bg-app-muted",
      ),
    ).toBe(false)
    // `object-contain` is fine when the box is not also forced full-width.
    expect(letterboxesMedia("max-h-80 object-contain")).toBe(false)
    // A full-width box with no height cap fits its content; nothing is orphaned.
    expect(letterboxesMedia("w-full object-contain")).toBe(false)
    // `object-cover` fills the box, so there is never a dead band.
    expect(letterboxesMedia("w-full max-h-80 object-cover")).toBe(false)
  })

  it("never letterboxes an image inside a forced full-width box", () => {
    const offenders: string[] = []
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8")
      for (const literal of classNameLiterals(source)) {
        const staticClasses = literal.replace(/\$\{[^}]*\}/g, " ")
        if (letterboxesMedia(staticClasses)) {
          offenders.push(`${file.slice(SRC.length + 1)}: "${literal.trim()}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * Source-level guard for hover-revealed controls that vanish under keyboard focus.
 *
 * The pattern is `opacity-0` plus `group-hover:opacity-100`: an action cluster that
 * fades in when the pointer enters the card. It is fine for a mouse and broken for
 * a keyboard — the button is still in the tab order, so focus lands on something
 * rendered at `opacity: 0`. The user tabs and the focus ring simply disappears.
 *
 * Seven interactive sites shipped this way (channel-card tag removal, history star,
 * chat copy, table clear, bot/destination verify, item copy). Two others —
 * `ChannelCard` and `PostCard`'s main clusters — already paired the hover with
 * `group-focus-within`, which is what makes this a real invariant rather than a
 * style preference: the correct form was already in the codebase.
 *
 * Reveal-on-focus takes one of two shapes, depending on where `opacity-0` sits:
 *   - on a wrapper around the buttons -> `group-focus-within:opacity-100`
 *   - on the button itself            -> `focus-visible:opacity-100`
 */

const HIDDEN = /(?:^|\s)opacity-0(?:\s|$)/
const HOVER_REVEAL = /(?:^|\s)group-hover(?:\/[\w-]+)?:opacity-/
const FOCUS_REVEAL =
  /(?:^|\s)(?:group-focus-within(?:\/[\w-]+)?|focus-visible|focus):!?opacity-/

function hoverRevealWithoutFocus(classes: string): boolean {
  return (
    HIDDEN.test(classes) &&
    HOVER_REVEAL.test(classes) &&
    !FOCUS_REVEAL.test(classes)
  )
}

/**
 * Hover-revealed elements that hold no focusable control, so there is no focus
 * state to reveal. Each is a passive label or decoration; adding a focus variant
 * would be cargo-culted noise. Listed verbatim so that adding a button to one of
 * these later trips the sweep rather than slipping through.
 */
const DECORATIVE_HOVER_REVEALS = [
  // SummaryView — truncation warning pill.
  "opacity-0 group-hover:opacity-100 text-[11px] font-medium text-amber-700/80 transition-opacity bg-amber-500/10 px-2 py-0.5 rounded-full",
  // SummaryView — section-anchor hint overlay.
  "absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-app-bg/80 backdrop-blur-sm px-2 py-1 rounded text-[11px] font-bold uppercase border border-app-ink/10",
  // ChannelCard — chevron hint on the config row; the row itself is the control.
  "opacity-0 group-hover/config:opacity-40 transition-opacity",
]

describe("focus-reveal invariants", () => {
  it("detects the combination it is meant to catch", () => {
    // Verbatim, the class lists that shipped the E4 defect.
    expect(
      hoverRevealWithoutFocus(
        "flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity",
      ),
    ).toBe(true)
    expect(hoverRevealWithoutFocus("opacity-0 group-hover:opacity-100")).toBe(
      true,
    )
    expect(
      hoverRevealWithoutFocus(
        "opacity-0 group-hover/tag:opacity-50 hover:!opacity-100 transition-opacity",
      ),
    ).toBe(true)
  })

  it("accepts both correct shapes", () => {
    // Wrapper around buttons.
    expect(
      hoverRevealWithoutFocus(
        "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity",
      ),
    ).toBe(false)
    // Named group, matching named focus variant.
    expect(
      hoverRevealWithoutFocus(
        "opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100",
      ),
    ).toBe(false)
    // The button itself, with an important-flagged reveal.
    expect(
      hoverRevealWithoutFocus(
        "opacity-0 group-hover/tag:opacity-50 hover:!opacity-100 focus-visible:!opacity-100 transition-opacity",
      ),
    ).toBe(false)
    // `hover:` alone is not a focus reveal — this must still be caught.
    expect(
      hoverRevealWithoutFocus("opacity-0 group-hover:opacity-100 hover:block"),
    ).toBe(true)
  })

  it("never hides a focusable control behind hover alone", () => {
    const offenders: string[] = []

    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8")
      for (const literal of classNameLiterals(source)) {
        const staticClasses = literal.replace(/\$\{[^}]*\}/g, " ")
        if (!hoverRevealWithoutFocus(staticClasses)) continue
        if (DECORATIVE_HOVER_REVEALS.includes(literal.trim())) continue
        offenders.push(`${file.slice(SRC.length + 1)}: "${literal.trim()}"`)
      }
    }

    expect(offenders).toEqual([])
  })

  it("keeps the decorative allowlist honest", () => {
    // Every allowlisted string must still exist in the source and must still be
    // the shape it claims to be. A stale entry would silently widen the sweep.
    const allSource = tsxFiles(SRC)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")

    for (const entry of DECORATIVE_HOVER_REVEALS) {
      expect(hoverRevealWithoutFocus(entry)).toBe(true)
      expect(allSource).toContain(entry)
    }
  })
})
