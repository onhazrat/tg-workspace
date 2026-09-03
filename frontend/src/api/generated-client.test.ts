import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { usersReadUserMe } from "@/client"
import { client } from "@/client/client.gen"
import { ApiError } from "./base"
import { configureGeneratedClient } from "./generated-client"

/**
 * The transport contract of the generated client, after F1b.
 *
 * `@hey-api/client-fetch` neither throws nor produces `Error`s on its own — it
 * resolves to `{data, error, response}`. Everything the app relies on (throwing
 * so react-query sees a failure, `instanceof Error`, and a readable `status`)
 * comes from configuration and one interceptor, so it is configuration that has
 * to be tested. `tsc` cannot see any of it.
 *
 * These drive a real SDK function with a stubbed `fetch`, rather than calling
 * the interceptor directly, so the assertions cover the wiring too — if
 * `configureGeneratedClient()` stopped being called, or the interceptor were
 * registered on the wrong channel, every one of these fails.
 */

function respondWith(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch
}

/** A gateway failure: not JSON, and often no body and no status text at all. */
function respondRaw(status: number, body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/html" },
    })) as unknown as typeof fetch
}

let lastRequest: Request | undefined

function capturingFetch(status: number, body: unknown): typeof fetch {
  return (async (request: Request) => {
    lastRequest = request
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  lastRequest = undefined
  localStorage.clear()
  configureGeneratedClient()
  // `API_BASE` is "" in tests, and happy-dom's document sits at `about:blank`,
  // where `new Request("/api/v1/...")` throws — a property of the test DOM, not
  // of the client. An absolute base sidesteps it without touching what these
  // tests are actually about.
  client.setConfig({ baseUrl: "http://api.test" })
})

afterEach(() => {
  localStorage.clear()
})

describe("configureGeneratedClient", () => {
  it("resolves to the payload itself, not a {data} envelope", async () => {
    client.setConfig({ fetch: respondWith(200, { id: "u1", email: "a@b.c" }) })

    const user = await usersReadUserMe()

    // `responseStyle: "data"` in openapi-ts.config.ts. Without it this is
    // `{data: {...}, request, response}` and every call site reads `undefined`.
    expect(user).toEqual({ id: "u1", email: "a@b.c" } as never)
  })

  it("rejects on a failed response instead of resolving with an error", async () => {
    client.setConfig({ fetch: respondWith(500, { detail: "boom" }) })

    // The default is to *resolve* with `{error}`, which react-query reads as a
    // successful query returning undefined — a silent failure at every site.
    await expect(usersReadUserMe()).rejects.toThrow()
  })

  it("throws an ApiError carrying the status and the FastAPI detail", async () => {
    client.setConfig({ fetch: respondWith(404, { detail: "User not found" }) })

    const err = await usersReadUserMe().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toBeInstanceOf(Error)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).message).toBe("User not found")
  })

  it("keeps the parsed body, so a 422 field error is still reachable", async () => {
    const detail = [
      { loc: ["body", "email"], msg: "value is not a valid email" },
    ]
    client.setConfig({ fetch: respondWith(422, { detail }) })

    const err = (await usersReadUserMe().catch((e: unknown) => e)) as ApiError

    // `utils.ts`'s `extractErrorMessage` reads `body.detail[0].msg` to show the
    // field-level message rather than a stringified array.
    expect((err.body as { detail: unknown }).detail).toEqual(detail)
  })

  it("uses a non-JSON body as the message", async () => {
    client.setConfig({ fetch: respondRaw(502, "<html>Bad Gateway</html>") })

    const err = (await usersReadUserMe().catch((e: unknown) => e)) as ApiError

    expect(err.status).toBe(502)
    expect(err.message).toBe("<html>Bad Gateway</html>")
  })

  it("never produces an empty message, even with no body and no status text", async () => {
    client.setConfig({ fetch: respondRaw(502, "") })

    const err = (await usersReadUserMe().catch((e: unknown) => e)) as ApiError

    // A blank toast is indistinguishable from no toast. `statusText` is empty
    // on a synthesised gateway response, so the status itself is the floor.
    expect(err.message).toBe("HTTP 502")
  })

  // `VITE_API_KEY` is empty under `bun test`, so only the bearer token is
  // assertable here; both come from the same `headers()` call in `base.ts`.
  it("sends the stored token as a bearer header", async () => {
    localStorage.setItem("access_token", "tok-123")
    client.setConfig({ fetch: capturingFetch(200, {}) })

    await usersReadUserMe()

    expect(lastRequest?.headers.get("Authorization")).toBe("Bearer tok-123")
  })
})

