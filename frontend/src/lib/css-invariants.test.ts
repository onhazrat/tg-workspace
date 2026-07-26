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
