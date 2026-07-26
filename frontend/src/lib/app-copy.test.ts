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
})
