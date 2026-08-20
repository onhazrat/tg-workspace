import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Source-level guards for the architecture decisions that have no type to hang on.
 *
 * The architecture-simplification programme
 * (`docs/architecture-simplification-plan.md`) ended with one clear pattern:
 * **every decision that became a compile error or a failing test survived, and
 * every decision that stayed prose either decayed or was one careless PR from
 * decaying.** The proof is in the repo — `CLAUDE.md` has said "never inline
 * `BaseModel` in a route module" since B1, and three modules were violating it
 * when these guards were written.
 *
 * Some decisions can be a compile error (`types.conform.ts`,
 * `api/client-split.conform.ts`). The ones here cannot, because they are about
 * what the code must *not* contain. Same idea as `css-invariants.test.ts`: scan
 * the source, fail loudly, explain the why at the point of failure.
 *
 * Each guard below names the unit that earned it. That matters more than the
 * assertion: someone deleting one of these should have to read what it cost to
 * establish.
 */

const SRC = join(import.meta.dir, "..")
const FRONTEND = join(SRC, "..")

/** This file necessarily contains the strings it forbids. */
const SELF = "architecture-invariants.test.ts"

function sourceFiles(dir: string, exts = [".ts", ".tsx"]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // `client/` is generated; `node_modules` is not ours.
      if (entry === "client" || entry === "node_modules") continue
      out.push(...sourceFiles(full, exts))
      continue
    }
    if (!exts.some((e) => entry.endsWith(e))) continue
    if (entry === SELF) continue
    out.push(full)
  }
  return out
}

const rel = (p: string) => p.slice(FRONTEND.length + 1)