describe("auth failures are handled at the transport", () => {
  it("clears a stale session on 401", async () => {
    localStorage.setItem("access_token", "tok-123")
    client.setConfig({
      fetch: respondWith(401, { detail: "Not authenticated" }),
    })

    await usersReadUserMe().catch(() => {})

    expect(localStorage.getItem("access_token")).toBeNull()
  })

  /**
   * Changed by ticket 18, deliberately.
   *
   * This used to assert that *any* 403 cleared the session, which was
   * survivable only while an ordinary account never saw one — the
   * administrative routes it could reach were open to everybody. Now that they
   * are gated, `SettingsContext` mounts `useNetworkSettings` for every
   * signed-in person, so a plain account calls `GET /data/settings/network` on
   * boot, is correctly refused, and would be signed out for it on every
   * attempt. A permission error is not an authentication error.
   */
  it("does NOT clear the session on an ordinary permission refusal", async () => {
    localStorage.setItem("access_token", "tok-123")
    client.setConfig({
      fetch: respondWith(403, {
        detail: "The user doesn't have enough privileges",
      }),
    })

    await usersReadUserMe().catch(() => {})

    expect(localStorage.getItem("access_token")).toBe("tok-123")
  })

  it("clears a stale session on a 403 that says the account is off", async () => {
    localStorage.setItem("access_token", "tok-123")
    client.setConfig({ fetch: respondWith(403, { detail: "Inactive user" }) })

    await usersReadUserMe().catch(() => {})

    expect(localStorage.getItem("access_token")).toBeNull()
  })

  /**
   * The regression this unit exists for.
   *
   * `main.tsx` used to do this in a `QueryCache`/`MutationCache` `onError`,
   * reading `error instanceof ApiError ? error.status : 401`. Only the
   * generated client produced an `ApiError`, so **every** other failure — a
   * 500, a 422, a dropped connection on any summarizer query — took the `401`
   * branch and logged the operator out mid-session.
   */
  it("does NOT clear the session on a server fault", async () => {
    localStorage.setItem("access_token", "tok-123")
    client.setConfig({ fetch: respondWith(500, { detail: "boom" }) })

    await usersReadUserMe().catch(() => {})

    expect(localStorage.getItem("access_token")).toBe("tok-123")
  })

  it("does NOT clear the session on a validation error", async () => {
    localStorage.setItem("access_token", "tok-123")
    client.setConfig({ fetch: respondWith(422, { detail: "bad input" }) })

    await usersReadUserMe().catch(() => {})

    expect(localStorage.getItem("access_token")).toBe("tok-123")
  })

  /**
   * A 404 is only an auth failure for this one detail string — it is how the
   * backend answers `/users/me` for a token whose user has been deleted.
   */
  it("treats only the 'User not found' 404 as an auth failure", async () => {
    localStorage.setItem("access_token", "tok-123")
    client.setConfig({
      fetch: respondWith(404, { detail: "Channel not found" }),
    })
    await usersReadUserMe().catch(() => {})
    expect(localStorage.getItem("access_token")).toBe("tok-123")

    client.setConfig({ fetch: respondWith(404, { detail: "User not found" }) })
    await usersReadUserMe().catch(() => {})
    expect(localStorage.getItem("access_token")).toBeNull()
  })
})
