import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { isRedirect } from "@tanstack/react-router"

import { client } from "@/client/client.gen"
import { queryClient } from "@/lib/queryClient"
import { TOKEN_STORAGE_KEY } from "@/lib/storage/scoped"

import { Route } from "./_layout"

/**
 * The authenticated shell's gate, called directly: no router, no render.
 *
 * Every request is refused, so the server-clock sync fails quietly (as it
 * is written to) and the only user the gate can see is the one seeded into the
 * query cache under the key `useAuth` reads.
 */
const beforeLoad = Route.options.beforeLoad as () => Promise<void>
const offline = (async () => {
  throw new TypeError("offline")
}) as unknown as typeof fetch
let clientFetch: typeof fetch | undefined

async function outcome(): Promise<string> {
  try {
    await beforeLoad()
    return "through"
  } catch (err) {
    if (isRedirect(err)) return `redirect ${err.options.to}`
    throw err
  }
}

// On the generated client's own `fetch` rather than the global one, because
// another file may already have given the client a stub of its own. One that
// answers 401 would sign the session out and clear the seeded user.
beforeEach(() => {
  clientFetch = client.getConfig().fetch
  client.setConfig({ fetch: offline })
})

afterEach(() => {
  client.setConfig({ fetch: clientFetch })
  // The session token is device-scoped by design, so it has no scoped writer.
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  queryClient.removeQueries({ queryKey: ["currentUser"] })
})

const signIn = () => window.localStorage.setItem(TOKEN_STORAGE_KEY, "tok")

describe("_layout beforeLoad", () => {
  test("sends a visitor with no session to the login page", async () => {
    expect(await outcome()).toBe("redirect /login")
  })

  test("lets an approved account through", async () => {
    signIn()
    queryClient.setQueryData(["currentUser"], { is_approved: true })
    expect(await outcome()).toBe("through")
  })

  test("sends an account awaiting approval to the pending page", async () => {
    signIn()
    queryClient.setQueryData(["currentUser"], { is_approved: false })
    expect(await outcome()).toBe("redirect /pending-approval")
  })

  test("leaves a failed user lookup to the transport rather than redirecting", async () => {
    signIn()
    expect(await outcome()).toBe("through")
  })
})
