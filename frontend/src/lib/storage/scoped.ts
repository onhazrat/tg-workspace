/**
 * The one module allowed to name a browser-storage key.
 *
 * Before ticket 02 roughly thirty keys — `selectedChannels`, `postFilter_*`,
 * `channelGrid_*`, `hasSeenTour`, every schema-driven setting — were written
 * under a bare name. That was correct for exactly as long as the deployment had
 * one operator. On a shared machine the second person to sign in inherited the
 * first person's channel selection, filters and settings, and nothing on screen
 * said where any of it came from.
 *
 * Everything here therefore goes under `u:<userId>:`, where the id is the JWT
 * `sub` claim **decoded client-side without verifying the signature**. That is
 * deliberate: the namespace is needed synchronously at first render, before
 * `usersReadUserMe()` could resolve, and forging a token buys a prefix, not
 * data — every byte behind it still comes from a server that checks the
 * signature.
 *
 * Two keys stay device-scoped, and the reason is not "they are special":
 *
 * - `access_token` **is** the session. Namespacing it by the id inside it is
 *   circular, and the transport has to read it before any user is known.
 * - `vite-ui-theme` is read by `ThemeProvider` at the app root, which mounts
 *   above the router and renders the login screen. Namespacing it would mean
 *   the wrong theme flashing on every visit to `/login`.
 *
 * `CLAUDE.md` and `src/lib/architecture-invariants.test.ts` hold the other half
 * of this: only this module, `theme-provider.tsx`, `api/base.ts` and
 * `hooks/useAuth.ts` may say `localStorage` at all. The guard is the point — a
 * single forgotten `localStorage.setItem` re-opens the leak silently, and it
 * looks exactly like every line it sits next to.
 */

/** The session token. Device-scoped: it is the thing the namespace comes from. */
export const TOKEN_STORAGE_KEY = "access_token"

/** Owned by `theme-provider`, which renders above the router. */
export const THEME_STORAGE_KEY = "vite-ui-theme"

/**
 * Keys that intentionally belong to the browser rather than to an account.
 *
 * Adding to this list re-opens the leak for that key, so the guard asserts the
 * exact set: a third entry has to be argued for, not merged in passing.
 */
export const DEVICE_SCOPED_KEYS: readonly string[] = [
  TOKEN_STORAGE_KEY,
  THEME_STORAGE_KEY,
]

const NAMESPACE_PREFIX = "u:"

/** Namespace for a browser with no session — the login and recovery screens. */
const ANONYMOUS_NAMESPACE = "anon"

/** Written once per account, to stop the adoption sweep re-running. */
const MIGRATION_MARKER = "__namespaced"

/**
 * `atob` yields Latin-1, one char per byte — so a payload carrying any
 * non-ASCII claim comes back mojibake and `JSON.parse` throws on it. That would
 * drop the account into the shared anonymous namespace, which is the leak this
 * module exists to close. Decode the bytes as UTF-8 instead.
 */
function base64UrlDecode(segment: string): string | null {
  const padded = segment
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(segment.length / 4) * 4, "=")
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * The `sub` claim of a JWT, or null if it does not have one.
 *
 * The backend puts `str(user.id)` there (`app/core/security.py`), so this is a
 * UUID string. Nothing is verified here — see the module docstring for why that
 * is safe and why it has to be synchronous.
 */
export function decodeJwtSubject(token: string): string | null {
  const segments = token.split(".")
  if (segments.length !== 3) return null
  const payload = base64UrlDecode(segments[1])
  if (payload === null) return null
  try {
    const claims: unknown = JSON.parse(payload)
    if (typeof claims !== "object" || claims === null) return null
    const sub = (claims as { sub?: unknown }).sub
    return typeof sub === "string" && sub.length > 0 ? sub : null
  } catch {
    return null
  }
}

/**
 * The raw token, or null when there is none *or* storage cannot be read.
 *
 * A browser set to block site data throws on access rather than reporting
 * `undefined`, so the `typeof` check alone is not enough.
 */
function readToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

/** The signed-in account id, or null. Cached per token string. */
let cachedToken: string | null = null
let cachedUserId: string | null = null

export function currentUserId(): string | null {
  const token = readToken()
  if (token === null) {
    cachedToken = null
    cachedUserId = null
    return null
  }
  if (token !== cachedToken) {
    cachedToken = token
    cachedUserId = decodeJwtSubject(token)
  }
  return cachedUserId
}

