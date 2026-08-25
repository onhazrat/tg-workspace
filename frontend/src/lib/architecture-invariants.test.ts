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
   *
   * Ticket 02 moved the literal into `lib/storage/scoped.ts`, which needed to
   * name it anyway to keep it *out* of the per-account namespace. Two files
   * spelling the same key by hand was the weaker version of this guard.
   */
  it("declares the theme storage key exactly once", () => {
    const owners = sourceFiles(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes('"vite-ui-theme"'))
      .map(rel)

    expect(owners).toEqual(["src/lib/storage/scoped.ts"])
  })

  it("has a single writer of the theme", () => {
    const writers = sourceFiles(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /setItem\(storageKey/.test(readFileSync(f, "utf8")))
      .map(rel)

    expect(writers).toEqual(["src/components/theme-provider.tsx"])
  })
})

describe("Ticket 02 — browser storage has four owners, and they are named", () => {
  /**
   * Roughly thirty keys — `selectedChannels`, `postFilter_*`, `channelGrid_*`,
   * `hasSeenTour`, every schema-driven setting — were written under a bare name
   * with no account in it. Correct for a one-operator deployment; on a shared
   * machine the second person to sign in inherited the first person's selection,
   * filters and settings, with nothing on screen saying where any of it came
   * from.
   *
   * `lib/storage/scoped.ts` namespaces them under `u:<userId>:`. That fix is
   * only as good as its coverage: **one** forgotten `localStorage.setItem` in a
   * new hook re-opens the leak for that key, silently, and the line looks
   * exactly like the twelve around it. So the rule is not "namespace your keys",
   * which nobody can check — it is "do not say `localStorage` at all", which a
   * regex can.
   *
   * The four exceptions each have a reason, recorded in `scoped.ts`:
   * the storage module itself, the theme provider and the transport (both of
   * which read a device-scoped key), and the auth hook (which owns the token
   * every namespace is derived from).
   */
  const STORAGE_OWNERS = [
    "src/api/base.ts",
    "src/components/theme-provider.tsx",
    "src/hooks/useAuth.ts",
    "src/lib/storage/scoped.ts",
  ]

  /**
   * Comments discuss `localStorage` constantly and one export document has it
   * as a field *name*; neither is a storage access. Strip both, then look for
   * the bare identifier.
   *
   * Matching the identifier rather than `localStorage.` is the whole difference
   * between a guard and a suggestion. `f(localStorage)` and
   * `Object.keys(localStorage)` are member-access-free, and so was the line this
   * ticket deleted from `SettingsContext`:
   * `loadAppSettings(typeof window !== "undefined" ? localStorage : …)`. A guard
   * that misses the exact pattern the change removed is not guarding anything.
   */
  function stripCommentsAndStrings(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
  }

  const ACCESS = /\b(?:localStorage|sessionStorage)\b/

  it("is touched by exactly four modules", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) =>
        ACCESS.test(stripCommentsAndStrings(readFileSync(f, "utf8"))),
      )
      .map(rel)

    expect(
      offenders.sort(),
      "Browser storage is per-account now (lib/storage/scoped.ts). Use " +
        "`scopedStorage` instead of `localStorage`, or add the module here " +
        "with the reason its key belongs to the device rather than the account.",
    ).toEqual(STORAGE_OWNERS)
  })

  /**
   * The other half of "leaves nothing behind". Removing the token used to be
   * the whole of `logout()`, so every channel, post and summary the previous
   * person loaded stayed in the query cache for the next one to read.
   */
  it("clears the query cache on logout", () => {
    const src = readFileSync(join(SRC, "hooks", "useAuth.ts"), "utf8")
    const logout = /const logout = \(\) => \{[\s\S]*?\n {2}\}/.exec(src)?.[0]

    expect(logout).toBeDefined()
    expect(logout).toContain("queryClient.clear()")
  })

  /** And on a session the server rejected, which is the same problem. */
  it("clears the query cache when a stale session is dropped", () => {
    const src = readFileSync(join(SRC, "api", "base.ts"), "utf8")
    const clear = /export function clearStaleSession[\s\S]*?\n\}/.exec(src)?.[0]

    expect(clear).toBeDefined()
    expect(clear).toContain("queryClient.clear()")
  })

  /**
   * Every entry here is a key that survives a sign-out and is readable by the
   * next account, so the set is asserted exactly: a third one has to be argued
   * for in a PR, not slipped in beside two that already look harmless.
   */
  it("keeps the device-scoped list to the two keys that earned it", () => {
    const src = readFileSync(join(SRC, "lib", "storage", "scoped.ts"), "utf8")
    const list =
      /DEVICE_SCOPED_KEYS: readonly string\[\] = \[([\s\S]*?)\]/.exec(src)?.[1]

    expect(list).toBeDefined()
    const entries = (list ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)

    expect(entries).toEqual(["TOKEN_STORAGE_KEY", "THEME_STORAGE_KEY"])
  })
})

describe("Ticket 17 — an artifact id is a UUID, never a timestamp", () => {
  /**
   * `tg_summaries.id` and `tg_chat_sessions.id` are the *whole* primary key —
   * there is no `user_id` in it — so the id namespace is global across
   * accounts. `Date.now().toString()` has millisecond resolution, which was
   * survivable only while a create could silently merge into whatever row the
   * id already named.
   *
   * Ticket 17 scoped the upserts, so that merge is now a 404: the second
   * account to save in a given millisecond gets "Summary not found" on a
   * **create**, for a row its user has never seen and cannot retry. A UUID
   * makes the collision impossible instead of making the failure friendlier.
   *
   * `TagContext` already did this and Discover reports are server-side uuid4;
   * these two modules were the outliers, found by review after the scoping
   * landed. Message ids inside a transcript are deliberately not covered — they
   * are array keys within one artifact, never a database primary key.
   */
  const ARTIFACT_ID_BINDINGS =
    /\b(?:const|let)\s+(newId|sessionId|runId)\s*=\s*([^\n]+)/g

  const CONTEXTS = [
    "src/contexts/AIContext.tsx",
    "src/contexts/ChatContext.tsx",
    "src/contexts/TagContext.tsx",
  ]

  it("binds every artifact id to crypto.randomUUID()", () => {
    const offenders: string[] = []

    for (const file of CONTEXTS) {
      const source = readFileSync(join(FRONTEND, file), "utf8")
      for (const [, name, value] of source.matchAll(ARTIFACT_ID_BINDINGS)) {
        if (!value.includes("crypto.randomUUID()")) {
          offenders.push(`${file}: ${name} = ${value.trim()}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it("finds the bindings it claims to check", () => {
    // Without this the regex could stop matching — a rename, a reformat — and
    // the guard above would pass by scanning nothing at all.
    const found = CONTEXTS.flatMap((file) => [
      ...readFileSync(join(FRONTEND, file), "utf8").matchAll(
        ARTIFACT_ID_BINDINGS,
      ),
    ])

    expect(found.length).toBeGreaterThanOrEqual(4)
  })
})