describe("A4 — PostgreSQL is the only client-side store", () => {
  /**
   * A4 deleted 2,491 lines: `lib/cache.ts` (1,226), `workers/dbWorker.ts`,
   * `lib/repository.ts`, the migration prompt, the cache-prune hook and the
   * `idb` dependency. It also fixed a bug that layer had been hiding — "Import
   * DB" wrote the uploaded file into IndexedDB and reloaded, never reaching the
   * server, so the next sync erased it.
   *
   * The cost of that mistake returning is the same 2,491 lines plus a silent
   * data-loss path, so it is worth two cheap assertions.
   */
  it("declares no browser-database dependency", () => {
    const pkg = JSON.parse(
      readFileSync(join(FRONTEND, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> }

    const banned = Object.keys(pkg.dependencies ?? {}).filter((d) =>
      ["idb", "idb-keyval", "localforage", "dexie"].includes(d),
    )

    expect(
      banned,
      `A4 removed the browser mirror; ${banned.join(", ")} would reintroduce it. ` +
        "Server state belongs in TanStack Query against PostgreSQL.",
    ).toEqual([])
  })

  it("never opens IndexedDB", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) =>
        /\bindexedDB\b|\bopenDB\(|new Worker\(/.test(readFileSync(f, "utf8")),
      )
      .map(rel)

    expect(
      offenders,
      `IndexedDB / a DB worker reappeared in: ${offenders.join(", ")}. ` +
        "See A4 in docs/architecture-simplification-plan.md.",
    ).toEqual([])
  })
})

describe("A3 + G2 — DataContext holds UI state, not server state", () => {
  /**
   * `DataContext` was 366 lines and ~24 members, most of them server data pushed
   * in by `repository.ts`. A3 and G2 cut it to 165 lines and the ten members
   * below — four pieces of state plus their setters and one loader; everything
   * else became a react-query hook.
   *
   * This asserts the exact member set rather than a count, so the failure names
   * what was added. The rule it protects is in `CLAUDE.md`: *"Server state =
   * TanStack Query, always. Add new server state through react-query, not
   * context `useState`."* A context field is the easy way to break that, because
   * it looks like every field already there.
   *
   * Adding one is not forbidden — it is *flagged*. If the new member is genuinely
   * UI state, update this list and say so in the PR. If it is server state, it
   * belongs in a hook.
   */
  it("exposes exactly the ten members A3/G2 left it with", () => {
    const src = readFileSync(join(SRC, "contexts", "DataContext.tsx"), "utf8")
    const body = src.slice(
      src.indexOf("interface DataContextType {"),
      src.indexOf("const DataContext = createContext"),
    )

    const fields = [...body.matchAll(/^ {2}(\w+)[?]?:/gm)].map((m) => m[1])

    expect(fields.sort()).toEqual(
      [
        "channelStats",
        "channels",
        "isInitialChannelsLoading",
        "loadChannels",
        "prevChannelNames",
        "selectedChannels",
        "setChannelStats",
        "setChannels",
        "setPrevChannelNames",
        "setSelectedChannels",
      ].sort(),
    )
  })
})

describe("One declaration of the workspace tabs", () => {
  /**
   * `WORKSPACE_TABS` is the only place a tab is declared.
   *
   * It was three places. `TabType` was a hand-written union in `types.ts`, and
   * `VALID_TABS` was copied verbatim into `routes/_tg/summarizer.tsx` and
   * `hooks/useSummarizerTab.ts` — the route validator and the hook that reads
   * it, which is exactly the pair that has to agree. Updating one and not the
   * other leaves a tab reachable by URL but silently falling back to `summary`,
   * and it fails in the browser rather than in CI.
   *
   * The drift was already visible when this guard was written: the hand-written
   * union carried `db`, `bots` and `logs`, three ids no tab had rendered for
   * months and which nothing set.
   */
  it("declares VALID_TABS exactly once", () => {
    const owners = sourceFiles(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("const VALID_TABS"))
      .map(rel)

    expect(owners).toEqual(["src/constants.ts"])
  })

  /** Same for the type: derived in one place, re-exported everywhere else. */
  it("declares TabType exactly once", () => {
    const owners = sourceFiles(SRC)
      .filter((f) => /^export type TabType =/m.test(readFileSync(f, "utf8")))
      .map(rel)

    expect(owners).toEqual(["src/constants.ts"])
  })

  /**
   * The route validator must accept every tab, including ones
   * `compactWorkspaceTabs` hides from the nav.
   *
   * Hiding a tab is a decluttering choice, not a capability removal: History
   * deep-links into hidden tabs, the command palette still offers them, and
   * `setActiveTab("summary")` is called from several places that know nothing
   * about the setting. If `VALID_TABS` were ever derived from the *filtered*
   * list, every one of those would silently redirect to `summary`.
   */
  /**
   * `compactWorkspaceTabs` hides tabs from the *nav*, and only from the nav.
   *
   * Every other consumer must keep seeing all of them: the route validator, the
   * command palette's "Go to {label}" generator, and every `setActiveTab` call.
   * Filtering any of those turns a decluttering preference into a capability
   * removal, and the failure is silent — a deep link from History would land on
   * `summary` instead of the artifact you clicked.
   */
  it("filters only the nav, never the palette or the validator", () => {
    const palette = readFileSync(join(SRC, "lib/commands/navigate.ts"), "utf8")
    expect(palette).not.toContain("compactWorkspaceTabs")

    const app = readFileSync(join(SRC, "App.tsx"), "utf8")
    // The nav is the one place the filter is applied.
    expect(app).toContain("visibleWorkspaceTabs(compactWorkspaceTabs")

    const route = readFileSync(join(SRC, "routes/_tg/summarizer.tsx"), "utf8")
    expect(route).not.toContain("compactWorkspaceTabs")
  })

  it("validates against the unfiltered tab list", () => {
    const constants = readFileSync(join(SRC, "constants.ts"), "utf8")
    const declaration = /export const VALID_TABS[\s\S]*?\n\)\n/.exec(
      constants,
    )?.[0]

    expect(declaration).toBeDefined()
    expect(declaration).toContain("WORKSPACE_TABS.map")
    expect(declaration).not.toContain("filter")
  })
})

describe("One owner per piece of global state", () => {
  /**
   * `CLAUDE.md`: *"Theme is owned by `theme-provider` in `main.tsx`
   * (`localStorage: vite-ui-theme`) — do not add a second theme toggle."*
   *
   * Two writers to one storage key is the shape of bug where the UI disagrees
   * with itself depending on which control you last touched. Cheap to assert,
   * genuinely annoying to debug.
   */
  it("has a single owner of the theme storage key", () => {
    const owners = sourceFiles(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("vite-ui-theme"))
      .map(rel)

    // `main.tsx` passes it in, `theme-provider.tsx` defaults it. No third.
    expect(owners.sort()).toEqual([
      "src/components/theme-provider.tsx",
      "src/main.tsx",
    ])
  })
})
