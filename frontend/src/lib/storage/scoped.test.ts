import { beforeEach, describe, expect, it } from "bun:test"

import {
  currentUserId,
  DEVICE_SCOPED_KEYS,
  decodeJwtSubject,
  scopedKey,
  scopedStorage,
  TOKEN_STORAGE_KEY,
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
