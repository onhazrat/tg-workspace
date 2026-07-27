import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Source-level guard: a channel selection must never travel in a URL.
 *
 * The selection can be the whole account. At the ~1,070 channels a real one
 * holds, `?channelNames=a,b,c,...` runs to roughly 13 KB — past the request-line
 * and header limits proxies and servers enforce, so the request fails before it
 * is served. It works fine in development against a handful of channels, which
 * is exactly why it shipped three times: `/posts/counts`, `/posts`, and
 * `/discover/candidates` each built the same string independently.
 *
 * All three are POSTs now. This sweep is what stops a fourth.
 */

const API_DIR = import.meta.dir

function apiSources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...apiSources(path))
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      found.push(path)
    }
  }
  return found
}

/**
 * Putting the selection into a query string takes one of a few shapes:
 * `qs.set("channelNames", ...)`, `params.append("channelNames", ...)`, or
 * interpolating it straight into a template URL.
 */
const CHANNEL_NAMES_IN_QUERY =
  /(?:\.(?:set|append)\(\s*["'`]channelNames["'`]|[?&]channelNames=)/

/**
 * Comments legitimately quote the bad shape — the docblock on `postScopeBody`
 * spells out `?channelNames=a,b,c,...` to explain why it is forbidden. Only code
 * counts.
 */
function isComment(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  )
}

function putsSelectionInUrl(source: string): boolean {
  return CHANNEL_NAMES_IN_QUERY.test(source)
}

describe("post scope transport", () => {
  it("detects the shapes it is meant to catch", () => {
    // Guards the guard: verbatim, the three lines that shipped this defect.
    expect(
      putsSelectionInUrl(
        'qs.set("channelNames", params.channelNames.join(","))',
      ),
    ).toBe(true)
    expect(
      putsSelectionInUrl(
        'if (params?.channelNames?.length)\n  qs.set("channelNames", params.channelNames.join(","))',
      ),
    ).toBe(true)
    expect(
      putsSelectionInUrl("`/api/v1/data/posts?channelNames=${names}`"),
    ).toBe(true)
    expect(
      putsSelectionInUrl('searchParams.append("channelNames", name)'),
    ).toBe(true)
  })

  it("exempts comments without exempting code", () => {
    // The docblock line that made this exemption necessary.
    expect(
      isComment(
        " * ~1,070 channels a real account holds, `?channelNames=a,b,c,...` runs to",
      ),
    ).toBe(true)
    expect(isComment('    // qs.set("channelNames", names)')).toBe(true)
    // Real code must never be mistaken for a comment, or the sweep goes blind.
    expect(isComment('    qs.set("channelNames", names.join(","))')).toBe(false)
    expect(isComment("    body.channelNames = params.channelNames")).toBe(false)
  })

  it("does not flag the body form", () => {
    expect(putsSelectionInUrl("body.channelNames = params.channelNames")).toBe(
      false,
    )
    expect(
      putsSelectionInUrl(
        "JSON.stringify({ channelNames: params.channelNames })",
      ),
    ).toBe(false)
    // A single channel is bounded and stays a legitimate query param.
    expect(putsSelectionInUrl('qs.set("channelName", name)')).toBe(false)
  })

  it("never sends a channel selection in a query string", () => {
    const offenders: string[] = []
    for (const file of apiSources(API_DIR)) {
      const source = readFileSync(file, "utf8")
      for (const line of source.split("\n")) {
        if (isComment(line)) continue
        if (putsSelectionInUrl(line)) {
          offenders.push(`${file.slice(API_DIR.length + 1)}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("actually scans the api modules", () => {
    // A path bug that found nothing would make the sweep vacuous.
    expect(apiSources(API_DIR).length).toBeGreaterThan(3)
  })

  it("keeps every scope-carrying endpoint on POST", () => {
    const data = readFileSync(join(API_DIR, "data.ts"), "utf8")

    // Each of these takes a channel selection, so none may be fetched with the
    // default (GET) method. Asserting on the call shape rather than mocking
    // fetch keeps this a source invariant, which is what actually regressed.
    for (const path of [
      "/api/v1/data/posts",
      "/api/v1/data/posts/counts",
      "/api/v1/data/discover/candidates",
    ]) {
      const index = data.indexOf(`"${path}"`)
      expect(
        index,
        `${path} should be requested by exact path`,
      ).toBeGreaterThan(-1)
      // The method sits within the request options that follow the URL.
      const following = data.slice(index, index + 200)
      expect(following, `${path} must be POSTed`).toContain('method: "POST"')
    }
  })
})
