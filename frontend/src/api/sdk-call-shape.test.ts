import { beforeEach, describe, expect, it } from "bun:test"
import { itemsUpdateItem, usersUpdateUser } from "@/client"
import { client } from "@/client/client.gen"
import { configureGeneratedClient } from "./generated-client"

/**
 * The two call sites that pass a path param *and* a body.
 *
 * `legacy/axios` took one flat bag (`{userId, requestBody}`); the fetch client
 * takes `{path: {...}, body: ...}`. Every other converted call site has only
 * one of the two, so these are the only places where the halves could be
 * swapped and still compile — `tsc` checks that the keys exist, not that the
 * value lands in the URL rather than the payload.
 */

let seen: { url: string; body: string; method: string } | undefined

beforeEach(() => {
  seen = undefined
  configureGeneratedClient()
  client.setConfig({
    baseUrl: "http://api.test",
    fetch: (async (request: Request) => {
      seen = {
        url: request.url,
        method: request.method,
        body: await request.text(),
      }
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch,
  })
})

describe("path and body land in the right halves of the request", () => {
  it("usersUpdateUser puts the id in the URL and the fields in the body", async () => {
    await usersUpdateUser({
      path: { user_id: "abc-123" },
      body: { email: "new@example.com" },
    })

    expect(seen?.method).toBe("PATCH")
    expect(seen?.url).toBe("http://api.test/api/v1/users/abc-123")
    expect(JSON.parse(seen?.body ?? "{}")).toEqual({ email: "new@example.com" })
  })

  it("itemsUpdateItem puts the id in the URL and the fields in the body", async () => {
    await itemsUpdateItem({
      path: { id: "item-9" },
      body: { title: "Renamed" },
    })

    expect(seen?.method).toBe("PUT")
    expect(seen?.url).toBe("http://api.test/api/v1/items/item-9")
    expect(JSON.parse(seen?.body ?? "{}")).toEqual({ title: "Renamed" })
  })
})
