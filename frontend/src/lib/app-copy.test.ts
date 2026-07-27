import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Guards two classes of copy rot the audit found:
 *
 * - **D1** — user-facing text claiming all data lives in the browser. This app
 *   migrated to a FastAPI + PostgreSQL backend; PostgreSQL is the source of
 *   truth and IndexedDB is an offline cache. The old copy told users the
 *   opposite, which matters: it implies clearing the browser loses their data.
 * - **D2** — the version, previously typed by hand in two places that disagreed
 *   with each other and with `package.json`.
 */

const SRC = join(import.meta.dir, "..")
const FRONTEND = join(SRC, "..")

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      // `client/` is generated; `lib/` holds this test and the cache internals,
      // whose own comments legitimately discuss IndexedDB.
      if (entry === "node_modules" || entry === "client") continue
      found.push(...sourceFiles(path))
    } else if (entry.endsWith(".tsx")) {
      found.push(path)
    }
  }
  return found
}

describe("user-facing copy", () => {
  it("never tells the user all their data is stored in the browser", () => {
    const claims = [
      /All data is stored locally in your browser/i,
      /uses your browser's IndexedDB to store all/i,
      /manage your local data/i,
    ]

    const offenders: string[] = []
    for (const file of sourceFiles(join(SRC, "components"))) {
      const source = readFileSync(file, "utf8")
      // JSX wraps prose across lines; compare on a single whitespace run.
      const flattened = source.replace(/\s+/g, " ")
      for (const claim of claims) {
        if (claim.test(flattened)) {
          offenders.push(`${file.slice(SRC.length + 1)} :: ${claim}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("has no hardcoded version strings left in components", () => {
    // The two that disagreed: `v1.0` in the header, `2.5.0-stable` in Settings.
    const offenders: string[] = []
    for (const file of sourceFiles(join(SRC, "components"))) {
      const source = readFileSync(file, "utf8")
      if (/\d+\.\d+\.\d+-stable/.test(source)) {
        offenders.push(file.slice(SRC.length + 1))
      }
    }
    expect(offenders).toEqual([])

    const app = readFileSync(join(SRC, "App.tsx"), "utf8")
    expect(app).toContain("APP_VERSION")
    expect(app).not.toContain("AI Analyst v1.0")
  })

  it("injects the version from package.json, so the UI cannot drift from it", () => {
    const config = readFileSync(join(FRONTEND, "vite.config.ts"), "utf8")
    expect(config).toContain("__APP_VERSION__")
    expect(config).toContain("package.json")
  })

  /**
   * D3/D4 — machine vocabulary leaking into prose. The Discovery Scope card read
   * `0 fwd · 0 men · 0 link`, abbreviations that exist nowhere else in the UI and
   * that nothing on screen expands.
   */
  it("spells out signal names instead of abbreviating them", () => {
    const abbreviations = [
      /\bfwd\b/,
      /\d+ men\b/, // "0 men" — the abbreviation, not the word "men" in prose
    ]

    const offenders: string[] = []
    for (const file of sourceFiles(join(SRC, "components"))) {
      const source = readFileSync(file, "utf8")
      for (const abbreviation of abbreviations) {
        if (abbreviation.test(source)) {
          offenders.push(`${file.slice(SRC.length + 1)} :: ${abbreviation}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  /**
   * `formatDateToLocalISO` renders `YYYY-MM-DDTHH:mm` because that is the only
   * value `<input type="datetime-local">` accepts. Used in prose it produces
   * `Date range: 2026-07-24T23:54 – 2026-07-25T00:24`, which is what D4 caught.
   * It belongs on form-control attributes only; prose uses `formatDateRange`.
   */
  it("uses the datetime-local formatter only for form values, never for prose", () => {
    const offenders: string[] = []

    for (const file of sourceFiles(join(SRC, "components"))) {
      const source = readFileSync(file, "utf8")
      const lines = source.split("\n")
      lines.forEach((line, index) => {
        if (!line.includes("formatDateToLocalISO")) return
        if (line.includes("import")) return

        // Legitimate use 1 — a form-control attribute: `value=`, `max=`, `min=`.
        // The call may sit a few lines below the attribute in a ternary branch.
        const nearby = lines.slice(Math.max(0, index - 3), index + 1).join(" ")
        if (/\b(?:value|max|min|defaultValue)=/.test(nearby)) return

        // Legitimate use 2 — `.split("T")[0]`, which throws the time away and
        // keeps a bare `YYYY-MM-DD`. That is the ISO *date*, not the machine
        // timestamp D4 was about, and it is the right thing for a download
        // filename (`analysis-2026-07-27.md`) or a date-only input bound.
        if (line.includes('.split("T")[0]')) return

        offenders.push(`${file.slice(SRC.length + 1)}:${index + 1}`)
      })
    }

    expect(offenders).toEqual([])
  })

  it("would still catch the machine timestamp in prose", () => {
    // Guards the guard: the two exemptions above must not have widened the rule
    // into one that accepts the original defect.
    const rendersFullTimestamp = (line: string): boolean =>
      line.includes("formatDateToLocalISO") &&
      !line.includes("import") &&
      !/\b(?:value|max|min|defaultValue)=/.test(line) &&
      !line.includes('.split("T")[0]')

    // Verbatim shape of the line that shipped D4.
    expect(
      rendersFullTimestamp(
        '        {formatDateToLocalISO(new Date(startDate))} –{" "}',
      ),
    ).toBe(true)
    // The two exempted shapes stay exempt.
    expect(
      rendersFullTimestamp(
        '  const maxDate = formatDateToLocalISO(new Date()).split("T")[0]',
      ),
    ).toBe(false)
    expect(
      rendersFullTimestamp(
        "                    max={formatDateToLocalISO(new Date())}",
      ),
    ).toBe(false)
  })
})
