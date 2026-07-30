import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Source-level guards for bidirectional text in the Discover surfaces.
 *
 * Reported from a real report: with a Persian channel name, the
 * `name · 12.5K subscribers` line rendered wrong. The cause was a single
 * concatenated string. A Persian name is an RTL run inside an LTR line, and the
 * separator and the ASCII count that followed it were neutral characters
 * adjacent to that run, so the bidi algorithm reordered them — the count moved
 * to the left of the name and punctuation at the edge of the name changed sides.
 *
 * The fix is isolation: each run gets its own `dir="auto"` element, which the
 * HTML default stylesheet gives `unicode-bidi: isolate`. It is invisible on
 * ASCII names, which is exactly why it needs a test — the tempting
 * simplification back to one template string reintroduces the bug and looks
 * correct to anyone testing in English.
 *
 * These are source assertions rather than render assertions because the repo has
 * no DOM test environment, and a rendered string would not exercise the bidi
 * algorithm anyway — reordering happens in the layout engine.
 */

const COMPONENTS = join(import.meta.dir, "..", "components")

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

function code(...parts: string[]): string {
  return stripComments(readFileSync(join(COMPONENTS, ...parts), "utf8"))
}

describe("Discover candidate table — bidi", () => {
  const source = code("discover", "DiscoverCandidateTable.tsx")

  it("isolates the display name from the subscriber count", () => {
    expect(source).toContain('<span dir="auto">{metaName}</span>')
    expect(source).toContain(
      '<span dir="auto">{subscribers} subscribers</span>',
    )
  })

  it("never splices the count into the name as one string", () => {
    // The exact shape that produced the report: a template literal mixing the
    // operator-visible name with the separator and the count.
    expect(source).not.toMatch(/`[^`]*·[^`]*\$\{/)
  })
})

describe("Discover candidate panel — bidi", () => {
  const source = code("discover", "DiscoverCandidatePanel.tsx")

  it("resolves direction for the display name and the sample post", () => {
    expect(source).toContain('<SheetDescription dir="auto">')
    // Post bodies are the most reliably RTL text in the app; `PostCard` already
    // sets this and the panel quotes the same content.
    expect(source).toMatch(/<blockquote\s+dir="auto"/)
  })
})
