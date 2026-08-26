import { describe, expect, it } from "bun:test"
import { INACTIVE_USER_DETAIL, isAuthFailure } from "./base"

/**
 * A permission error is not an authentication error.
 *
 * `isAuthFailure` decides whether `clearStaleSession()` runs, which drops the
 * token, clears the query cache and hard navigates to `/login`. It returned
 * true for every 403 until ticket 18, which was survivable only because an
 * ordinary account never saw one: the administrative routes it could have hit
 * were open to everybody.
 *
 * Ticket 18 closed those, and `SettingsContext` mounts `useNetworkSettings` for
 * every signed-in person — so a plain account called `GET /data/settings/network`
 * on boot, was correctly refused, and was signed out for it. On every attempt.
 *
 * Both directions matter here. Narrowing this to `401` alone would leave an
 * account an Admin has just switched off signed in with every call failing, and
 * a deleted subject's token alive.
 */
describe("isAuthFailure", () => {
  it("does not end the session for an ordinary permission refusal", () => {
    expect(isAuthFailure(403, "The user doesn't have enough privileges")).toBe(
      false,
    )
  })

  it("does not end the session for an account awaiting approval", () => {
    expect(
      isAuthFailure(403, "Account is awaiting administrator approval"),
    ).toBe(false)
  })

  it("ends the session when the account has been switched off", () => {
    expect(isAuthFailure(403, INACTIVE_USER_DETAIL)).toBe(true)
  })

  it("ends the session on 401, whatever the detail says", () => {
    expect(isAuthFailure(401, "Could not validate credentials")).toBe(true)
    expect(isAuthFailure(401, "")).toBe(true)
  })

  it("ends the session when the token's subject is gone", () => {
    expect(isAuthFailure(404, "User not found")).toBe(true)
  })

  it("leaves an ordinary 404 alone", () => {
    expect(isAuthFailure(404, "Summary not found")).toBe(false)
  })
})
