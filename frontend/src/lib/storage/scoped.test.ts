import { beforeEach, describe, expect, it } from "bun:test"

import {
  activeToken,
  currentUserId,
  DEVICE_SCOPED_KEYS,
  decodeJwtSubject,
  enterViewAs,
  exitViewAs,
  ownerToken,
  scopedKey,
  scopedStorage,
  TOKEN_STORAGE_KEY,
  VIEW_AS_ELEVATED,
  VIEW_AS_ENDED_DETAILS,
  VIEW_AS_TOKEN_STORAGE_KEY,
  viewAsClaims,
} from "./scoped"

/**
 * Ticket 02 — one browser, several accounts.
 *
 * Every assertion here is about the same failure: person B sits down at a
 * machine person A used, signs in, and finds A's channel selection, A's post
 * filters, A's settings. Roughly thirty keys did that, because every one of
 * them was written under a bare name with no owner in it.
 */

/**
 * A syntactically real HS256 token — only the payload matters here.
 *
 * Encoded UTF-8-then-base64, the way PyJWT emits it, rather than `btoa` over
 * the JSON string: `btoa` throws outright on a non-Latin-1 character, so the
 * shortcut would have made the non-ASCII case untestable rather than green.
 */
function tokenFor(sub: string, extra: Record<string, unknown> = {}): string {
  const b64url = (value: object) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
  }
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, ...extra })}.sig`
}

const ALICE = "8bd0f3e1-0f2a-4a4e-9a1e-0d6b1f0a1111"
const BOB = "1c4a9d77-3b6e-4c88-8f01-2a3b4c5d2222"

function signIn(userId: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, tokenFor(userId))
}

beforeEach(() => {
  localStorage.clear()
})

describe("decodeJwtSubject", () => {
  it("reads the sub claim without verifying the signature", () => {
    expect(decodeJwtSubject(tokenFor(ALICE))).toBe(ALICE)
  })

  /**
   * Deliberate: the namespace is decoded client-side, unverified, because it is
   * needed synchronously at first render — before `usersReadUserMe()` could
   * resolve. That is safe precisely because a forged token buys you a *prefix*,
   * not data; every byte behind it still comes from a server that checks the
   * signature.
   */
  /**
   * `atob` returns Latin-1, one char per byte, so decoding the payload as if it
   * were already text mangles anything non-ASCII. Today `sub` is a UUID from
   * `create_access_token`, so this changes nothing — which is exactly why it is
   * worth pinning: the day the subject becomes an address or a handle, a
   * Latin-1 decode would hand that account a *different namespace* and lose
   * every preference it had, silently and with no error anywhere.
   *
   * A mangled non-`sub` claim, incidentally, does not throw — UTF-8 lead and
   * continuation bytes are all legal JSON string characters. The failure this
   * guards is a wrong answer, not a crash.
   */
  it("decodes a non-ASCII subject as UTF-8, not Latin-1", () => {
    const subject = "Ольга Ślązak — 東京"
    expect(decodeJwtSubject(tokenFor(subject))).toBe(subject)
  })

  it("returns null for anything that is not a readable token", () => {
    expect(decodeJwtSubject("")).toBeNull()
    expect(decodeJwtSubject("not.a.jwt")).toBeNull()
    expect(decodeJwtSubject("onlyonesegment")).toBeNull()
    expect(decodeJwtSubject(`${btoa("{}")}.${btoa("{}")}.sig`)).toBeNull()
  })
})

describe("currentUserId", () => {
  it("is the signed-in account", () => {
    signIn(ALICE)
    expect(currentUserId()).toBe(ALICE)
  })

  it("is null when signed out", () => {
    expect(currentUserId()).toBeNull()
  })
})

describe("scopedStorage", () => {
  it("keeps two accounts' values apart under one browser", () => {
    signIn(ALICE)
    scopedStorage.setItem("selectedChannels", '["alpha"]')

    signIn(BOB)
    expect(scopedStorage.getItem("selectedChannels")).toBeNull()
    scopedStorage.setItem("selectedChannels", '["beta"]')

    signIn(ALICE)
    expect(scopedStorage.getItem("selectedChannels")).toBe('["alpha"]')
  })

  it("writes under a prefix carrying the account id", () => {
    signIn(ALICE)
    scopedStorage.setItem("hasSeenTour", "true")
    expect(localStorage.getItem(`u:${ALICE}:hasSeenTour`)).toBe("true")
    expect(localStorage.getItem("hasSeenTour")).toBeNull()
  })

  it("removes only the caller's copy", () => {
    signIn(ALICE)
    scopedStorage.setItem("hasSeenTour", "true")
    signIn(BOB)
    scopedStorage.setItem("hasSeenTour", "true")

    scopedStorage.removeItem("hasSeenTour")
    expect(scopedStorage.getItem("hasSeenTour")).toBeNull()

    signIn(ALICE)
    expect(scopedStorage.getItem("hasSeenTour")).toBe("true")
  })

  /**
   * A signed-out browser still renders — the login screen, the recovery form —
   * and anything it writes must not become the next account's inheritance.
   */
  it("parks signed-out writes in an anonymous namespace", () => {
    scopedStorage.setItem("hasSeenTour", "true")
    expect(localStorage.getItem("u:anon:hasSeenTour")).toBe("true")

    signIn(ALICE)
    expect(scopedStorage.getItem("hasSeenTour")).toBeNull()
  })

  it("leaves device-scoped keys unprefixed", () => {
    signIn(ALICE)
    for (const key of DEVICE_SCOPED_KEYS) {
      expect(scopedKey(key)).toBe(key)
    }
  })
})

describe("the one-time migration into a namespace", () => {
  it("adopts values written before the namespace existed", () => {
    localStorage.setItem("selectedChannels", '["alpha"]')
    localStorage.setItem("postFilter_sortOrder", "channel_time")
    signIn(ALICE)

    expect(scopedStorage.getItem("selectedChannels")).toBe('["alpha"]')
    expect(scopedStorage.getItem("postFilter_sortOrder")).toBe("channel_time")
  })

  /** "Leaves nothing behind": the unowned copy is moved, not duplicated. */
  it("takes the unscoped copy away, so the next account cannot inherit it", () => {
    localStorage.setItem("selectedChannels", '["alpha"]')
    signIn(ALICE)
    scopedStorage.getItem("selectedChannels")

    expect(localStorage.getItem("selectedChannels")).toBeNull()

    signIn(BOB)
    expect(scopedStorage.getItem("selectedChannels")).toBeNull()
  })

  it("never moves the token or the theme", () => {
    localStorage.setItem("vite-ui-theme", "dark")
    signIn(ALICE)
    scopedStorage.getItem("selectedChannels")

    expect(localStorage.getItem("vite-ui-theme")).toBe("dark")
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).not.toBeNull()
  })

  /**
   * Once. A second sweep would capture keys the account wrote *after* the
   * migration — which is fine — but it would also re-capture anything a
   * *different* account left unscoped, which is the leak this ticket closes.
   */
  it("runs once per account and not again", () => {
    localStorage.setItem("selectedChannels", '["alpha"]')
    signIn(ALICE)
    scopedStorage.getItem("selectedChannels")

    localStorage.setItem("hasSeenTour", "true")
    expect(scopedStorage.getItem("hasSeenTour")).toBeNull()
    expect(localStorage.getItem("hasSeenTour")).toBe("true")
  })

  it("does not sweep a signed-out browser into the anonymous namespace", () => {
    localStorage.setItem("selectedChannels", '["alpha"]')
    scopedStorage.getItem("selectedChannels")

    expect(localStorage.getItem("selectedChannels")).toBe('["alpha"]')

    signIn(ALICE)
    expect(scopedStorage.getItem("selectedChannels")).toBe('["alpha"]')
  })

  /**
   * The sweep writes from inside a *read*, and `scopedStorage.getItem` is called
   * from `useState` initialisers. Before this module a read could not throw; a
   * quota error or a browser refusing site data must not turn that into a blank
   * page.
   */
  it("survives storage refusing the write, without taking the render with it", () => {
    // Swapped wholesale rather than spied on: happy-dom's `Storage` is a proxy,
    // and both `localStorage.setItem = fn` and a prototype patch leave the real
    // method in place.
    const backing = new Map<string, string>([
      ["selectedChannels", '["alpha"]'],
      [TOKEN_STORAGE_KEY, tokenFor(BOB)],
    ])
    const real = globalThis.localStorage
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: () => {
          throw new DOMException("quota", "QuotaExceededError")
        },
        removeItem: (key: string) => backing.delete(key),
      },
    })

    try {
      expect(() => scopedStorage.getItem("selectedChannels")).not.toThrow()
      expect(() => scopedStorage.setItem("hasSeenTour", "true")).not.toThrow()
      expect(() => scopedStorage.removeItem("hasSeenTour")).not.toThrow()
      // The sweep could not run, so the bare value stays bare rather than being
      // half-moved — and it is simply not visible under the namespace.
      expect(scopedStorage.getItem("selectedChannels")).toBeNull()
      expect(backing.get("selectedChannels")).toBe('["alpha"]')
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: real,
      })
    }
  })

  /**
   * Safari with site data blocked: `typeof localStorage` is still `"object"`,
   * and every call throws. The `typeof` check alone does not see it, and these
   * accessors are called from `useState` initialisers — so an unguarded read
   * white-screens `/summarizer` for that visitor.
   */
  it("survives a browser that refuses storage entirely", () => {
    const refuse = () => {
      throw new DOMException("blocked", "SecurityError")
    }
    const real = globalThis.localStorage
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: refuse, setItem: refuse, removeItem: refuse },
    })

    try {
      expect(() => scopedStorage.getItem("selectedChannels")).not.toThrow()
      expect(scopedStorage.getItem("selectedChannels")).toBeNull()
      expect(() => scopedStorage.setItem("hasSeenTour", "true")).not.toThrow()
      expect(() => scopedStorage.removeItem("hasSeenTour")).not.toThrow()
      expect(() => currentUserId()).not.toThrow()
      expect(currentUserId()).toBeNull()
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: real,
      })
    }
  })

  it("does not re-namespace another account's namespaced keys", () => {
    localStorage.setItem(`u:${BOB}:selectedChannels`, '["beta"]')
    signIn(ALICE)
    scopedStorage.getItem("selectedChannels")

    expect(localStorage.getItem(`u:${BOB}:selectedChannels`)).toBe('["beta"]')
    expect(scopedStorage.getItem("selectedChannels")).toBeNull()
  })
})

/**
 * Ticket 26 — an Owner is looking at somebody else's account.
 *
 * The failure these guard against is not a leak between two people's browsers;
 * it is an Owner who cannot get back. Every assertion below is a variation on
 * "the Owner's own session was never touched", which is what makes exiting —
 * and a target deleted mid-session — one `removeItem` rather than a login
 * screen.
 */
describe("View-as sessions", () => {
  const OWNER = "3f9c1b2e-7a41-4c0d-9e88-5b6c7d8e3333"

  function viewAsToken(
    overrides: Record<string, unknown> = {},
    expiresInSeconds = 1800,
  ): string {
    return tokenFor(BOB, {
      act: OWNER,
      sub_email: "bob@example.com",
      act_email: "owner@example.com",
      mode: "read_only",
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
      ...overrides,
    })
  }

  it("takes precedence over the owner's own token for requests", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken())

    expect(activeToken()).toBe(localStorage.getItem(VIEW_AS_TOKEN_STORAGE_KEY))
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(tokenFor(OWNER))
  })

  /**
   * The whole reason the Owner's token is layered rather than replaced: exiting
   * is a removal, and there is nothing to restore that could fail to restore.
   */
  it("leaves the owner signed in when the session is put down", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken())
    expect(exitViewAs()).toBe(true)

    expect(viewAsClaims()).toBeNull()
    expect(activeToken()).toBe(tokenFor(OWNER))
    expect(currentUserId()).toBe(OWNER)
  })

  it("says whether there was a session to put down", () => {
    signIn(OWNER)
    expect(exitViewAs()).toBe(false)
  })

  /**
   * Browser storage follows the account being *viewed*, not the Owner. An Owner
   * reproducing a filter problem has to see the app the way the person
   * reporting it sees it, and half of that is which namespace the settings come
   * out of.
   */
  it("moves the storage namespace to the account being viewed", () => {
    signIn(OWNER)
    scopedStorage.setItem("selectedChannels", "owners")
    enterViewAs(viewAsToken())

    expect(currentUserId()).toBe(BOB)
    expect(scopedKey("selectedChannels")).toBe(`u:${BOB}:selectedChannels`)
    expect(scopedStorage.getItem("selectedChannels")).toBeNull()

    exitViewAs()
    expect(scopedStorage.getItem("selectedChannels")).toBe("owners")
  })

  it("names both accounts, which is what the ribbon renders", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken())

    const claims = viewAsClaims()
    expect(claims).not.toBeNull()
    expect(claims?.subjectUserId).toBe(BOB)
    expect(claims?.subjectEmail).toBe("bob@example.com")
    expect(claims?.actorUserId).toBe(OWNER)
    expect(claims?.actorEmail).toBe("owner@example.com")
  })

  /**
   * A session that ran out while the tab was closed must not come back as a
   * ribbon over an app that has stopped working. The server refuses the token
   * either way; this is about what the Owner is told.
   */
  it("reports no session once the token has expired", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken({}, -1))

    expect(viewAsClaims()).toBeNull()
  })

  /**
   * The sharpest thing review found, and it is a loop rather than a wrong
   * answer. `activeToken` returning the raw stored token means that past `exp`
   * the ribbon is already gone while every request still carries the dead
   * token; the server answers 401 `"Could not validate credentials"`, which is
   * not one of `VIEW_AS_ENDED_DETAILS`, so the transport clears the **Owner's**
   * token and leaves the View-as one behind — and the next sign-in prefers it
   * again. Expiry is the ordinary way a session ends, so it has to behave
   * exactly like exiting.
   */
  it("falls back to the owner's own token once the session has expired", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken({}, -1))

    expect(activeToken()).toBe(tokenFor(OWNER))
    expect(currentUserId()).toBe(OWNER)
  })

  /**
   * Every claim the ribbon renders is required. A token missing one would
   * otherwise produce "Viewing as undefined", which is worse than no ribbon:
   * it says a session is active and refuses to say whose.
   */
  it("reports no session when a claim the ribbon needs is missing", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken({ sub_email: undefined }))
    expect(viewAsClaims()).toBeNull()

    enterViewAs(viewAsToken({ act: undefined }))
    expect(viewAsClaims()).toBeNull()
  })

  /** An ordinary token is not a View-as session, however it is read. */
  it("does not mistake an ordinary token for a session", () => {
    signIn(OWNER)
    expect(viewAsClaims()).toBeNull()
    expect(activeToken()).toBe(tokenFor(OWNER))
  })

  /**
   * Mirrors `VIEW_AS_ENDED_DETAILS` in `backend/app/api/deps.py`, which asserts
   * the same pair on its side. Neither string may be one `isAuthFailure`
   * already treats as a dead session, or a target that went away would sign the
   * Owner out instead of returning them to their own account.
   */
  it("knows the two ways a viewed account can go away", () => {
    expect([...VIEW_AS_ENDED_DETAILS]).toEqual([
      "Viewed account no longer exists",
      "Viewed account has been disabled",
    ])
    expect(VIEW_AS_ENDED_DETAILS).not.toContain("User not found")
    expect(VIEW_AS_ENDED_DETAILS).not.toContain("Inactive user")
  })

  /**
   * Elevation (ticket 27) is authorised by the Owner's own credentials, not by
   * the session it widens — which is what makes self-escalation impossible,
   * since the server refuses every POST carrying an `act` claim. So the one
   * request that starts an elevation has to carry the Owner's token while a
   * View-as session is live, and `ownerToken` is the named exception that lets
   * it.
   *
   * Without this the ribbon's own button refuses itself with the read-only 403,
   * and the feature is unreachable from the screen it was built for — a failure
   * no backend test can see, because every one of them sets its own header.
   */
  it("still hands back the owner's own token during a session", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken({ mode: "elevated" }))

    expect(ownerToken()).toBe(tokenFor(OWNER))
    expect(ownerToken()).not.toBe(activeToken())
    expect(activeToken()).toBe(localStorage.getItem(VIEW_AS_TOKEN_STORAGE_KEY))
  })

  it("reads the mode off the token, and falls back to the narrower one", () => {
    signIn(OWNER)
    enterViewAs(viewAsToken({ mode: "elevated" }))
    expect(viewAsClaims()?.mode).toBe(VIEW_AS_ELEVATED)

    // An unrecognised mode must read as read-only, never as elevated: the
    // ribbon would otherwise tell somebody they may write when they may not,
    // and the server compares against `elevated` for the same reason.
    enterViewAs(viewAsToken({ mode: "something-new" }))
    expect(viewAsClaims()?.mode).not.toBe(VIEW_AS_ELEVATED)
  })

  it("is a device-scoped key, so it is not namespaced by the account it names", () => {
    expect(DEVICE_SCOPED_KEYS).toContain(VIEW_AS_TOKEN_STORAGE_KEY)
    expect(scopedKey(VIEW_AS_TOKEN_STORAGE_KEY)).toBe(VIEW_AS_TOKEN_STORAGE_KEY)
  })
})
