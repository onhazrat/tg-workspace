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
 * Three keys stay device-scoped, and the reason is not "they are special":
 *
 * - `access_token` **is** the session. Namespacing it by the id inside it is
 *   circular, and the transport has to read it before any user is known.
 * - `vite-ui-theme` is read by `ThemeProvider` at the app root, which mounts
 *   above the router and renders the login screen. Namespacing it would mean
 *   the wrong theme flashing on every visit to `/login`.
 * - `view_as_token` is a session too (ticket 26), layered over the first so an
 *   Owner looking at somebody else's account never loses their own. Scoping it
 *   under the account it names would be the same circularity, one level up.
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
 * A View-as session, layered **on top of** the token above (ticket 26).
 *
 * Device-scoped for `access_token`'s reason, and it is a second key rather than
 * a replacement for a sharper one: the Owner's own session has to survive
 * untouched, so that exiting — or a target that was deleted mid-session — is
 * one `removeItem` and never a login screen. The ticket's last checkbox is
 * "returns the Owner to their own account", and a design that overwrites the
 * Owner's token can only approximate it.
 *
 * The *namespace* follows this one when it is present (see `activeToken`), so
 * browser-side preferences are read under the account being viewed rather than
 * the Owner's.
 */
export const VIEW_AS_TOKEN_STORAGE_KEY = "view_as_token"

/**
 * Keys that intentionally belong to the browser rather than to an account.
 *
 * Adding to this list re-opens the leak for that key, so the guard asserts the
 * exact set: a further entry has to be argued for, not merged in passing.
 */
export const DEVICE_SCOPED_KEYS: readonly string[] = [
  TOKEN_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VIEW_AS_TOKEN_STORAGE_KEY,
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
 * One raw key, or null when it is absent *or* storage cannot be read.
 *
 * A browser set to block site data throws on access rather than reporting
 * `undefined`, so the `typeof` check alone is not enough.
 */
function readKey(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** The Owner's own session. Never replaced by a View-as exchange. */
function readToken(): string | null {
  return readKey(TOKEN_STORAGE_KEY)
}

/**
 * The token every request should carry, and the one the namespace comes from.
 *
 * A View-as session wins **while it is live**, and the liveness check is what
 * makes expiry safe rather than a trap. Returning the raw stored token would
 * mean that thirty minutes in, the ribbon has already vanished (`viewAsClaims`
 * refuses an expired one) while every request still carries the dead token —
 * the server answers 401 `"Could not validate credentials"`, which is not one
 * of `VIEW_AS_ENDED_DETAILS`, so the transport falls through to
 * `clearStaleSession` and removes the **Owner's** token while leaving the dead
 * View-as one in place. The next sign-in prefers it again: 401, `/login`,
 * forever. Expiry is the ordinary way a session ends, so it has to behave
 * exactly like exiting — fall back to the Owner's own token, silently.
 *
 * Both layers are read here rather than at the two call sites that need them,
 * so "which identity is this browser acting as" has exactly one answer — the
 * reason `tenancy.tenancy_enforced` is the single reader of its flag on the
 * other side of the wire.
 */
export function activeToken(): string | null {
  return viewAsClaims() === null
    ? readToken()
    : readKey(VIEW_AS_TOKEN_STORAGE_KEY)
}

/** The claims a View-as token carries, or null when this is an ordinary one. */
export interface ViewAsClaims {
  /** The account being viewed. */
  subjectUserId: string
  subjectEmail: string
  /** The Owner doing the viewing. */
  actorUserId: string
  actorEmail: string
  mode: string
  /** Seconds since the epoch, as JWTs spell it. */
  expiresAt: number
}

function decodeClaims(token: string): Record<string, unknown> | null {
  const segments = token.split(".")
  if (segments.length !== 3) return null
  const payload = base64UrlDecode(segments[1])
  if (payload === null) return null
  try {
    const claims: unknown = JSON.parse(payload)
    if (typeof claims !== "object" || claims === null) return null
    return claims as Record<string, unknown>
  } catch {
    return null
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * The current View-as session, read straight off the stored token.
 *
 * This is what makes the ribbon survive a reload with no state of its own —
 * the spec's decision, and the reason both email addresses ride in the token
 * rather than being fetched. Nothing is verified here, for the same reason
 * `decodeJwtSubject` verifies nothing: a forged claim buys a misleading banner
 * in your own browser, while every byte behind it still comes from a server
 * that checks the signature.
 *
 * An expired token returns null, so a session that ran out while the tab was
 * closed does not come back as a ribbon over an app that has stopped working.
 */
export function viewAsClaims(): ViewAsClaims | null {
  const token = readKey(VIEW_AS_TOKEN_STORAGE_KEY)
  if (token === null) return null
  const claims = decodeClaims(token)
  if (claims === null) return null

  const subjectUserId = asString(claims.sub)
  const actorUserId = asString(claims.act)
  const subjectEmail = asString(claims.sub_email)
  const actorEmail = asString(claims.act_email)
  const expiresAt = typeof claims.exp === "number" ? claims.exp : null
  if (
    subjectUserId === null ||
    actorUserId === null ||
    subjectEmail === null ||
    actorEmail === null ||
    expiresAt === null
  ) {
    return null
  }
  if (expiresAt * 1000 <= Date.now()) return null

  return {
    subjectUserId,
    subjectEmail,
    actorUserId,
    actorEmail,
    mode: asString(claims.mode) ?? "read_only",
    expiresAt,
  }
}

/** Start viewing as another account. The Owner's own token is left alone. */
export function enterViewAs(token: string): void {
  try {
    localStorage.setItem(VIEW_AS_TOKEN_STORAGE_KEY, token)
  } catch {
    /* the ribbon and the session both depend on this; the caller reloads */
  }
}

/**
 * Put the View-as session down and return to the Owner's own account.
 *
 * Returns whether there was one, so a caller can tell "I ended a session" from
 * "there was nothing to end" — `api/base.ts` needs that difference to decide
 * between exiting a session and dropping a stale one.
 */
export function exitViewAs(): boolean {
  try {
    if (localStorage.getItem(VIEW_AS_TOKEN_STORAGE_KEY) === null) return false
    localStorage.removeItem(VIEW_AS_TOKEN_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * The `detail` strings that mean the account being viewed has gone away.
 *
 * Mirrors `VIEW_AS_ENDED_DETAILS` in `backend/app/api/deps.py`, which asserts
 * the pair on its side. Neither is `"User not found"` or `"Inactive user"`,
 * deliberately: `isAuthFailure` reads both of those as a dead session and signs
 * the browser out, which over a *viewed* account would strand the Owner at a
 * login screen for something that happened to somebody else.
 */
export const VIEW_AS_ENDED_DETAILS: readonly string[] = [
  "Viewed account no longer exists",
  "Viewed account has been disabled",
]

/** The signed-in account id, or null. Cached per token string. */
let cachedToken: string | null = null
let cachedUserId: string | null = null

export function currentUserId(): string | null {
  const token = activeToken()
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
