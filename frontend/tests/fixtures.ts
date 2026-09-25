// Specs import `test` from here so scripts/crap/run.sh --with-e2e can count
// what Playwright exercises. With E2E_COVERAGE unset, `test` is Playwright's
// own, untouched. Set, every test records Chromium's V8 coverage of the app's
// modules and writes it as lcov line hits on frontend/src, mapped back through
// Vite's inline source maps.
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test as base } from "@playwright/test"

export { expect } from "@playwright/test"

// Loaded only when coverage is on, so an ordinary run imports nothing new.
function loadConverters() {
  const load = createRequire(import.meta.url)
  const v8toIstanbul: typeof import("v8-to-istanbul") = load("v8-to-istanbul")
  // v8-to-istanbul's own source-map reader, resolved through it rather than
  // declared as a second dependency.
  const { TraceMap, eachMapping } = createRequire(
    load.resolve("v8-to-istanbul"),
  )("@jridgewell/trace-mapping")
  return { v8toIstanbul, TraceMap, eachMapping }
}

const OUT_DIR = new URL("../coverage-e2e/", import.meta.url)
const INLINE_MAP = /sourceMappingURL=data:application\/json;base64,(\S+)\s*$/

export const test = process.env.E2E_COVERAGE
  ? base.extend({
      page: [
        async ({ page }, use, testInfo) => {
          await page.coverage.startJSCoverage({ resetOnNavigation: false })
          await use(page)
          const { v8toIstanbul, TraceMap, eachMapping } = loadConverters()
          const hits = new Map<string, Map<number, number>>()
          for (const entry of await page.coverage.stopJSCoverage()) {
            // Vite serves app modules at their own path; deps, the HMR client
            // and virtual modules live elsewhere.
            const file = new URL(entry.url).pathname.slice(1)
            const map = entry.source?.match(INLINE_MAP)?.[1]
            if (!file.startsWith("src/") || !entry.source || !map) continue

            // v8-to-istanbul reports every line of the original file and counts
            // it as run until a range says otherwise. Keep only lines this
            // module's code maps to, as bun keeps only executable ones:
            // comments, types and the half of a route file that TanStack
            // split into another chunk drop out.
            const mapped = new Set<number>()
            const json = JSON.parse(Buffer.from(map, "base64").toString())
            eachMapping(
              new TraceMap(json),
              (m: { originalLine: number | null }) => {
                if (m.originalLine) mapped.add(m.originalLine)
              },
            )

            // Named, so each function lands in fnMap with its original line.
            for (const fn of entry.functions) fn.functionName ||= "(anonymous)"
            const converter = v8toIstanbul("", 0, { source: entry.source })
            await converter.load()
            converter.applyCoverage(entry.functions)

            const da = hits.get(file) ?? new Map<number, number>()
            hits.set(file, da)
            for (const fc of Object.values(converter.toIstanbul())) {
              // v8-to-istanbul zeroes a line only when a range that never ran
              // spans all of it. A function that never ran starts mid-line
              // (after `export`, at an arrow's parameters) and often ends
              // mid-line (`}, [deps])`), so zero both ends explicitly.
              const uncalled = new Set(
                Object.entries(fc.fnMap)
                  .filter(([id]) => fc.f[id] === 0)
                  .flatMap(([, fn]) => [fn.loc.start.line, fn.loc.end.line]),
              )
              for (const [id, loc] of Object.entries(fc.statementMap)) {
                const n = loc.start.line
                if (!mapped.has(n)) continue
                da.set(n, (da.get(n) ?? 0) + (uncalled.has(n) ? 0 : fc.s[id]))
              }
            }
          }
          let lcov = ""
          for (const [file, da] of hits) {
            lcov += `SF:${file}\n`
            for (const [n, c] of da) lcov += `DA:${n},${c}\n`
            lcov += "end_of_record\n"
          }
          mkdirSync(OUT_DIR, { recursive: true })
          writeFileSync(new URL(`${testInfo.testId}.info`, OUT_DIR), lcov)
        },
        // Source-map conversion runs after the test body, so give it its own
        // budget rather than eating the test's.
        { scope: "test", timeout: 120_000 },
      ],
    })
  : base