/**
 * Is a session token present? Not "is it valid" — only the server answers that.
 *
 * This exists so the several modules that gate an effect on "are we signed in"
 * (`SettingsContext`, `use-network-settings`) do not each have to reach for
 * `localStorage` and name the token key themselves. Every one of them that did
 * was a place the storage guard would have had to make an exception for.
 */
export function hasSession(): boolean {
  return readToken() !== null
}

function namespaceFor(userId: string | null): string {
  return `${NAMESPACE_PREFIX}${userId ?? ANONYMOUS_NAMESPACE}:`
}

/** The real storage key for a logical one. Device-scoped keys pass through. */
export function scopedKey(key: string, userId = currentUserId()): string {
  if (DEVICE_SCOPED_KEYS.includes(key)) return key
  return `${namespaceFor(userId)}${key}`
}

/** Accounts whose sweep threw. Memory-only, so a reload tries again. */
const sweepFailed = new Set<string>()

/**
 * Adopt values written before this account had a namespace — once.
 *
 * This runs as a sweep over every unscoped key rather than key by key at each
 * call site, because the call sites are the part that was already wrong: a
 * per-key migration only covers the keys somebody remembered.
 *
 * It deliberately does nothing for a signed-out browser. Sweeping into `anon`
 * would take the existing operator's settings and file them under a namespace
 * their account will never read.
 *
 * **The first account to sign in after the upgrade claims the unscoped values,
 * and the sweep moves rather than copies, so nobody else can.** That is a real
 * edge, and it is the least bad of the three options: copying leaves the bare
 * keys in place, which is exactly the leak; skipping the migration loses the
 * existing operator's settings for certain. The deployment this ships to has
 * one operator and enforcement is still off (`TENANCY_ENFORCED`, ticket 21), so
 * "the first account" is that operator in every realistic case. It happens once,
 * at the upgrade boundary, and never again.
 *
 * The whole body is guarded because it *writes* from inside a read path, and
 * `scopedStorage.getItem` is called from `useState` initialisers. A quota error,
 * or Safari with site data blocked (where `typeof localStorage` is still
 * `"object"` and every call throws), would otherwise throw during render and
 * white-screen the app — something a read could not do before this module
 * existed. The persisted marker is the once-guard; `sweepFailed` only stops a
 * broken sweep from being re-attempted on every key access for the rest of the
 * session, and lives in memory so a reload tries again.
 */
function ensureMigrated(userId: string | null): void {
  if (userId === null) return
  if (sweepFailed.has(userId)) return

  try {
    const marker = `${namespaceFor(userId)}${MIGRATION_MARKER}`
    if (localStorage.getItem(marker) !== null) return

    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(NAMESPACE_PREFIX)) continue
      if (DEVICE_SCOPED_KEYS.includes(key)) continue
      const value = localStorage.getItem(key)
      if (value === null) continue
      localStorage.setItem(`${namespaceFor(userId)}${key}`, value)
      localStorage.removeItem(key)
    }

    localStorage.setItem(marker, "1")
  } catch {
    // Storage is full or refused. Preferences not carrying over is a papercut;
    // throwing out of a render is a blank page. Remember the failure in memory
    // only, so this is not re-attempted on every key access for the rest of the
    // session but is retried on the next load.
    sweepFailed.add(userId)
  }
}

/**
 * Per-account browser storage. Shape-compatible with `localStorage`, so it drops
 * into `SettingsReader`/`SettingsWriter` (`lib/settings/store.ts`) unchanged.
 *
 * Every method swallows storage failures for the reason above: these are called
 * from render, and a browser that refuses site data is a supported browser.
 */
export const scopedStorage = {
  getItem(key: string): string | null {
    try {
      const userId = currentUserId()
      ensureMigrated(userId)
      return localStorage.getItem(scopedKey(key, userId))
    } catch {
      return null
    }
  },

  setItem(key: string, value: string): void {
    try {
      const userId = currentUserId()
      ensureMigrated(userId)
      localStorage.setItem(scopedKey(key, userId), value)
    } catch {
      /* preference not persisted; not worth taking the page down for */
    }
  },

  removeItem(key: string): void {
    try {
      const userId = currentUserId()
      ensureMigrated(userId)
      localStorage.removeItem(scopedKey(key, userId))
    } catch {
      /* nothing to remove, or storage refused */
    }
  },
}
